import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { renderPrometheusMetrics, runObservedRoute } from "@/lib/observability";
import { requireOpsAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/metrics", source: "ops-metrics" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        await writeAuditLog({
          req,
          action: "ops.metrics.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/metrics",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;

      const body = renderPrometheusMetrics();
      const res = new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
          "cache-control": "no-store, max-age=0",
        },
      });

      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.metrics.view",
        detail: "Prometheus metrics endpoint queried",
        meta: {
          route: "/api/ops/metrics",
        },
      });

      return res;
    }
  );
}
