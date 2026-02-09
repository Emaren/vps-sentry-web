import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import { safeRequestUrl } from "@/lib/request-url";
import {
  IncidentEngineError,
  createIncidentRun,
  listIncidentRuns,
  normalizeIncidentSeverity,
  normalizeIncidentStateFilter,
  runIncidentEscalationSweep,
} from "@/lib/ops/incident-engine";

export const dynamic = "force-dynamic";

function parseLimit(v: string | null, fallback = 30, min = 1, max = 200): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function parseBool(v: string | null, fallback = false): boolean {
  if (!v) return fallback;
  const t = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

function toEngineError(err: unknown): IncidentEngineError {
  if (err instanceof IncidentEngineError) return err;
  return new IncidentEngineError(500, err instanceof Error ? err.message : String(err));
}

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incidents", source: "ops-incidents" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.incidents.list.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.incidents.list.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;

      const url = safeRequestUrl(req);
      const stateRaw = url.searchParams.get("state");
      const state = normalizeIncidentStateFilter(stateRaw, null);
      if (stateRaw && !state) {
        return NextResponse.json({ ok: false, error: "Invalid state filter" }, { status: 400 });
      }

      const snapshot = await listIncidentRuns({
        limit: parseLimit(url.searchParams.get("limit"), 30, 1, 200),
        state,
        hostId: url.searchParams.get("hostId"),
        assigneeUserId: url.searchParams.get("assigneeUserId"),
        includeClosed: parseBool(url.searchParams.get("includeClosed"), false),
      });

      incrementCounter("ops.incidents.list.total", 1, {
        state: state ?? "default",
      });
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.incidents.list",
        detail: `Incident list viewed (rows=${snapshot.incidents.length})`,
        meta: {
          route: "/api/ops/incidents",
          filters: snapshot.filters,
          counts: snapshot.counts,
        },
      });

      return NextResponse.json({
        ok: true,
        snapshot,
      });
    }
  );
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incidents", source: "ops-incidents" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.incidents.mutate.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.incidents.mutate.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;
      const body = await req.json().catch(() => ({}));
      const action =
        typeof body?.action === "string" ? body.action.trim().toLowerCase() : "create";

      if (action === "escalation-sweep") {
        const summary = await runIncidentEscalationSweep({
          actorUserId: access.identity.userId,
          limit: parseLimit(String(body?.limit ?? "25"), 25, 1, 200),
        });

        incrementCounter("ops.incidents.escalation_sweep.total", 1, {
          escalated: summary.escalated > 0 ? "true" : "false",
        });
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.incidents.escalation_sweep",
          detail: `Escalation sweep ran (escalated=${summary.escalated})`,
          meta: {
            route: "/api/ops/incidents",
            summary,
          },
        });

        return NextResponse.json({
          ok: true,
          action,
          summary,
        });
      }

      if (action !== "create") {
        return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
      }

      try {
        const severity =
          body?.severity === undefined
            ? null
            : normalizeIncidentSeverity(body.severity, null);
        if (body?.severity !== undefined && !severity) {
          return NextResponse.json({ ok: false, error: "Invalid severity" }, { status: 400 });
        }

        const incident = await createIncidentRun({
          workflowId: typeof body?.workflowId === "string" ? body.workflowId : "",
          title: typeof body?.title === "string" ? body.title : null,
          summary: typeof body?.summary === "string" ? body.summary : null,
          severity,
          triggerSignal: typeof body?.triggerSignal === "string" ? body.triggerSignal : null,
          hostId: typeof body?.hostId === "string" ? body.hostId : null,
          createdByUserId: access.identity.userId,
          assigneeUserId: typeof body?.assigneeUserId === "string" ? body.assigneeUserId : null,
          assigneeEmail: typeof body?.assigneeEmail === "string" ? body.assigneeEmail : null,
          ackDueMinutes: typeof body?.ackDueMinutes === "number" ? body.ackDueMinutes : null,
          escalationEveryMinutes:
            typeof body?.escalationEveryMinutes === "number"
              ? body.escalationEveryMinutes
              : null,
          initialNote: typeof body?.initialNote === "string" ? body.initialNote : null,
        });

        incrementCounter("ops.incidents.create.total", 1, {
          workflowId: incident.workflowId,
          severity: incident.severity,
        });
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          hostId: incident.host?.id ?? null,
          action: "ops.incidents.create",
          detail: `Created incident ${incident.id} (${incident.workflowId})`,
          meta: {
            route: "/api/ops/incidents",
            incidentId: incident.id,
            workflowId: incident.workflowId,
            severity: incident.severity,
            hostId: incident.host?.id ?? null,
          },
        });

        return NextResponse.json(
          {
            ok: true,
            action,
            incident,
          },
          { status: 201 }
        );
      } catch (err: unknown) {
        const engineErr = toEngineError(err);
        return NextResponse.json(
          { ok: false, error: engineErr.message },
          { status: engineErr.status }
        );
      }
    }
  );
}
