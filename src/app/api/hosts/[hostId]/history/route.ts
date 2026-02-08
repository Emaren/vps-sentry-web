// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/history/route.ts
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

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;

  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing Authorization: Bearer <token>" }, { status: 401 });
  }

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    include: { apiKeys: { where: { revokedAt: null }, select: { tokenHash: true }, take: 50 } },
  });

  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const allowed = host.apiKeys.some((k) => k.tokenHash === sha256(token));
  if (!allowed) return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

  const snaps = await prisma.hostSnapshot.findMany({
    where: { hostId },
    orderBy: { ts: "desc" },
    take: limit,
    select: {
      id: true,
      ts: true,
      ok: true,
      alertsCount: true,
      publicPortsCount: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, hostId, items: snaps });
}
