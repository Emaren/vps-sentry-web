// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/history/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeHostKeyScope } from "@/lib/host-keys";
import { safeRequestUrl } from "@/lib/request-url";
import {
  readBearerToken,
  touchHostKeyLastUsed,
  verifyHostTokenForScope,
} from "@/lib/host-key-auth";

export const dynamic = "force-dynamic";
const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, buildPhase: true, hostId: null, items: [] });
  }

  const { hostId } = await ctx.params;

  const token = readBearerToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing Authorization: Bearer <token>" }, { status: 401 });
  }
  const requiredScope = normalizeHostKeyScope("host.history.read");
  const auth = await verifyHostTokenForScope({
    hostId,
    token,
    requiredScope: requiredScope ?? undefined,
  });
  if (!auth.ok) {
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
  await touchHostKeyLastUsed(auth.key.id);

  const url = safeRequestUrl(req);
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
