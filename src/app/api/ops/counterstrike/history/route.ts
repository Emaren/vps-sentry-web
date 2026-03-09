import { NextResponse } from "next/server";
import { requireViewerAccess } from "@/lib/rbac";
import { runObservedRoute } from "@/lib/observability";
import { listCounterstrikeHistory } from "@/lib/ops/counterstrike-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/counterstrike/history", source: "ops-counterstrike-history" },
    async () => {
      const accessResult = await requireViewerAccess();
      if (!accessResult.ok) {
        return NextResponse.json({ ok: false, error: accessResult.error }, { status: accessResult.status });
      }

      const url = new URL(req.url);
      const limitRaw = Number(url.searchParams.get("limit") ?? "8");
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.trunc(limitRaw))) : 8;
      const runs = await listCounterstrikeHistory(limit);
      return NextResponse.json({
        ok: true,
        runs,
      });
    }
  );
}
