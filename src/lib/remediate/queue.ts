import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  executeRemediationCommands,
  formatExecutionForLog,
} from "@/lib/remediate/runner";
import {
  isWithinMinutes,
  readRemediationPolicy,
} from "@/lib/remediate/policy";
import {
  readCommandGuardPolicy,
  validateRemediationCommands,
} from "@/lib/remediate/guard";
import { resolveHostRemediationPolicy } from "@/lib/remediate/host-policy";
import {
  computeNextRetryAt,
  computeRetryDelaySeconds,
  parseExecuteRunPayload,
  queueMetaIsReady,
  serializeExecuteRunPayload,
  shouldRetryAttempt,
  truncateQueueErrorMessage,
  type ExecuteRunPayload,
  type QueueRuntimeMeta,
} from "@/lib/remediate/queue-runtime";

type ClaimedRun = {
  id: string;
  hostId: string;
  actionId: string;
  requestedByUserId: string | null;
  requestedAt: Date;
  paramsJson: string | null;
  host: {
    id: string;
    name: string;
    enabled: boolean;
    metaJson: string | null;
  };
  action: {
    key: string;
    title: string;
  };
};

export type QueueDrainResultItem = {
  runId: string;
  hostId: string;
  actionKey: string;
  state:
    | "succeeded"
    | "failed"
    | "canceled"
    | "retry-scheduled"
    | "approval-pending";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: string;
  dlq?: boolean;
  error?: string;
  approvalStatus?: "none" | "pending" | "approved" | "rejected";
  canaryPassed?: boolean | null;
  rollbackAttempted?: boolean;
  rollbackSucceeded?: boolean | null;
  autoQueued?: boolean;
};

export type QueueDrainSummary = {
  ok: boolean;
  requestedLimit: number;
  processed: number;
  items: QueueDrainResultItem[];
};

export type RemediationQueueSnapshotItem = {
  runId: string;
  hostId: string;
  hostName: string;
  actionId: string;
  actionKey: string;
  actionTitle: string;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedByEmail: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  dlq: boolean;
  dlqReason: string | null;
  replayOfRunId: string | null;
  delayed: boolean;
  error: string | null;
  approvalRequired: boolean;
  approvalStatus: "none" | "pending" | "approved" | "rejected";
  approvalReason: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  canaryEnabled: boolean;
  canarySelected: boolean;
  canaryRolloutPercent: number | null;
  canaryBucket: number | null;
  canaryChecks: number;
  canaryPassed: boolean | null;
  rollbackEnabled: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean | null;
  autoQueued: boolean;
  autoTier: string | null;
};

export type RemediationQueueSnapshot = {
  limit: number;
  dlqOnly: boolean;
  counts: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    canceled: number;
    dlq: number;
    retryScheduled: number;
    approvalPending: number;
  };
  items: RemediationQueueSnapshotItem[];
};

export type QueueApprovalUpdateResult = {
  ok: boolean;
  runId: string;
  state?: "queued" | "canceled";
  approvalStatus?: "none" | "pending" | "approved" | "rejected";
  error?: string;
};

export type ReplayRunResult = {
  ok: boolean;
  sourceRunId: string;
  replayRunId?: string;
  error?: string;
};

export type ReplayDeadLetterSummary = {
  ok: boolean;
  requestedLimit: number;
  replayed: number;
  skipped: number;
  items: ReplayRunResult[];
};

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return Math.trunc(v);
}

function toIso(v: Date | null | undefined): string | null {
  if (!v) return null;
  return v.toISOString();
}

function parseIsoToMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

function defaultQueueMeta(maxAttempts: number): QueueRuntimeMeta {
  return {
    version: 1,
    attempts: 0,
    maxAttempts: clamp(maxAttempts, 1, 20),
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastError: null,
    dlq: false,
    dlqReason: null,
    replayOfRunId: null,
    approval: {
      required: false,
      status: "none",
      reason: null,
      requestedAt: null,
      requestedByUserId: null,
      approvedAt: null,
      approvedByUserId: null,
    },
    canary: {
      enabled: false,
      rolloutPercent: 100,
      bucket: 0,
      selected: true,
      checks: [],
      lastCheckedAt: null,
      passed: null,
      error: null,
    },
    rollback: {
      enabled: false,
      attempted: false,
      succeeded: null,
      commands: [],
      lastRunAt: null,
      error: null,
    },
    autoQueued: false,
    autoReason: null,
    autoTier: null,
  };
}

