import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseIngestPayload, extractIngestMeta } from "@/lib/host-ingest";
import { classifyHeartbeat, readHeartbeatConfig } from "@/lib/host-heartbeat";
import { normalizeHostKeyScope } from "@/lib/host-keys";
import {
  readBearerToken,
  touchHostKeyLastUsed,
  verifyHostTokenForScope,
} from "@/lib/host-key-auth";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import { queueAutonomousRemediationForHost } from "@/lib/remediate/autonomous-runtime";

export const dynamic = "force-dynamic";
const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function derivePublicPortsTotalCount(base: Record<string, unknown>): number {
  if (typeof base.public_ports_count === "number") return base.public_ports_count;
  if (Array.isArray(base.ports_public)) return base.ports_public.length;
  return 0;
}

function deriveUnexpectedPublicPortsCount(base: Record<string, unknown>): number | null {
  if (typeof base.unexpected_public_ports_count === "number") {
    return base.unexpected_public_ports_count;
  }
  if (Array.isArray(base.ports_public_unexpected)) {
    return base.ports_public_unexpected.length;
  }
  return null;
}

function deriveExpectedPublicPorts(base: Record<string, unknown>): string[] | null {
  if (Array.isArray(base.expected_public_ports)) {
    const out = base.expected_public_ports.filter((x): x is string => typeof x === "string");
    return out.length ? out : null;
  }
  return null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      hostId: null,
      received: false,
      persisted: false,
      deduped: false,
      warnings: [],
      alertsCount: 0,
      publicPortsCount: 0,
      publicPortsTotalCount: 0,
      unexpectedPublicPortsCount: 0,
      expectedPublicPorts: null,
      autonomous: null,
    });
  }

  const { hostId } = await ctx.params;
  return runObservedRoute(
    req,
    { route: "/api/hosts/[hostId]/status", source: "host-status-write", hostId },
    async () => {
      const token = readBearerToken(req);
      if (!token) {
        incrementCounter("host.status.write.unauthorized.total", 1, { reason: "missing_token" });
        return NextResponse.json(
          { ok: false, error: "Missing Authorization: Bearer <token>" },
          { status: 401 }
        );
      }

      const requiredScope = normalizeHostKeyScope("host.status.write");
      const auth = await verifyHostTokenForScope({
        hostId,
        token,
        requiredScope: requiredScope ?? undefined,
      });
      if (!auth.ok) {
        incrementCounter("host.status.write.unauthorized.total", 1, { reason: auth.code });
        return NextResponse.json(
          {
            ok: false,
            error: auth.error,
            code: auth.code,
            requiredScope: auth.requiredScope ?? null,
            key: auth.keySummary ?? null,
          },
          { status: auth.status }
        );
      }

      const rawBody = await req.text();
      const parsed = parseIngestPayload(rawBody);
      if (!parsed.ok) {
        incrementCounter("host.status.write.invalid_payload.total", 1, {
          status: parsed.status,
        });
        return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
      }
      const host = auth.host;
      const key = auth.key;

      const warnings = [...parsed.warnings];
      const payloadHost = typeof parsed.status.host === "string" ? parsed.status.host.trim() : "";
      if (
        payloadHost &&
        payloadHost !== host.id &&
        payloadHost !== host.name &&
        payloadHost !== (host.slug ?? "")
      ) {
        warnings.push(`ingest_host_mismatch:${payloadHost}`);
      }
      if (!host.enabled) warnings.push("ingest_host_disabled");

      const statusForStore: Record<string, unknown> = {
        ...parsed.status,
        _web_ingest: {
          payloadHash: parsed.payloadHash,
          payloadBytes: parsed.payloadBytes,
          receivedTs: new Date().toISOString(),
          warnings,
        },
      };

      const latest = await prisma.hostSnapshot.findFirst({
        where: { hostId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          ts: true,
          statusJson: true,
        },
      });

      let duplicateSnapshotId: string | null = null;
      if (latest) {
        const latestMeta = extractIngestMeta(safeParse(latest.statusJson));
        if (latestMeta?.payloadHash === parsed.payloadHash && latest.ts.getTime() === parsed.ts.getTime()) {
          duplicateSnapshotId = latest.id;
        }
      }

      const agentVersion =
        typeof parsed.status.version === "string" && parsed.status.version
          ? parsed.status.version
          : host.agentVersion;

      if (duplicateSnapshotId) {
        incrementCounter("host.status.write.deduped.total", 1);
        await prisma.$transaction([
          prisma.hostApiKey.update({
            where: { id: key.id },
            data: { lastUsedAt: new Date() },
          }),
          prisma.host.update({
            where: { id: hostId },
            data: {
              lastSeenAt: new Date(),
              agentVersion: agentVersion ?? undefined,
            },
          }),
          prisma.auditLog.create({
            data: {
              hostId,
              action: "host.ingest.duplicate",
              detail: `Duplicate snapshot ignored (snapshotId=${duplicateSnapshotId})`,
            },
          }),
        ]);

        return NextResponse.json({
          ok: true,
          hostId,
          deduped: true,
          duplicateSnapshotId,
          ts: parsed.ts.toISOString(),
          warnings,
          alertsCount: parsed.alertsCount,
          publicPortsCount: parsed.publicPortsCount,
          publicPortsTotalCount: parsed.publicPortsTotalCount,
          unexpectedPublicPortsCount: parsed.unexpectedPublicPortsCount,
          expectedPublicPorts: parsed.expectedPublicPorts,
        });
      }

      await prisma.$transaction([
        prisma.hostApiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date() },
        }),
        prisma.host.update({
          where: { id: hostId },
          data: {
            lastSeenAt: new Date(),
            agentVersion: agentVersion ?? undefined,
          },
        }),
        prisma.hostSnapshot.create({
          data: {
            hostId,
            ts: parsed.ts,
            statusJson: JSON.stringify(statusForStore),
            lastJson: parsed.last ? JSON.stringify(parsed.last) : null,
            diffJson: parsed.diff ? JSON.stringify(parsed.diff) : null,
            ok: parsed.okFlag,
            alertsCount: parsed.alertsCount,
            publicPortsCount: parsed.publicPortsCount,
          },
        }),
        prisma.auditLog.create({
          data: {
            hostId,
            action: "host.ingest",
            detail: `Ingest snapshot: ok=${parsed.okFlag} alerts=${parsed.alertsCount} unexpectedPublicPorts=${parsed.publicPortsCount} totalPublicPorts=${parsed.publicPortsTotalCount} warnings=${warnings.length}`,
          },
        }),
      ]);

      let autonomous: Awaited<ReturnType<typeof queueAutonomousRemediationForHost>> | null = null;
      try {
        autonomous = await queueAutonomousRemediationForHost({
          hostId,
          reason: "host_status_ingest",
        });
        if (autonomous.queued > 0) {
          incrementCounter("host.status.autonomous.queued.total", autonomous.queued, {
            approvalPending:
              autonomous.approvalPending > 0 ? "true" : "false",
          });
        }
        if (autonomous.skipped > 0) {
          incrementCounter("host.status.autonomous.skipped.total", autonomous.skipped);
        }
      } catch (err: unknown) {
        const errorText = String(err).slice(0, 500);
        incrementCounter("host.status.autonomous.error.total", 1);
        await prisma.auditLog.create({
          data: {
            hostId,
            action: "host.ingest.autonomous.error",
            detail: `Autonomous remediation evaluation failed: ${errorText}`,
          },
        });
      }

      incrementCounter("host.status.write.persisted.total", 1, {
        warnings: warnings.length > 0 ? "true" : "false",
      });
      return NextResponse.json({
        ok: true,
        hostId,
        received: true,
        persisted: true,
        deduped: false,
        ts: parsed.ts.toISOString(),
        warnings,
        alertsCount: parsed.alertsCount,
        publicPortsCount: parsed.publicPortsCount,
        publicPortsTotalCount: parsed.publicPortsTotalCount,
        unexpectedPublicPortsCount: parsed.unexpectedPublicPortsCount,
        expectedPublicPorts: parsed.expectedPublicPorts,
        autonomous,
      });
    }
  );
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      hostId: null,
      snapshot: null,
      heartbeat: { state: "missing", targetEveryMinutes: 5, staleAfterMinutes: 15, missingAfterMinutes: 60 },
    });
  }

  const { hostId } = await ctx.params;
  return runObservedRoute(
    req,
    { route: "/api/hosts/[hostId]/status", source: "host-status-read", hostId },
    async () => {
      const token = readBearerToken(req);
      if (!token) {
        incrementCounter("host.status.read.unauthorized.total", 1, { reason: "missing_token" });
        return NextResponse.json(
          { ok: false, error: "Missing Authorization: Bearer <token>" },
          { status: 401 }
        );
      }

      const requiredScope = normalizeHostKeyScope("host.status.read");
      const auth = await verifyHostTokenForScope({
        hostId,
        token,
        requiredScope: requiredScope ?? undefined,
      });
      if (!auth.ok) {
        incrementCounter("host.status.read.unauthorized.total", 1, { reason: auth.code });
        return NextResponse.json(
          {
            ok: false,
            error: auth.error,
            code: auth.code,
            requiredScope: auth.requiredScope ?? null,
            key: auth.keySummary ?? null,
          },
          { status: auth.status }
        );
      }
      const host = auth.host;
      await touchHostKeyLastUsed(auth.key.id);

      const snap = await prisma.hostSnapshot.findFirst({
        where: { hostId },
        orderBy: { ts: "desc" },
      });

      const heartbeat = classifyHeartbeat(host.lastSeenAt, new Date(), readHeartbeatConfig());

      if (!snap) {
        incrementCounter("host.status.read.empty.total", 1);
        return NextResponse.json({
          ok: true,
          hostId,
          snapshot: null,
          heartbeat,
        });
      }

      const statusParsed = safeParse(snap.statusJson);
      const base = asRecord(statusParsed) ?? {};

      const publicPortsTotalCount = derivePublicPortsTotalCount(base);
      const unexpectedMaybe = deriveUnexpectedPublicPortsCount(base);
      const actionable = unexpectedMaybe ?? publicPortsTotalCount;
      const expectedPublicPorts = deriveExpectedPublicPorts(base);
      const ingestIntegrity = extractIngestMeta(base);

      incrementCounter("host.status.read.success.total", 1, {
        actionablePorts: actionable > 0 ? "true" : "false",
      });
      return NextResponse.json({
        ok: true,
        hostId,
        heartbeat,
        snapshot: {
          id: snap.id,
          ts: snap.ts,
          ok: snap.ok,
          alertsCount: snap.alertsCount,
          publicPortsCount: snap.publicPortsCount,
          publicPortsTotalCount,
          unexpectedPublicPortsCount: actionable,
          expectedPublicPorts,
          ingestIntegrity,
          status: statusParsed,
          last: snap.lastJson ? safeParse(snap.lastJson) : null,
          diff: snap.diffJson ? safeParse(snap.diffJson) : null,
        },
      });
    }
  );
}
