import { NextResponse } from "next/server";
import { requireViewerAccess } from "@/lib/rbac";
import { runObservedRoute } from "@/lib/observability";
import { COUNTERSTRIKE_PLAYBOOKS } from "@/lib/ops/counterstrike-playbooks";
import { readCounterstrikeStatus } from "@/lib/ops/counterstrike-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/counterstrike/status", source: "ops-counterstrike-status" },
    async () => {
      const accessResult = await requireViewerAccess();
      if (!accessResult.ok) {
        return NextResponse.json({ ok: false, error: accessResult.error }, { status: accessResult.status });
      }

      const snapshot = await readCounterstrikeStatus({ role: accessResult.identity.role });
      return NextResponse.json({
        ok: true,
        playbooks: COUNTERSTRIKE_PLAYBOOKS,
        ...snapshot,
      });
    }
  );
}