function toPayloadWithDefaults(
  raw: string | null | undefined,
  defaultMaxAttempts: number
): ExecuteRunPayload | null {
  return parseExecuteRunPayload(raw, { defaultMaxAttempts });
}

async function claimNextQueuedRun(now = new Date()): Promise<ClaimedRun | null> {
  for (let i = 0; i < 8; i++) {
    const candidates = await prisma.remediationRun.findMany({
      where: {
        state: "queued",
        paramsJson: { contains: '"mode":"execute"' },
      },
      orderBy: [{ requestedAt: "asc" }],
      take: 80,
      select: {
        id: true,
        paramsJson: true,
      },
    });

    if (candidates.length === 0) return null;

    let nextCandidateId: string | null = null;
    for (const c of candidates) {
      const payload = toPayloadWithDefaults(c.paramsJson, 3);
      if (!payload) {
        nextCandidateId = c.id;
        break;
      }
      if (queueMetaIsReady(payload.queue, now)) {
        nextCandidateId = c.id;
        break;
      }
    }

    if (!nextCandidateId) return null;

    const updated = await prisma.remediationRun.updateMany({
      where: { id: nextCandidateId, state: "queued" },
      data: {
        state: "running",
        startedAt: now,
      },
    });

    if (updated.count !== 1) {
      continue;
    }

    const claimed = await prisma.remediationRun.findUnique({
      where: { id: nextCandidateId },
      select: {
        id: true,
        hostId: true,
        actionId: true,
        requestedByUserId: true,
        requestedAt: true,
        paramsJson: true,
        host: {
          select: {
            id: true,
            name: true,
            enabled: true,
            metaJson: true,
          },
        },
        action: {
          select: {
            key: true,
            title: true,
          },
        },
      },
    });

    if (claimed) return claimed;
  }

  return null;
}

async function updateRun(params: {
  runId: string;
  state: "queued" | "succeeded" | "failed" | "canceled";
  startedAt?: Date | null;
  finishedAt?: Date | null;
  output?: string | null;
  error?: string | null;
  payload?: ExecuteRunPayload;
}) {
  await prisma.remediationRun.update({
    where: { id: params.runId },
    data: {
      state: params.state,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
      output: params.output ?? null,
      error: params.error ?? null,
      paramsJson: params.payload
        ? serializeExecuteRunPayload(params.payload)
        : undefined,
    },
  });
}

async function finishRun(params: {
  runId: string;
  state: "succeeded" | "failed" | "canceled";
  finishedAt: Date;
  output?: string | null;
  error?: string | null;
  payload?: ExecuteRunPayload;
}) {
  await updateRun({
    runId: params.runId,
    state: params.state,
    finishedAt: params.finishedAt,
    output: params.output,
    error: params.error,
    payload: params.payload,
  });
}

async function executeCanaryChecks(input: {
  checks: string[];
  timeoutMs: number;
  maxBufferBytes: number;
}): Promise<{ ok: boolean; output: string; error: string | null }> {
  if (!input.checks.length) {
    return {
      ok: true,
      output: "canary=skipped reason=no_checks",
      error: null,
    };
  }

  try {
    const execution = await executeRemediationCommands(input.checks, {
      timeoutMs: input.timeoutMs,
      maxBufferBytes: input.maxBufferBytes,
    });
    return {
      ok: execution.ok,
      output: formatExecutionForLog(execution),
      error: execution.ok ? null : "Canary validation failed.",
    };
  } catch (err: unknown) {
    return {
      ok: false,
      output: "",
      error: truncateQueueErrorMessage(String(err)),
    };
  }
}

async function runRollbackCommands(input: {
  commands: string[];
  timeoutMs: number;
  maxBufferBytes: number;
}): Promise<{ ok: boolean; output: string; error: string | null }> {
  if (!input.commands.length) {
    return {
      ok: false,
      output: "rollback=skipped reason=no_commands",
      error: "No rollback commands available.",
    };
  }

  try {
    const execution = await executeRemediationCommands(input.commands, {
      timeoutMs: input.timeoutMs,
      maxBufferBytes: input.maxBufferBytes,
    });
    return {
      ok: execution.ok,
      output: formatExecutionForLog(execution),
      error: execution.ok ? null : "Automatic rollback failed.",
    };
  } catch (err: unknown) {
    return {
      ok: false,
      output: "",
      error: truncateQueueErrorMessage(String(err)),
    };
  }
}

