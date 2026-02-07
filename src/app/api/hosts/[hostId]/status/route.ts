import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseIngestPayload, extractIngestMeta } from "@/lib/host-ingest";
import { classifyHeartbeat, readHeartbeatConfig } from "@/lib/host-heartbeat";

export const dynamic = "force-dynamic";

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function derivePublicPortsTotalCount(base: any): number {
  if (typeof base?.public_ports_count === "number") return base.public_ports_count;
  if (Array.isArray(base?.ports_public)) return base.ports_public.length;
  return 0;
}

function deriveUnexpectedPublicPortsCount(base: any): number | null {
  if (typeof base?.unexpected_public_ports_count === "number") {
    return base.unexpected_public_ports_count;
  }
  if (Array.isArray(base?.ports_public_unexpected)) {
    return base.ports_public_unexpected.length;
  }
  return null;
}

function deriveExpectedPublicPorts(base: any): string[] | null {
  if (Array.isArray(base?.expected_public_ports)) {
    const out = base.expected_public_ports.filter((x: any) => typeof x === "string");
    return out.length ? out : null;
  }
  return null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;

  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const rawBody = await req.text();
  const parsed = parseIngestPayload(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }

  const tokenHash = sha256(token);

  // Validate host + active api key
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    include: {
      apiKeys: {
        where: { revokedAt: null },
        select: { id: true, tokenHash: true },
        take: 50,
      },
    },
  });

  if (!host) {
    return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });
  }

  const key = host.apiKeys.find((k) => k.tokenHash === tokenHash);
  if (!key) {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

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
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;

  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const tokenHash = sha256(token);

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    include: {
      apiKeys: { where: { revokedAt: null }, select: { tokenHash: true }, take: 50 },
    },
  });

  if (!host) {
    return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });
  }

  const allowed = host.apiKeys.some((k) => k.tokenHash === tokenHash);
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }

  const snap = await prisma.hostSnapshot.findFirst({
    where: { hostId },
    orderBy: { ts: "desc" },
  });

  const heartbeat = classifyHeartbeat(host.lastSeenAt, new Date(), readHeartbeatConfig());

  if (!snap) {
    return NextResponse.json({
      ok: true,
      hostId,
      snapshot: null,
      heartbeat,
    });
  }

  const statusParsed: any = safeParse(snap.statusJson);
  const base = statusParsed && typeof statusParsed === "object" ? statusParsed : {};

  const publicPortsTotalCount = derivePublicPortsTotalCount(base);
  const unexpectedMaybe = deriveUnexpectedPublicPortsCount(base);
  const actionable = unexpectedMaybe ?? publicPortsTotalCount;
  const expectedPublicPorts = deriveExpectedPublicPorts(base);
  const ingestIntegrity = extractIngestMeta(base);

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
