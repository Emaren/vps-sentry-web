import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import {
  IncidentEngineError,
  acknowledgeIncidentRun,
  addIncidentNote,
  assignIncidentRun,
  closeIncidentRun,
  executeIncidentWorkflowStep,
  getIncidentRunDetail,
  reopenIncidentRun,
  resolveIncidentRun,
  updateIncidentPostmortem,
  normalizePostmortemStatus,
} from "@/lib/ops/incident-engine";

export const dynamic = "force-dynamic";

function parseLimit(v: string | null, fallback = 120, min = 1, max = 600): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function toEngineError(err: unknown): IncidentEngineError {
  if (err instanceof IncidentEngineError) return err;
  return new IncidentEngineError(500, err instanceof Error ? err.message : String(err));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ incidentId: string }> }
) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incidents/[incidentId]", source: "ops-incidents" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.incidents.detail.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.incidents.detail.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents/[incidentId]",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;
      const { incidentId } = await ctx.params;
      const timelineLimit = parseLimit(new URL(req.url).searchParams.get("timelineLimit"));
      const incident = await getIncidentRunDetail(incidentId, { timelineLimit });
      if (!incident) {
        return NextResponse.json({ ok: false, error: "Incident not found" }, { status: 404 });
      }

      incrementCounter("ops.incidents.detail.total", 1, {
        state: incident.state,
      });

      return NextResponse.json({
        ok: true,
        incident,
      });
    }
  );
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ incidentId: string }> }
) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incidents/[incidentId]", source: "ops-incidents" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.incidents.action.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.incidents.action.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents/[incidentId]",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;
      const { incidentId } = await ctx.params;
      const body = await req.json().catch(() => ({}));
      const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

      try {
        if (action === "assign") {
          const incident = await assignIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            assigneeUserId: typeof body?.assigneeUserId === "string" ? body.assigneeUserId : null,
            assigneeEmail: typeof body?.assigneeEmail === "string" ? body.assigneeEmail : null,
            note: typeof body?.note === "string" ? body.note : null,
          });
          incrementCounter("ops.incidents.assign.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.assign",
            detail: `Assigned incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
              assigneeUserId: incident.assignee?.id ?? null,
              assigneeEmail: incident.assigneeEmail ?? null,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "acknowledge") {
          const incident = await acknowledgeIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });
          incrementCounter("ops.incidents.acknowledge.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.acknowledge",
            detail: `Acknowledged incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
              state: incident.state,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "resolve") {
          const incident = await resolveIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });
          incrementCounter("ops.incidents.resolve.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.resolve",
            detail: `Resolved incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
              state: incident.state,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "close") {
          const incident = await closeIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });
          incrementCounter("ops.incidents.close.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.close",
            detail: `Closed incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
              state: incident.state,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "reopen") {
          const incident = await reopenIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });
          incrementCounter("ops.incidents.reopen.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.reopen",
            detail: `Reopened incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
              state: incident.state,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "note") {
          const message = typeof body?.message === "string" ? body.message : "";
          const incident = await addIncidentNote({
            incidentId,
            actorUserId: access.identity.userId,
            message,
          });
          incrementCounter("ops.incidents.note.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.note",
            detail: `Added timeline note on incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "postmortem") {
          const statusRaw = body?.status;
          const status =
            statusRaw === undefined
              ? undefined
              : normalizePostmortemStatus(statusRaw, null);
          if (statusRaw !== undefined && status === null) {
            return NextResponse.json(
              { ok: false, error: "Invalid postmortem status" },
              { status: 400 }
            );
          }

          const incident = await updateIncidentPostmortem({
            incidentId,
            actorUserId: access.identity.userId,
            status,
            summary: typeof body?.summary === "string" ? body.summary : undefined,
            impact: typeof body?.impact === "string" ? body.impact : undefined,
            rootCause: typeof body?.rootCause === "string" ? body.rootCause : undefined,
            actionItems: body?.actionItems,
          });
          incrementCounter("ops.incidents.postmortem.total", 1, { ok: "true" });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: incident.host?.id ?? null,
            action: "ops.incidents.postmortem",
            detail: `Updated postmortem for incident ${incident.id}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident.id,
              postmortemStatus: incident.postmortemStatus,
            },
          });
          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "step") {
          const stepId = typeof body?.stepId === "string" ? body.stepId : "";
          const payload =
            body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
              ? (body.payload as Record<string, unknown>)
              : {};

          const execution = await executeIncidentWorkflowStep({
            incidentId,
            stepId,
            actorUserId: access.identity.userId,
            actorEmail: access.identity.email,
            payload,
            observability: {
              correlationId: obsCtx.correlationId,
              traceId: obsCtx.traceId,
              route: obsCtx.route,
              method: obsCtx.method,
            },
          });

          incrementCounter("ops.incidents.step.total", 1, {
            stepId,
            ok: execution.ok ? "true" : "false",
          });
          await writeAuditLog({
            req,
            userId: access.identity.userId,
            hostId: execution.incident.host?.id ?? null,
            action: execution.ok
              ? "ops.incidents.step"
              : "ops.incidents.step.failed",
            detail: execution.ok
              ? `Incident step ${execution.step.id} executed`
              : `Incident step ${execution.step.id} failed: ${execution.error ?? "unknown"}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: execution.incident.id,
              workflowId: execution.workflow.id,
              stepId: execution.step.id,
              action: execution.step.action,
              ok: execution.ok,
            },
          });

          return NextResponse.json(
            {
              ok: execution.ok,
              error: execution.error,
              action,
              incident: execution.incident,
              workflow: execution.workflow,
              step: execution.step,
              result: execution.result,
            },
            { status: execution.ok ? 200 : 409 }
          );
        }

        return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
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
