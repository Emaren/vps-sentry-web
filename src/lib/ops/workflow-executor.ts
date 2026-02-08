import { readFile } from "node:fs/promises";
import { dispatchNotifyTest, inferNotifyKindFromTarget, type NotifyKind } from "@/lib/notify";
import { drainRemediationQueue, replayDeadLetterRuns } from "@/lib/remediate/queue";
import {
  getIncidentWorkflowById,
  getIncidentWorkflowStepById,
  type IncidentWorkflow,
  type IncidentWorkflowStep,
} from "@/lib/ops/workflows";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";

export type WorkflowExecutionObservability = {
  correlationId?: string | null;
  traceId?: string | null;
  route?: string | null;
  method?: string | null;
};

export type WorkflowActor = {
  userId: string;
  email: string;
  observability?: WorkflowExecutionObservability;
};

export type WorkflowStepResolution =
  | {
      ok: true;
      workflow: IncidentWorkflow;
      step: IncidentWorkflowStep;
      payload: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type WorkflowExecutionResult = {
  ok: boolean;
  error?: string;
  workflow: {
    id: string;
    title: string;
    severity: IncidentWorkflow["severity"];
  };
  step: {
    id: string;
    title: string;
    action: IncidentWorkflowStep["action"] | null;
    kind: IncidentWorkflowStep["kind"];
  };
  result: unknown;
};

function trimString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

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

export function inspectWorkflowStepResult(result: unknown): { ok: boolean; error?: string } {
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

export async function readStatusSnapshot() {
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
      parsed.auth && typeof parsed.auth === "object" && !Array.isArray(parsed.auth)
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
          typeof auth.ssh_failed_password === "number" && Number.isFinite(auth.ssh_failed_password)
            ? auth.ssh_failed_password
            : 0,
        sshInvalidUser:
          typeof auth.ssh_invalid_user === "number" && Number.isFinite(auth.ssh_invalid_user)
            ? auth.ssh_invalid_user
            : 0,
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

export function resolveWorkflowStepInput(input: {
  workflowId: unknown;
  stepId: unknown;
  payload?: unknown;
}): WorkflowStepResolution {
  const workflowId = trimString(input.workflowId);
  const stepId = trimString(input.stepId);
  if (!workflowId || !stepId) {
    return {
      ok: false,
      status: 400,
      error: "workflowId and stepId are required",
    };
  }

  const workflow = getIncidentWorkflowById(workflowId);
  if (!workflow) {
    return { ok: false, status: 404, error: "Unknown workflowId" };
  }

  const step = getIncidentWorkflowStepById(workflow, stepId);
  if (!step) {
    return { ok: false, status: 404, error: "Unknown stepId for workflow" };
  }

  const payload =
    input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? (input.payload as Record<string, unknown>)
      : {};

  const mergedPayload = {
    ...(step.defaultPayload ?? {}),
    ...payload,
  };

  return {
    ok: true,
    workflow,
    step,
    payload: mergedPayload,
  };
}

export async function executeWorkflowApiStep(input: {
  workflow: IncidentWorkflow;
  step: IncidentWorkflowStep;
  payload: Record<string, unknown>;
  actor: WorkflowActor;
}): Promise<WorkflowExecutionResult> {
  const { workflow, step, payload, actor } = input;

  const baseResult = {
    workflow: {
      id: workflow.id,
      title: workflow.title,
      severity: workflow.severity,
    },
    step: {
      id: step.id,
      title: step.title,
      action: step.action ?? null,
      kind: step.kind,
    },
  };

  if (step.kind !== "api" || !step.action) {
    return {
      ...baseResult,
      ok: false,
      error: "Step is manual-only and cannot be executed by API",
      result: null,
    };
  }

  let result: unknown;
  if (step.action === "status-snapshot") {
    result = await readStatusSnapshot();
  } else if (step.action === "drain-queue") {
    const limit = parsePositiveInt(payload.limit, 5, 1, 50);
    result = await drainRemediationQueue({ limit });
  } else if (step.action === "replay-dlq") {
    const limit = parsePositiveInt(payload.limit, 3, 1, 50);
    result = await replayDeadLetterRuns({
      limit,
      replayedByUserId: actor.userId,
    });
  } else if (step.action === "notify-test") {
    const target = typeof payload.target === "string" ? payload.target.trim() : "";
    const normalizedKind = normalizeNotifyKind(payload.kind);
    const inferredKind = target ? inferNotifyKindFromTarget(target) : null;

    result = await dispatchNotifyTest({
      userId: actor.userId,
      requestedByEmail: actor.email,
      hostId: typeof payload.hostId === "string" ? payload.hostId : null,
      kind: normalizedKind ?? inferredKind,
      target: target || null,
      title: typeof payload.title === "string" ? payload.title : null,
      detail: typeof payload.detail === "string" ? payload.detail : null,
      observability: actor.observability,
    });
  } else {
    return {
      ...baseResult,
      ok: false,
      error: "Unsupported workflow step action",
      result: null,
    };
  }

  const stepState = inspectWorkflowStepResult(result);
  return {
    ...baseResult,
    ok: stepState.ok,
    error: stepState.error,
    result,
  };
}
