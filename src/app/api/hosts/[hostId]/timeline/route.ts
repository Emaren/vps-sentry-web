import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildIncidentTimeline } from "@/lib/incident-signals";
import { requireViewerAccess } from "@/lib/rbac";
import { safeRequestUrl } from "@/lib/request-url";

export const dynamic = "force-dynamic";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const access = await requireViewerAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { hostId } = await ctx.params;
  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: access.identity.userId },
    select: { id: true },
  });
  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const url = safeRequestUrl(req);
  const limitParam = Number(url.searchParams.get("limit") ?? "40");
  const limit = Number.isFinite(limitParam) ? Math.max(10, Math.min(limitParam, 200)) : 40;

  const snapshots = await prisma.hostSnapshot.findMany({
    where: { hostId },
    orderBy: { ts: "desc" },
    take: limit,
    select: {
      id: true,
      ts: true,
      statusJson: true,
    },
  });

  const parsed = snapshots
    .map((s) => ({
      id: s.id,
      ts: s.ts,
      status: safeParse(s.statusJson),
    }))
    .filter((s) => s.status && typeof s.status === "object") as Array<{
    id: string;
    ts: Date;
    status: Record<string, unknown>;
  }>;

  const result = buildIncidentTimeline(parsed);

  return NextResponse.json({
    ok: true,
    hostId,
    snapshotsConsidered: parsed.length,
    timeline: result.timeline,
    summary: result.summary,
  });
}