export async function drainRemediationQueue(input?: {
  limit?: number;
}): Promise<QueueDrainSummary> {
  const requestedLimit = clamp(input?.limit ?? 5, 1, 50);
  const globalPolicy = readRemediationPolicy();
  const globalGuardPolicy = readCommandGuardPolicy();

  const items: QueueDrainResultItem[] = [];

  for (let i = 0; i < requestedLimit; i++) {
    const run = await claimNextQueuedRun();
    if (!run) break;

    const resolvedPolicy = resolveHostRemediationPolicy({
      metaJson: run.host.metaJson,
      globalPolicy,
      globalGuardPolicy,
    });

    const now = new Date();
    const payload = toPayloadWithDefaults(
      run.paramsJson,
      resolvedPolicy.policy.maxRetryAttempts
    );
    const payloadMeta = payload?.queue ?? defaultQueueMeta(resolvedPolicy.policy.maxRetryAttempts);

    if (!run.host.enabled) {
      const error = "Host is disabled; queued run canceled.";
      await finishRun({
        runId: run.id,
        state: "canceled",
        finishedAt: now,
        error,
        payload: payload ?? undefined,
      });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "canceled",
        attempts: payloadMeta.attempts,
        maxAttempts: payloadMeta.maxAttempts,
        error,
      });
      continue;
    }

    if (!isWithinMinutes(run.requestedAt, resolvedPolicy.policy.queueTtlMinutes)) {
      const error = `Queued run expired (>${resolvedPolicy.policy.queueTtlMinutes}m).`;
      await finishRun({
        runId: run.id,
        state: "canceled",
        finishedAt: now,
        error,
        payload: payload ?? undefined,
      });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "canceled",
        attempts: payloadMeta.attempts,
        maxAttempts: payloadMeta.maxAttempts,
        error,
      });
      continue;
    }

    if (!payload) {
      const error = "Invalid queued execute payload (DLQ).";
      await finishRun({
        runId: run.id,
        state: "failed",
        finishedAt: now,
        error,
      });
      await prisma.auditLog.create({
        data: {
          userId: run.requestedByUserId,
          hostId: run.hostId,
          action: "remediate.execute.dlq",
          detail: `${run.action.key} failed: invalid execute payload`,
          metaJson: JSON.stringify({
            runId: run.id,
            reason: "invalid_payload",
          }),
        },
      });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "failed",
        attempts: 0,
        maxAttempts: resolvedPolicy.policy.maxRetryAttempts,
        dlq: true,
        error,
      });
      continue;
    }

    if (!queueMetaIsReady(payload.queue, now)) {
      await updateRun({
        runId: run.id,
        state: "queued",
        startedAt: null,
        finishedAt: null,
        output: null,
        error: null,
        payload,
      });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state:
          payload.queue.approval.required &&
          payload.queue.approval.status !== "approved"
            ? "approval-pending"
            : "retry-scheduled",
        attempts: payload.queue.attempts,
        maxAttempts: payload.queue.maxAttempts,
        nextAttemptAt: payload.queue.nextAttemptAt ?? undefined,
        approvalStatus: payload.queue.approval.status,
        autoQueued: payload.queue.autoQueued,
      });
      continue;
    }

    if (payload.queue.approval.required && payload.queue.approval.status !== "approved") {
      await updateRun({
        runId: run.id,
        state: "queued",
        startedAt: null,
        finishedAt: null,
        output: null,
        error: "Awaiting operator approval.",
        payload,
      });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "approval-pending",
        attempts: payload.queue.attempts,
        maxAttempts: payload.queue.maxAttempts,
        approvalStatus: payload.queue.approval.status,
        autoQueued: payload.queue.autoQueued,
      });
      continue;
    }

    const validationIssues = validateRemediationCommands(
      payload.commands,
      resolvedPolicy.guardPolicy
    );
    if (validationIssues.length > 0) {
      const issueSummary = validationIssues
        .slice(0, 8)
        .map((v) => `#${v.index}:${v.reason}`)
        .join("; ");
      const error = truncateQueueErrorMessage(
        `Execution blocked by policy at dequeue time: ${issueSummary}`
      );
      payload.queue.dlq = true;
      payload.queue.dlqReason = "policy_blocked";
      payload.queue.lastError = error;
      payload.queue.lastAttemptAt = now.toISOString();
      payload.queue.nextAttemptAt = null;

      await finishRun({
        runId: run.id,
        state: "failed",
        finishedAt: now,
        error,
        payload,
      });
      await prisma.auditLog.create({
        data: {
          userId: run.requestedByUserId,
          hostId: run.hostId,
          action: "remediate.execute.dlq",
          detail: `${run.action.key} blocked by dequeue policy`,
          metaJson: JSON.stringify({
            runId: run.id,
            actionId: payload.actionId,
            reason: "policy_blocked",
            profile: resolvedPolicy.profile,
          }),
        },
      });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "failed",
        attempts: payload.queue.attempts,
        maxAttempts: payload.queue.maxAttempts,
        dlq: true,
        error,
      });
      continue;
    }

    const attemptNumber = payload.queue.attempts + 1;
    let executionOk = false;
    const executionOutputParts: string[] = [];
    let executionError: string | null = null;

    try {
      const execution = await executeRemediationCommands(payload.commands, {
        timeoutMs: resolvedPolicy.policy.commandTimeoutMs,
        maxBufferBytes: resolvedPolicy.policy.maxBufferBytes,
      });
      executionOk = execution.ok;
      executionOutputParts.push(formatExecutionForLog(execution));
      if (!execution.ok) {
        executionError = "One or more remediation commands failed.";
      }
    } catch (err: unknown) {
      executionOk = false;
      executionError = truncateQueueErrorMessage(String(err));
      executionOutputParts.push(`execution_error=${executionError}`);
    }

    payload.queue.attempts = attemptNumber;
    payload.queue.lastAttemptAt = now.toISOString();

    if (executionOk && payload.queue.canary.enabled) {
      const canary = await executeCanaryChecks({
        checks: payload.queue.canary.checks,
        timeoutMs: resolvedPolicy.policy.commandTimeoutMs,
        maxBufferBytes: resolvedPolicy.policy.maxBufferBytes,
      });
      payload.queue.canary.lastCheckedAt = now.toISOString();
      payload.queue.canary.passed = canary.ok;
      payload.queue.canary.error = canary.error;
      executionOutputParts.push(`[canary]\n${canary.output || canary.error || "no output"}`);

      if (!canary.ok) {
        executionOk = false;
        executionError = truncateQueueErrorMessage(
          `Canary validation failed. ${canary.error ?? ""}`.trim()
        );
      }
    }

    if (
      !executionOk &&
      payload.queue.rollback.enabled &&
      payload.queue.rollback.commands.length > 0 &&
      !payload.queue.rollback.attempted
    ) {
      const rollback = await runRollbackCommands({
        commands: payload.queue.rollback.commands,
        timeoutMs: resolvedPolicy.policy.commandTimeoutMs,
        maxBufferBytes: resolvedPolicy.policy.maxBufferBytes,
      });
      payload.queue.rollback.attempted = true;
      payload.queue.rollback.lastRunAt = now.toISOString();
      payload.queue.rollback.succeeded = rollback.ok;
      payload.queue.rollback.error = rollback.error;
      executionOutputParts.push(
        `[auto-rollback]\n${rollback.output || rollback.error || "no output"}`
      );
    }

    const executionOutput = executionOutputParts.join("\n\n");
    payload.queue.lastError = executionError;
    const shouldForceDlq =
      (payload.queue.canary.enabled && payload.queue.canary.passed === false) ||
      payload.queue.rollback.attempted;

    if (executionOk) {
      payload.queue.nextAttemptAt = null;
      payload.queue.dlq = false;
      payload.queue.dlqReason = null;

      await finishRun({
        runId: run.id,
        state: "succeeded",
        finishedAt: now,
        output: executionOutput,
        error: null,
        payload,
      });

      await prisma.auditLog.create({
        data: {
          userId: run.requestedByUserId,
          hostId: run.hostId,
          action: "remediate.execute.dequeued",
          detail: `${run.action.key} succeeded (profile=${resolvedPolicy.profile})`,
          metaJson: JSON.stringify({
            runId: run.id,
            actionId: payload.actionId,
            profile: resolvedPolicy.profile,
            attempts: payload.queue.attempts,
            maxAttempts: payload.queue.maxAttempts,
            queueTtlMinutes: resolvedPolicy.policy.queueTtlMinutes,
            commandTimeoutMs: resolvedPolicy.policy.commandTimeoutMs,
            maxBufferBytes: resolvedPolicy.policy.maxBufferBytes,
            canaryEnabled: payload.queue.canary.enabled,
            canaryPassed: payload.queue.canary.passed,
            autoQueued: payload.queue.autoQueued,
            autoTier: payload.queue.autoTier,
          }),
        },
      });

      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "succeeded",
        attempts: payload.queue.attempts,
        maxAttempts: payload.queue.maxAttempts,
        approvalStatus: payload.queue.approval.status,
        canaryPassed: payload.queue.canary.passed,
        rollbackAttempted: payload.queue.rollback.attempted,
        rollbackSucceeded: payload.queue.rollback.succeeded,
        autoQueued: payload.queue.autoQueued,
      });
      continue;
    }

    if (!shouldForceDlq && shouldRetryAttempt(attemptNumber, payload.queue.maxAttempts)) {
      const delaySeconds = computeRetryDelaySeconds(
        attemptNumber,
        resolvedPolicy.policy.retryBackoffSeconds,
        resolvedPolicy.policy.retryBackoffMaxSeconds
      );
      const nextAttemptAt = computeNextRetryAt(now, delaySeconds);
      payload.queue.nextAttemptAt = nextAttemptAt;
      payload.queue.dlq = false;
      payload.queue.dlqReason = null;

      const retryError = truncateQueueErrorMessage(
        `Retry scheduled (${attemptNumber}/${payload.queue.maxAttempts}) in ${delaySeconds}s. ${executionError ?? "Execution failed."}`
      );

      await updateRun({
        runId: run.id,
        state: "queued",
        startedAt: null,
        finishedAt: null,
        output: executionOutput,
        error: retryError,
        payload,
      });

      await prisma.auditLog.create({
        data: {
          userId: run.requestedByUserId,
          hostId: run.hostId,
          action: "remediate.execute.retry_scheduled",
          detail: `${run.action.key} retry scheduled (${attemptNumber}/${payload.queue.maxAttempts})`,
          metaJson: JSON.stringify({
            runId: run.id,
            actionId: payload.actionId,
            profile: resolvedPolicy.profile,
            attempts: attemptNumber,
            maxAttempts: payload.queue.maxAttempts,
            nextAttemptAt,
            delaySeconds,
            retryBackoffSeconds: resolvedPolicy.policy.retryBackoffSeconds,
            retryBackoffMaxSeconds: resolvedPolicy.policy.retryBackoffMaxSeconds,
            canaryEnabled: payload.queue.canary.enabled,
            autoQueued: payload.queue.autoQueued,
            autoTier: payload.queue.autoTier,
          }),
        },
      });

      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "retry-scheduled",
        attempts: payload.queue.attempts,
        maxAttempts: payload.queue.maxAttempts,
        nextAttemptAt,
        error: executionError ?? undefined,
        approvalStatus: payload.queue.approval.status,
        canaryPassed: payload.queue.canary.passed,
        rollbackAttempted: payload.queue.rollback.attempted,
        rollbackSucceeded: payload.queue.rollback.succeeded,
        autoQueued: payload.queue.autoQueued,
      });
      continue;
    }

    payload.queue.nextAttemptAt = null;
    payload.queue.dlq = true;
    payload.queue.dlqReason = shouldForceDlq
      ? payload.queue.canary.passed === false
        ? "canary_failed"
        : payload.queue.rollback.succeeded === true
        ? "auto_rolled_back"
        : "auto_rollback_failed"
      : "max_attempts_exceeded";

    const dlqError = truncateQueueErrorMessage(
      shouldForceDlq
        ? `Execution failed and moved to DLQ (${payload.queue.dlqReason}). ${executionError ?? "Execution failed."}`
        : `Max retry attempts reached (${attemptNumber}/${payload.queue.maxAttempts}). ${executionError ?? "Execution failed."}`
    );

    await finishRun({
      runId: run.id,
      state: "failed",
      finishedAt: now,
      output: executionOutput,
      error: dlqError,
      payload,
    });

    await prisma.auditLog.create({
      data: {
        userId: run.requestedByUserId,
        hostId: run.hostId,
        action: "remediate.execute.dlq",
        detail: `${run.action.key} moved to DLQ after ${attemptNumber} attempt(s)`,
        metaJson: JSON.stringify({
          runId: run.id,
          actionId: payload.actionId,
          profile: resolvedPolicy.profile,
          attempts: attemptNumber,
          maxAttempts: payload.queue.maxAttempts,
          reason: payload.queue.dlqReason,
          canaryEnabled: payload.queue.canary.enabled,
          canaryPassed: payload.queue.canary.passed,
          rollbackAttempted: payload.queue.rollback.attempted,
          rollbackSucceeded: payload.queue.rollback.succeeded,
          autoQueued: payload.queue.autoQueued,
          autoTier: payload.queue.autoTier,
        }),
      },
    });

    items.push({
      runId: run.id,
      hostId: run.hostId,
      actionKey: run.action.key,
      state: "failed",
      attempts: payload.queue.attempts,
      maxAttempts: payload.queue.maxAttempts,
      dlq: true,
      error: dlqError,
      approvalStatus: payload.queue.approval.status,
      canaryPassed: payload.queue.canary.passed,
      rollbackAttempted: payload.queue.rollback.attempted,
      rollbackSucceeded: payload.queue.rollback.succeeded,
      autoQueued: payload.queue.autoQueued,
    });
  }

  return {
    ok: items.every(
      (x) =>
        x.state === "succeeded" ||
        x.state === "retry-scheduled" ||
        x.state === "approval-pending"
    ),
    requestedLimit,
    processed: items.length,
    items,
  };
}

