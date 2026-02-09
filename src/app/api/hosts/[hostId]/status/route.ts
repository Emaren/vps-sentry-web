// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/status/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

// -------- build-worker / weird Request hardening --------

function isLikelyBuildInvocation(req: Request): boolean {
  if (IS_BUILD_TIME) return true;

  const anyReq = req as any;
  const rawUrl = anyReq?.url;

  // the failing case you're seeing: URL constructor gets an object -> "[object Object]"
  if (typeof rawUrl !== "string") return true;
  if (!rawUrl || rawUrl === "[object Object]") return true;

  return false;
}

function safeUrlString(req: Request): string {
  const anyReq = req as any;

  const raw = anyReq?.url;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s && s !== "[object Object]" && (s.startsWith("/") || s.startsWith("http://") || s.startsWith("https://"))) {
      return s;
    }
  }

  const href = anyReq?.nextUrl?.href;
  if (typeof href === "string") {
    const s = href.trim();
    if (s && s !== "[object Object]" && (s.startsWith("/") || s.startsWith("http://") || s.startsWith("https://"))) {
      return s;
    }
  }

  // safeRequestUrl("/" ...) will always be valid
  return "/";
}

/**
 * Some of your libs (directly or indirectly) call safeRequestUrl(req) and choke if
 * req.nextUrl is an object (they pass it into new URL()).
 *
 * We pass a minimal Request-like object into auth helpers so:
 *  - headers work
 *  - url is always a safe string
 *  - nextUrl does not exist
 *
 * IMPORTANT: we still read the body from the real `req`.
 */
function makeAuthReq(req: Request): Request {
  const url = safeUrlString(req);
  const method = (req as any)?.method ?? "GET";
  return { headers: req.headers, url, method } as any as Request;
}

// -------- helpers (no imports) --------

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
  if (typeof base.unexpected_public_ports_count === "number") return base.unexpected_public_ports_count;
  if (Array.isArray(base.ports_public_unexpected)) return base.ports_public_unexpected.length;
  return null;
}

function deriveExpectedPublicPorts(base: Record<string, unknown>): string[] | null {
  if (Array.isArray(base.expected_public_ports)) {
    const out = base.expected_public_ports.filter((x): x is string => typeof x === "string");
    return out.length ? out : null;
  }
  return null;
}

// -------- lazy deps (avoid import-time URL parsing during build) --------

