// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/status/route.ts
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

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

function asIsoDate(v: any): Date {
  if (typeof v === "string" && v.length) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
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
    return NextResponse.json(
      { ok: false, error: "Host not found" },
      { status: 404 }
    );
  }

  const key = host.apiKeys.find((k) => k.tokenHash === tokenHash);
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 }
    );
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Supports BOTH:
  // 1) Envelope: { ok, status, last, diff, ts, paths }
  // 2) Raw agent status.json: { alerts_count, public_ports_count, ... }
  const statusObj = (payload as any).status ?? null;
  const lastObj = (payload as any).last ?? null;
  const diffObj = (payload as any).diff ?? null;

  const ok = typeof (payload as any).ok === "boolean" ? (payload as any).ok : true;

  // Base object used for counts/version + stored statusJson
  const base =
    statusObj && typeof statusObj === "object" && !Array.isArray(statusObj)
      ? statusObj
      : payload;

  // Prefer base.ts; fallback payload.ts; fallback now
  const ts = asIsoDate((base as any)?.ts ?? (payload as any).ts);

  const alertsCount =
    typeof (base as any)?.alerts_count === "number"
      ? (base as any).alerts_count
      : Array.isArray((base as any)?.alerts)
        ? (base as any).alerts.length
        : 0;

  const publicPortsCount =
    typeof (base as any)?.public_ports_count === "number"
      ? (base as any).public_ports_count
      : Array.isArray((base as any)?.ports_public)
        ? (base as any).ports_public.length
        : 0;

  const agentVersion =
    typeof (base as any)?.version === "string" && (base as any).version
      ? (base as any).version
      : null;

  // Persist snapshot + update host heartbeat
  await prisma.$transaction([
    prisma.hostApiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    }),
    prisma.host.update({
      where: { id: hostId },
      data: {
        lastSeenAt: new Date(),
        agentVersion: agentVersion ?? host.agentVersion,
      },
    }),
    prisma.hostSnapshot.create({
      data: {
        hostId,
        ts,
        statusJson: JSON.stringify(base),
        lastJson: lastObj ? JSON.stringify(lastObj) : null,
        diffJson: diffObj ? JSON.stringify(diffObj) : null,
        ok,
        alertsCount,
        publicPortsCount,
      },
    }),
    prisma.auditLog.create({
      data: {
        hostId,
        action: "host.ingest",
        detail: `Ingest snapshot: ok=${ok} alerts=${alertsCount} publicPorts=${publicPortsCount}`,
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    hostId,
    received: true,
    persisted: true,
    ts: ts.toISOString(),
    alertsCount,
    publicPortsCount,
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;

  // Allow GET using the same Bearer token (so you can curl it)
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
    return NextResponse.json(
      { ok: false, error: "Host not found" },
      { status: 404 }
    );
  }

  const allowed = host.apiKeys.some((k) => k.tokenHash === tokenHash);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 }
    );
  }

  const snap = await prisma.hostSnapshot.findFirst({
    where: { hostId },
    orderBy: { ts: "desc" },
  });

  if (!snap) return NextResponse.json({ ok: true, hostId, snapshot: null });

  return NextResponse.json({
    ok: true,
    hostId,
    snapshot: {
      id: snap.id,
      ts: snap.ts,
      ok: snap.ok,
      alertsCount: snap.alertsCount,
      publicPortsCount: snap.publicPortsCount,
      status: safeParse(snap.statusJson),
      last: snap.lastJson ? safeParse(snap.lastJson) : null,
      diff: snap.diffJson ? safeParse(snap.diffJson) : null,
    },
  });
}