export async function getRemediationQueueSnapshot(input?: {
  limit?: number;
  dlqOnly?: boolean;
}): Promise<RemediationQueueSnapshot> {
  const limit = clamp(input?.limit ?? 25, 1, 100);
  const dlqOnly = Boolean(input?.dlqOnly);
  const executeWhere: Prisma.RemediationRunWhereInput = {
    paramsJson: { contains: '"mode":"execute"' },
  };
  const executeDlqWhere: Prisma.RemediationRunWhereInput = {
    state: "failed",
    AND: [
      { paramsJson: { contains: '"mode":"execute"' } },
      { paramsJson: { contains: '"dlq":true' } },
    ],
  };

  const [queued, running, succeeded, failed, canceled, dlq, retryScheduled, approvalPending] =
    await Promise.all([
      prisma.remediationRun.count({
        where: { state: "queued", ...executeWhere },
      }),
      prisma.remediationRun.count({
        where: { state: "running", ...executeWhere },
      }),
      prisma.remediationRun.count({
        where: { state: "succeeded", ...executeWhere },
      }),
      prisma.remediationRun.count({
        where: { state: "failed", ...executeWhere },
      }),
      prisma.remediationRun.count({
        where: { state: "canceled", ...executeWhere },
      }),
      prisma.remediationRun.count({
        where: executeDlqWhere,
      }),
      prisma.remediationRun.count({
        where: {
          AND: [
            { state: "queued" },
            { paramsJson: { contains: '"mode":"execute"' } },
            { paramsJson: { contains: '"nextAttemptAt":"' } },
          ],
        },
      }),
      prisma.remediationRun.count({
        where: {
          AND: [
            { state: "queued" },
            { paramsJson: { contains: '"mode":"execute"' } },
            { paramsJson: { contains: '"required":true' } },
            { paramsJson: { contains: '"status":"pending"' } },
          ],
        },
      }),
    ]);

  const rows = await prisma.remediationRun.findMany({
    where: dlqOnly ? executeDlqWhere : executeWhere,
    orderBy: { requestedAt: "desc" },
    take: limit,
    select: {
      id: true,
      hostId: true,
      actionId: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      paramsJson: true,
      error: true,
      host: {
        select: {
          name: true,
        },
      },
      action: {
        select: {
          key: true,
          title: true,
        },
      },
      requestedBy: {
        select: {
          email: true,
        },
      },
    },
  });

  const nowMs = Date.now();
  const items: RemediationQueueSnapshotItem[] = rows.map((row) => {
    const payload = toPayloadWithDefaults(row.paramsJson, 3);
    const queue = payload?.queue ?? defaultQueueMeta(3);
    const nextAttemptMs = parseIsoToMs(queue.nextAttemptAt);
    const delayed = row.state === "queued" && nextAttemptMs !== null && nextAttemptMs > nowMs;

    return {
      runId: row.id,
      hostId: row.hostId,
      hostName: row.host.name,
      actionId: row.actionId,
      actionKey: row.action.key,
      actionTitle: row.action.title,
      state: row.state,
      requestedAt: row.requestedAt.toISOString(),
      startedAt: toIso(row.startedAt),
      finishedAt: toIso(row.finishedAt),
      requestedByEmail: row.requestedBy?.email ?? null,
      attempts: queue.attempts,
      maxAttempts: queue.maxAttempts,
      nextAttemptAt: queue.nextAttemptAt,
      lastAttemptAt: queue.lastAttemptAt,
      lastError: queue.lastError,
      dlq: queue.dlq,
      dlqReason: queue.dlqReason,
      replayOfRunId: queue.replayOfRunId,
      delayed,
      error: row.error,
      approvalRequired: queue.approval.required,
      approvalStatus: queue.approval.status,
      approvalReason: queue.approval.reason,
      approvedAt: queue.approval.approvedAt,
      approvedByUserId: queue.approval.approvedByUserId,
      canaryEnabled: queue.canary.enabled,
      canarySelected: queue.canary.selected,
      canaryRolloutPercent: queue.canary.enabled ? queue.canary.rolloutPercent : null,
      canaryBucket: queue.canary.enabled ? queue.canary.bucket : null,
      canaryChecks: queue.canary.checks.length,
      canaryPassed: queue.canary.passed,
      rollbackEnabled: queue.rollback.enabled,
      rollbackAttempted: queue.rollback.attempted,
      rollbackSucceeded: queue.rollback.succeeded,
      autoQueued: queue.autoQueued,
      autoTier: queue.autoTier,
    };
  });

  return {
    limit,
    dlqOnly,
    counts: {
      queued,
      running,
      succeeded,
      failed,
      canceled,
      dlq,
      retryScheduled,
      approvalPending,
    },
    items,
  };
}

