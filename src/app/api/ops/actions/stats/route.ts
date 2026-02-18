import { NextResponse } from "next/server";
import { requireViewerAccess } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ACTION_DECK } from "@/lib/actions/ability-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

export async function GET() {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, skipped: "build", counts: {} });
  }

  const access = await requireViewerAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const counts: Record<string, number> = {};
  for (const ability of ACTION_DECK) counts[ability.id] = 0;

  const rows = await prisma.auditLog.groupBy({
    by: ["detail"],
    where: {
      action: "ops.actions.deck.run",
      detail: {
        not: null,
      },
    },
    _count: {
      _all: true,
    },
  });

  for (const row of rows) {
    const key = row.detail ?? "";
    if (!key || !(key in counts)) continue;
    counts[key] = row._count._all;
  }

  return NextResponse.json({ ok: true, counts });
}
