import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { getObservabilitySnapshot, runObservedRoute } from "@/lib/observability";
import { requireAdminAccess } from "@/lib/rbac";
import { safeRequestUrl } from "@/lib/request-url";

export const dynamic = "force-dynamic";

function parseLimit(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/observability", source: "ops-observability" },
    async (obsCtx) => {
      const access = await requireAdminAccess();
      if (!access.ok) {
        await writeAuditLog({
          req,
          action: "ops.observability.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/observability",
            status: access.status,
            requiredRole: "admin",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;

      const url = safeRequestUrl(req);
      const snapshot = getObservabilitySnapshot({
        logsLimit: parseLimit(url.searchParams.get("logs"), 80, 5, 500),
        tracesLimit: parseLimit(url.searchParams.get("traces"), 80, 5, 500),
        alertsLimit: parseLimit(url.searchParams.get("alerts"), 80, 5, 500),
        countersLimit: parseLimit(url.searchParams.get("counters"), 300, 10, 1000),
        timingsLimit: parseLimit(url.searchParams.get("timings"), 300, 10, 1000),
      });

      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.observability.view",
        detail: "Observability dashboard snapshot viewed",
        meta: {
          route: "/api/ops/observability",
          counters: snapshot.counters.length,
          timings: snapshot.timings.length,
          logs: snapshot.recentLogs.length,
          traces: snapshot.recentTraces.length,
          alerts: snapshot.recentAlerts.length,
        },
      });

      return NextResponse.json({
        ok: true,
        snapshot,
      });
    }
  );
}
