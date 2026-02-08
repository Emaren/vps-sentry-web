import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { INCIDENT_WORKFLOWS } from "@/lib/ops/workflows";
import {
  executeWorkflowApiStep,
  resolveWorkflowStepInput,
} from "@/lib/ops/workflow-executor";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incident-workflow", source: "ops-incident-workflow" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.incident_workflow.list.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.incident_workflow.list.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incident-workflow",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;
      incrementCounter("ops.incident_workflow.list.total", 1, {
        role: access.identity.role,
      });
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.incident_workflow.list",
        detail: "Incident workflow catalog viewed",
        meta: {
          route: "/api/ops/incident-workflow",
          count: INCIDENT_WORKFLOWS.length,
        },
      });

      return NextResponse.json({
        ok: true,
        workflows: INCIDENT_WORKFLOWS,
      });
    }
  );
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/incident-workflow", source: "ops-incident-workflow" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.incident_workflow.step.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.incident_workflow.step.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incident-workflow",
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
      const resolved = resolveWorkflowStepInput({
        workflowId: body?.workflowId,
        stepId: body?.stepId,
        payload: body?.payload,
      });
      if (!resolved.ok) {
        return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
      }

      if (resolved.step.kind !== "api" || !resolved.step.action) {
        return NextResponse.json(
          {
            ok: false,
            error: "Step is manual-only and cannot be executed by API",
          },
          { status: 400 }
        );
      }

      const execution = await executeWorkflowApiStep({
        workflow: resolved.workflow,
        step: resolved.step,
        payload: resolved.payload,
        actor: {
          userId: access.identity.userId,
          email: access.identity.email,
          observability: {
            correlationId: obsCtx.correlationId,
            traceId: obsCtx.traceId,
            route: obsCtx.route,
            method: obsCtx.method,
          },
        },
      });

      incrementCounter("ops.incident_workflow.step.total", 1, {
        workflowId: resolved.workflow.id,
        stepId: resolved.step.id,
        ok: execution.ok ? "true" : "false",
      });
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: execution.ok
          ? "ops.incident_workflow.step"
          : "ops.incident_workflow.step.failed",
        detail: execution.ok
          ? `Executed ${resolved.workflow.id}/${resolved.step.id}`
          : `Execution failed for ${resolved.workflow.id}/${resolved.step.id}: ${execution.error ?? "unknown"}`,
        meta: {
          route: "/api/ops/incident-workflow",
          workflowId: resolved.workflow.id,
          stepId: resolved.step.id,
          action: resolved.step.action,
          ok: execution.ok,
        },
      });

      return NextResponse.json({
        ok: execution.ok,
        error: execution.error,
        workflow: execution.workflow,
        step: execution.step,
        result: execution.result,
      });
    }
  );
}
