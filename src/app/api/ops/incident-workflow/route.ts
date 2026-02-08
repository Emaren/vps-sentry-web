import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { requireAdminAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { drainRemediationQueue } from "@/lib/remediate/queue";
import {
  INCIDENT_WORKFLOWS,
  getIncidentWorkflowById,
  getIncidentWorkflowStepById,
} from "@/lib/ops/workflows";
import { dispatchNotifyTest, inferNotifyKindFromTarget, type NotifyKind } from "@/lib/notify";

export const dynamic = "force-dynamic";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";

function parsePositiveInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function normalizeNotifyKind(v: unknown): NotifyKind | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  if (t === "EMAIL" || t === "WEBHOOK") return t;
  return null;
}

function inspectStepResult(result: unknown): { ok: boolean; error?: string } {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { ok: true };
  }

  const record = result as Record<string, unknown>;
  if (typeof record.ok === "boolean" && !record.ok) {
    const error =
      typeof record.error === "string" && record.error.trim()
        ? record.error
        : typeof record.detail === "string" && record.detail.trim()
        ? record.detail
        : "Workflow step reported failure";

    return { ok: false, error };
  }

  return { ok: true };
}

async function readStatusSnapshot() {
  try {
    const raw = await readFile(STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const alertsCount =
      typeof parsed.alerts_count === "number" && Number.isFinite(parsed.alerts_count)
        ? parsed.alerts_count
        : Array.isArray(parsed.alerts)
        ? parsed.alerts.length
        : 0;

    const publicPortsCount =
      typeof parsed.public_ports_count === "number" && Number.isFinite(parsed.public_ports_count)
        ? parsed.public_ports_count
        : Array.isArray(parsed.ports_public)
        ? parsed.ports_public.length
        : 0;

    const auth =
      parsed.auth && typeof parsed.auth === "object"
        ? (parsed.auth as Record<string, unknown>)
        : {};

    return {
      ok: true as const,
      summary: {
        host: typeof parsed.host === "string" ? parsed.host : null,
        ts: typeof parsed.ts === "string" ? parsed.ts : null,
        version: typeof parsed.version === "string" ? parsed.version : null,
        alertsCount,
        publicPortsCount,
        sshFailedPassword:
          typeof auth.ssh_failed_password === "number" ? auth.ssh_failed_password : 0,
        sshInvalidUser:
          typeof auth.ssh_invalid_user === "number" ? auth.ssh_invalid_user : 0,
      },
      status: parsed,
    };
  } catch (err: unknown) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "ops.incident_workflow.list.denied",
      detail: `status=${access.status} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/ops/incident-workflow",
        status: access.status,
      },
    });
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    action: "ops.incident_workflow.list",
    detail: "Incident workflow catalog viewed",
    meta: { route: "/api/ops/incident-workflow", count: INCIDENT_WORKFLOWS.length },
  });

  return NextResponse.json({
    ok: true,
    workflows: INCIDENT_WORKFLOWS,
  });
}

export async function POST(req: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "ops.incident_workflow.step.denied",
      detail: `status=${access.status} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/ops/incident-workflow",
        status: access.status,
      },
    });
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const body = await req.json().catch(() => ({}));
  const workflowId = typeof body?.workflowId === "string" ? body.workflowId.trim() : "";
  const stepId = typeof body?.stepId === "string" ? body.stepId.trim() : "";
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  if (!workflowId || !stepId) {
    return NextResponse.json(
      { ok: false, error: "workflowId and stepId are required" },
      { status: 400 }
    );
  }

  const workflow = getIncidentWorkflowById(workflowId);
  if (!workflow) {
    return NextResponse.json({ ok: false, error: "Unknown workflowId" }, { status: 404 });
  }

  const step = getIncidentWorkflowStepById(workflow, stepId);
  if (!step) {
    return NextResponse.json({ ok: false, error: "Unknown stepId for workflow" }, { status: 404 });
  }

  if (step.kind !== "api" || !step.action) {
    return NextResponse.json(
      {
        ok: false,
        error: "Step is manual-only and cannot be executed by API",
      },
      { status: 400 }
    );
  }

  const mergedPayload = {
    ...(step.defaultPayload ?? {}),
    ...(payload as Record<string, unknown>),
  };

  let result: unknown;

  if (step.action === "status-snapshot") {
    result = await readStatusSnapshot();
  } else if (step.action === "drain-queue") {
    const limit = parsePositiveInt(mergedPayload.limit, 5, 1, 50);
    result = await drainRemediationQueue({ limit });
  } else if (step.action === "notify-test") {
    const target = typeof mergedPayload.target === "string" ? mergedPayload.target.trim() : "";
    const normalizedKind = normalizeNotifyKind(mergedPayload.kind);
    const inferredKind = target ? inferNotifyKindFromTarget(target) : null;

    result = await dispatchNotifyTest({
      userId: access.identity.userId,
      requestedByEmail: access.identity.email,
      hostId: typeof mergedPayload.hostId === "string" ? mergedPayload.hostId : null,
      kind: normalizedKind ?? inferredKind,
      target: target || null,
      title: typeof mergedPayload.title === "string" ? mergedPayload.title : null,
      detail: typeof mergedPayload.detail === "string" ? mergedPayload.detail : null,
    });
  } else {
    return NextResponse.json({ ok: false, error: "Unsupported workflow step action" }, { status: 400 });
  }

  const resultState = inspectStepResult(result);

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    action: resultState.ok ? "ops.incident_workflow.step" : "ops.incident_workflow.step.failed",
    detail: resultState.ok
      ? `Executed ${workflow.id}/${step.id}`
      : `Execution failed for ${workflow.id}/${step.id}: ${resultState.error ?? "unknown"}`,
    meta: {
      route: "/api/ops/incident-workflow",
      workflowId: workflow.id,
      stepId: step.id,
      action: step.action,
      ok: resultState.ok,
    },
  });

  return NextResponse.json({
    ok: resultState.ok,
    error: resultState.error,
    workflow: {
      id: workflow.id,
      title: workflow.title,
      severity: workflow.severity,
    },
    step: {
      id: step.id,
      title: step.title,
      action: step.action,
    },
    result,
  });
}
