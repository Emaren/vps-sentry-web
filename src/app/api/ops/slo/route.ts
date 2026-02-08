import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import { requireOpsAccess } from "@/lib/rbac";
import { buildSloSnapshot, formatSloSummary } from "@/lib/slo";

export const dynamic = "force-dynamic";

function hasValidSloToken(req: Request): boolean {
  const expected = process.env.VPS_SLO_TOKEN?.trim();
  if (!expected) return false;

  const provided = req.headers.get("x-slo-token")?.trim();
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function parseWindowHours(req: Request): number | undefined {
  const url = new URL(req.url);
  const raw = url.searchParams.get("windowHours");
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const value = Math.trunc(n);
  if (value < 1) return 1;
  if (value > 24 * 30) return 24 * 30;
  return value;
}

export async function GET(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/slo", source: "ops-slo" }, async (obsCtx) => {
    let actorUserId: string | null = null;
    let authMode: "token" | "ops" = "token";

    if (!hasValidSloToken(req)) {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.slo.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.slo.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/slo",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }
      actorUserId = access.identity.userId;
      obsCtx.userId = actorUserId;
      authMode = "ops";
    }

    const snapshot = await buildSloSnapshot({
      windowHours: parseWindowHours(req),
    });
    const summary = formatSloSummary(snapshot);

    incrementCounter("ops.slo.view.total", 1, {
      authMode,
      severity: snapshot.burn.severity,
      route: snapshot.burn.route,
      shouldAlert: snapshot.burn.shouldAlert ? "true" : "false",
    });

    await writeAuditLog({
      req,
      userId: actorUserId,
      action: "ops.slo.view",
      detail: summary,
      meta: {
        route: "/api/ops/slo",
        authMode,
        severity: snapshot.burn.severity,
        shouldAlert: snapshot.burn.shouldAlert,
        alertRoute: snapshot.burn.route,
        affectedObjectives: snapshot.burn.affectedObjectives,
        reason: snapshot.burn.reason,
      },
    });

    return NextResponse.json({
      ok: true,
      authMode,
      summary,
      snapshot,
    });
  });
}
