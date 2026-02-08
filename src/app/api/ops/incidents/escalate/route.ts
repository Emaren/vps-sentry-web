import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import { runIncidentEscalationSweep } from "@/lib/ops/incident-engine";

export const dynamic = "force-dynamic";

function hasValidEscalationToken(req: Request): boolean {
  const expected = process.env.VPS_INCIDENT_ESCALATE_TOKEN?.trim();
  if (!expected) return false;

  const provided = req.headers.get("x-incident-escalate-token")?.trim();
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseLimit(v: unknown, fallback = 25): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < 1) return 1;
  if (t > 200) return 200;
  return t;
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incidents/escalate", source: "ops-incidents" },
    async (obsCtx) => {
      let actorUserId: string | null = null;
      let authMode: "token" | "ops" = "token";

      if (!hasValidEscalationToken(req)) {
        const access = await requireOpsAccess();
        if (!access.ok) {
          incrementCounter("ops.incidents.escalate.denied.total", 1, {
            status: access.status,
          });
          await writeAuditLog({
            req,
            action: "ops.incidents.escalate.denied",
            detail: `status=${access.status} email=${access.email ?? "unknown"}`,
            meta: {
              route: "/api/ops/incidents/escalate",
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

      const body = await req.json().catch(() => ({}));
      const summary = await runIncidentEscalationSweep({
        actorUserId,
        limit: parseLimit(body?.limit, 25),
      });

      incrementCounter("ops.incidents.escalate.total", 1, {
        authMode,
        escalated: summary.escalated > 0 ? "true" : "false",
      });
      await writeAuditLog({
        req,
        userId: actorUserId,
        action: "ops.incidents.escalate",
        detail: `Incident escalation sweep ran (escalated=${summary.escalated})`,
        meta: {
          route: "/api/ops/incidents/escalate",
          authMode,
          summary,
        },
      });

      return NextResponse.json({
        ok: true,
        authMode,
        summary,
      });
    }
  );
}