async function loadDeps() {
  const [
    prismaMod,
    ingestMod,
    heartbeatMod,
    hostKeysMod,
    hostKeyAuthMod,
    remediateMod,
    obsMod,
  ] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/host-ingest"),
    import("@/lib/host-heartbeat"),
    import("@/lib/host-keys"),
    import("@/lib/host-key-auth"),
    import("@/lib/remediate/autonomous-runtime"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  return {
    prisma: prismaMod.prisma,
    parseIngestPayload: ingestMod.parseIngestPayload,
    extractIngestMeta: ingestMod.extractIngestMeta,
    classifyHeartbeat: heartbeatMod.classifyHeartbeat,
    readHeartbeatConfig: heartbeatMod.readHeartbeatConfig,
    normalizeHostKeyScope: hostKeysMod.normalizeHostKeyScope,
    readBearerToken: hostKeyAuthMod.readBearerToken,
    touchHostKeyLastUsed: hostKeyAuthMod.touchHostKeyLastUsed,
    verifyHostTokenForScope: hostKeyAuthMod.verifyHostTokenForScope,
    queueAutonomousRemediationForHost: remediateMod.queueAutonomousRemediationForHost,
    // observability (optional)
    incrementCounter: (obsMod as any).incrementCounter ?? (() => {}),
    runObservedRoute:
      (obsMod as any).runObservedRoute ??
      (async (_req: Request, _meta: any, fn: () => Promise<any>) => fn()),
  };
}

// -------- routes --------

export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (isLikelyBuildInvocation(req)) {
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
  const deps = await loadDeps();

  return deps.runObservedRoute(
    req,
    { route: "/api/hosts/[hostId]/status", source: "host-status-write", hostId },
    async () => {
      const reqAuth = makeAuthReq(req);

      const token = deps.readBearerToken(reqAuth);
      if (!token) {
        deps.incrementCounter("host.status.write.unauthorized.total", 1, { reason: "missing_token" });
        return NextResponse.json({ ok: false, error: "Missing Authorization: Bearer <token>" }, { status: 401 });
      }

      const requiredScope = deps.normalizeHostKeyScope("host.status.write");
      const auth = await deps.verifyHostTokenForScope({
        hostId,
        token,
        requiredScope: requiredScope ?? undefined,
      });

      if (!auth.ok) {
        deps.incrementCounter("host.status.write.unauthorized.total", 1, { reason: auth.code });
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

      // READ BODY FROM REAL REQUEST (not the minimal auth object)
      const rawBody = await req.text();
      const parsed = deps.parseIngestPayload(rawBody);
      if (!parsed.ok) {
        deps.incrementCounter("host.status.write.invalid_payload.total", 1, { status: String(parsed.status) });
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

      const latest = await deps.prisma.hostSnapshot.findFirst({
        where: { hostId },
        orderBy: { createdAt: "desc" },
        select: { id: true, ts: true, statusJson: true },
      });

      let duplicateSnapshotId: string | null = null;
      if (latest) {
        const latestMeta = deps.extractIngestMeta(safeParse(latest.statusJson));
        if (latestMeta?.payloadHash === parsed.payloadHash && latest.ts.getTime() === parsed.ts.getTime()) {
          duplicateSnapshotId = latest.id;
        }
      }

      const agentVersion =
        typeof parsed.status.version === "string" && parsed.status.version
          ? parsed.status.version
          : host.agentVersion;

      if (duplicateSnapshotId) {
        deps.incrementCounter("host.status.write.deduped.total", 1);

        await deps.prisma.$transaction([
          deps.prisma.hostApiKey.update({
            where: { id: key.id },
            data: { lastUsedAt: new Date() },
          }),
          deps.prisma.host.update({
            where: { id: hostId },
            data: { lastSeenAt: new Date(), agentVersion: agentVersion ?? undefined },
          }),
          deps.prisma.auditLog.create({
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

      await deps.prisma.$transaction([
        deps.prisma.hostApiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date() },
        }),
        deps.prisma.host.update({
          where: { id: hostId },
          data: { lastSeenAt: new Date(), agentVersion: agentVersion ?? undefined },
        }),
        deps.prisma.hostSnapshot.create({
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
        deps.prisma.auditLog.create({
          data: {
            hostId,
            action: "host.ingest",
            detail: `Ingest snapshot: ok=${parsed.okFlag} alerts=${parsed.alertsCount} unexpectedPublicPorts=${parsed.publicPortsCount} totalPublicPorts=${parsed.publicPortsTotalCount} warnings=${warnings.length}`,
          },
        }),
      ]);

      let autonomous: Awaited<ReturnType<typeof deps.queueAutonomousRemediationForHost>> | null = null;
      try {
        autonomous = await deps.queueAutonomousRemediationForHost({ hostId, reason: "host_status_ingest" });

        if (autonomous.queued > 0) {
          deps.incrementCounter("host.status.autonomous.queued.total", autonomous.queued, {
            approvalPending: autonomous.approvalPending > 0 ? "true" : "false",
          });
        }
        if (autonomous.skipped > 0) {
          deps.incrementCounter("host.status.autonomous.skipped.total", autonomous.skipped);
        }
      } catch (err: unknown) {
        const errorText = String(err).slice(0, 500);
        deps.incrementCounter("host.status.autonomous.error.total", 1);
        await deps.prisma.auditLog.create({
          data: {
            hostId,
            action: "host.ingest.autonomous.error",
            detail: `Autonomous remediation evaluation failed: ${errorText}`,
          },
        });
      }

      deps.incrementCounter("host.status.write.persisted.total", 1, {
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

export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (isLikelyBuildInvocation(req)) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      hostId: null,
      snapshot: null,
      heartbeat: { state: "missing", targetEveryMinutes: 5, staleAfterMinutes: 15, missingAfterMinutes: 60 },
    });
  }

  const { hostId } = await ctx.params;
  const deps = await loadDeps();

  return deps.runObservedRoute(
    req,
    { route: "/api/hosts/[hostId]/status", source: "host-status-read", hostId },
    async () => {
      const reqAuth = makeAuthReq(req);

      const token = deps.readBearerToken(reqAuth);
      if (!token) {
        deps.incrementCounter("host.status.read.unauthorized.total", 1, { reason: "missing_token" });
        return NextResponse.json({ ok: false, error: "Missing Authorization: Bearer <token>" }, { status: 401 });
      }

      const requiredScope = deps.normalizeHostKeyScope("host.status.read");
      const auth = await deps.verifyHostTokenForScope({
        hostId,
        token,
        requiredScope: requiredScope ?? undefined,
      });

      if (!auth.ok) {
        deps.incrementCounter("host.status.read.unauthorized.total", 1, { reason: auth.code });
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
      await deps.touchHostKeyLastUsed(auth.key.id);

      const snap = await deps.prisma.hostSnapshot.findFirst({
        where: { hostId },
        orderBy: { ts: "desc" },
      });

      const heartbeat = deps.classifyHeartbeat(host.lastSeenAt, new Date(), deps.readHeartbeatConfig());

      if (!snap) {
        deps.incrementCounter("host.status.read.empty.total", 1);
        return NextResponse.json({ ok: true, hostId, snapshot: null, heartbeat });
      }

      const statusParsed = safeParse(snap.statusJson);
      const base = asRecord(statusParsed) ?? {};

      const publicPortsTotalCount = derivePublicPortsTotalCount(base);
      const unexpectedMaybe = deriveUnexpectedPublicPortsCount(base);
      const actionable = unexpectedMaybe ?? publicPortsTotalCount;
      const expectedPublicPorts = deriveExpectedPublicPorts(base);
      const ingestIntegrity = deps.extractIngestMeta(base);

      deps.incrementCounter("host.status.read.success.total", 1, {
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