export async function replayRemediationRun(input: {
  runId: string;
  replayedByUserId: string | null;
}): Promise<ReplayRunResult> {
  const runId = input.runId.trim();
  if (!runId) {
    return { ok: false, sourceRunId: "", error: "runId is required" };
  }

  const source = await prisma.remediationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      hostId: true,
      actionId: true,
      requestedByUserId: true,
      state: true,
      finishedAt: true,
      error: true,
      paramsJson: true,
      action: {
        select: {
          key: true,
        },
      },
    },
  });

  if (!source) {
    return { ok: false, sourceRunId: runId, error: "Source run not found" };
  }

  if (source.state === "queued" || source.state === "running") {
    return {
      ok: false,
      sourceRunId: source.id,
      error: "Source run is still active and cannot be replayed",
    };
  }

  const policy = readRemediationPolicy();
  const payload = toPayloadWithDefaults(source.paramsJson, policy.maxRetryAttempts);
  if (!payload) {
    return {
      ok: false,
      sourceRunId: source.id,
      error: "Source run payload is not replayable",
    };
  }

  const activeForAction = await prisma.remediationRun.count({
    where: {
      hostId: source.hostId,
      actionId: source.actionId,
      state: { in: ["queued", "running"] },
      paramsJson: { contains: '"mode":"execute"' },
    },
  });
  if (activeForAction > 0) {
    return {
      ok: false,
      sourceRunId: source.id,
      error: "An active run for this host/action already exists",
    };
  }

  const replayPayload: ExecuteRunPayload = {
    ...payload,
    queue: {
      ...payload.queue,
      attempts: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastError: null,
      dlq: false,
      dlqReason: null,
      replayOfRunId: source.id,
    },
  };

  const replayRun = await prisma.$transaction(async (tx) => {
    const created = await tx.remediationRun.create({
      data: {
        hostId: source.hostId,
        actionId: source.actionId,
        requestedByUserId: input.replayedByUserId ?? source.requestedByUserId,
        state: "queued",
        startedAt: null,
        finishedAt: null,
        paramsJson: serializeExecuteRunPayload(replayPayload),
        output: null,
        error: null,
      },
      select: {
        id: true,
      },
    });

    // DLQ source runs are considered reviewed once replay has been queued.
    if (source.state === "failed" && payload.queue.dlq) {
      const resolvedSourcePayload: ExecuteRunPayload = {
        ...payload,
        queue: {
          ...payload.queue,
          dlq: false,
          dlqReason: "replayed",
          nextAttemptAt: null,
        },
      };
      const replayMarker = `[queue] replayed_as=${created.id}`;
      const nextError = source.error
        ? truncateQueueErrorMessage(
            source.error.includes(replayMarker)
              ? source.error
              : `${source.error}\n${replayMarker}`
          )
        : replayMarker;

      await tx.remediationRun.update({
        where: { id: source.id },
        data: {
          state: "canceled",
          finishedAt: source.finishedAt ?? new Date(),
          paramsJson: serializeExecuteRunPayload(resolvedSourcePayload),
          error: nextError,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: input.replayedByUserId,
        hostId: source.hostId,
        action: "remediate.execute.replay_queued",
        detail: `Replayed queued run ${source.id} -> ${created.id}`,
        metaJson: JSON.stringify({
          sourceRunId: source.id,
          replayRunId: created.id,
          actionKey: source.action.key,
        }),
      },
    });

    return created;
  });

  return {
    ok: true,
    sourceRunId: source.id,
    replayRunId: replayRun.id,
  };
}

