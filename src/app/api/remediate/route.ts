import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildRemediationPlanFromSnapshots } from "@/lib/remediate";

export const dynamic = "force-dynamic";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hostId = typeof body?.hostId === "string" ? body.hostId.trim() : "";
  const limitRaw = Number(body?.limit ?? 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(10, Math.min(limitRaw, 200)) : 40;

  if (!hostId) {
    return NextResponse.json({ ok: false, error: "hostId is required" }, { status: 400 });
  }

  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: user.id },
    select: { id: true, name: true, slug: true, lastSeenAt: true, enabled: true },
  });
  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const snapshots = await prisma.hostSnapshot.findMany({
    where: { hostId: host.id },
    orderBy: { ts: "desc" },
    take: limit,
    select: {
      id: true,
      ts: true,
      statusJson: true,
    },
  });

  const parsed = snapshots
    .map((s) => ({ id: s.id, ts: s.ts, status: safeParse(s.statusJson) }))
    .filter((s): s is { id: string; ts: Date; status: Record<string, unknown> } => Boolean(s.status && typeof s.status === "object"));

  const plan = buildRemediationPlanFromSnapshots(parsed);

  return NextResponse.json({
    ok: true,
    host,
    snapshotsConsidered: parsed.length,
    timelineCount: plan.timelineCount,
    topCodes: plan.topCodes,
    actions: plan.actions,
  });
}