export async function replayDeadLetterRuns(input?: {
  limit?: number;
  replayedByUserId?: string | null;
}): Promise<ReplayDeadLetterSummary> {
  const requestedLimit = clamp(input?.limit ?? 5, 1, 50);
  const rows = await prisma.remediationRun.findMany({
    where: {
      state: "failed",
      AND: [
        { paramsJson: { contains: '"mode":"execute"' } },
        { paramsJson: { contains: '"dlq":true' } },
      ],
    },
    orderBy: { requestedAt: "asc" },
    take: requestedLimit,
    select: {
      id: true,
    },
  });

  const items: ReplayRunResult[] = [];
  for (const row of rows) {
    const replay = await replayRemediationRun({
      runId: row.id,
      replayedByUserId: input?.replayedByUserId ?? null,
    });
    items.push(replay);
  }

  return {
    ok: items.every((x) => x.ok),
    requestedLimit,
    replayed: items.filter((x) => x.ok).length,
    skipped: items.filter((x) => !x.ok).length,
    items,
  };
}

export async function setRemediationRunApproval(input: {
  runId: string;
  actorUserId: string | null;
  mode: "approve" | "reject";
  reason?: string | null;
}): Promise<QueueApprovalUpdateResult> {
  const runId = input.runId.trim();
  if (!runId) {
    return {
      ok: false,
      runId: "",
      error: "runId is required",
    };
  }

  const run = await prisma.remediationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      hostId: true,
      actionId: true,
      state: true,
      requestedByUserId: true,
      paramsJson: true,
      action: {
        select: {
          key: true,
        },
      },
    },
  });
  if (!run) {
    return { ok: false, runId, error: "Run not found" };
  }

  if (run.state !== "queued") {
    return {
      ok: false,
      runId,
      error: "Only queued runs can be approved or rejected",
    };
  }

  const policy = readRemediationPolicy();
  const payload = toPayloadWithDefaults(run.paramsJson, policy.maxRetryAttempts);
  if (!payload) {
    return {
      ok: false,
      runId,
      error: "Run payload is invalid",
    };
  }

  if (!payload.queue.approval.required) {
    return {
      ok: false,
      runId,
      error: "Run does not require approval",
    };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const reason = truncateQueueErrorMessage(
    (input.reason ?? "").trim() || (input.mode === "approve" ? "approved" : "rejected")
  );
  payload.queue.approval.reason = reason;
  payload.queue.approval.approvedAt = nowIso;
  payload.queue.approval.approvedByUserId = input.actorUserId ?? null;

  if (input.mode === "approve") {
    payload.queue.approval.status = "approved";
    payload.queue.nextAttemptAt = null;
    payload.queue.lastError = null;

    await prisma.$transaction([
      prisma.remediationRun.update({
        where: { id: run.id },
        data: {
          state: "queued",
          startedAt: null,
          finishedAt: null,
          error: null,
          paramsJson: serializeExecuteRunPayload(payload),
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: input.actorUserId,
          hostId: run.hostId,
          action: "remediate.execute.approval_granted",
          detail: `Approval granted for queued run ${run.id} (${run.action.key})`,
          metaJson: JSON.stringify({
            runId: run.id,
            actionId: run.actionId,
            actionKey: run.action.key,
            reason,
          }),
        },
      }),
    ]);

    return {
      ok: true,
      runId: run.id,
      state: "queued",
      approvalStatus: "approved",
    };
  }

  payload.queue.approval.status = "rejected";
  payload.queue.nextAttemptAt = null;
  payload.queue.lastError = reason;

  await prisma.$transaction([
    prisma.remediationRun.update({
      where: { id: run.id },
      data: {
        state: "canceled",
        startedAt: null,
        finishedAt: now,
        output: null,
        error: `Rejected by operator: ${reason}`,
        paramsJson: serializeExecuteRunPayload(payload),
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: input.actorUserId,
        hostId: run.hostId,
        action: "remediate.execute.approval_rejected",
        detail: `Approval rejected for queued run ${run.id} (${run.action.key})`,
        metaJson: JSON.stringify({
          runId: run.id,
          actionId: run.actionId,
          actionKey: run.action.key,
          reason,
        }),
      },
    }),
  ]);

  return {
    ok: true,
    runId: run.id,
    state: "canceled",
    approvalStatus: "rejected",
  };
}
