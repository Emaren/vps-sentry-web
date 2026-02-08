import { prisma } from "@/lib/prisma";
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

type ExecuteRunParams = {
  mode: "execute";
  actionId: string;
  commands: string[];
  sourceCodes: string[];
  rollbackNotes: string[];
};

type ClaimedRun = {
  id: string;
  hostId: string;
  actionId: string;
  requestedByUserId: string | null;
  requestedAt: Date;
  paramsJson: string | null;
  host: {
    id: string;
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
  state: "succeeded" | "failed" | "canceled";
  error?: string;
};

export type QueueDrainSummary = {
  ok: boolean;
  requestedLimit: number;
  processed: number;
  items: QueueDrainResultItem[];
};

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return Math.trunc(v);
}

function safeParseJson<T = unknown>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseExecuteRunParams(raw: string | null | undefined): ExecuteRunParams | null {
  const parsed = safeParseJson<Record<string, unknown>>(raw);
  if (!parsed || parsed.mode !== "execute") return null;

  const actionId = typeof parsed.actionId === "string" ? parsed.actionId.trim() : "";
  const commandsRaw = Array.isArray(parsed.commands) ? parsed.commands : [];
  const sourceCodesRaw = Array.isArray(parsed.sourceCodes) ? parsed.sourceCodes : [];
  const rollbackRaw = Array.isArray(parsed.rollbackNotes) ? parsed.rollbackNotes : [];

  const commands = commandsRaw.filter((v): v is string => typeof v === "string");
  const sourceCodes = sourceCodesRaw.filter((v): v is string => typeof v === "string");
  const rollbackNotes = rollbackRaw.filter((v): v is string => typeof v === "string");

  if (!actionId || commands.length === 0) return null;

  return {
    mode: "execute",
    actionId,
    commands,
    sourceCodes,
    rollbackNotes,
  };
}

async function claimNextQueuedRun(): Promise<ClaimedRun | null> {
  for (let i = 0; i < 8; i++) {
    const next = await prisma.remediationRun.findFirst({
      where: {
        state: "queued",
        paramsJson: { contains: '"mode":"execute"' },
      },
      orderBy: [{ requestedAt: "asc" }],
      select: { id: true },
    });

    if (!next) return null;

    const now = new Date();
    const updated = await prisma.remediationRun.updateMany({
      where: { id: next.id, state: "queued" },
      data: {
        state: "running",
        startedAt: now,
      },
    });

    if (updated.count !== 1) {
      continue;
    }

    const claimed = await prisma.remediationRun.findUnique({
      where: { id: next.id },
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

async function finishRun(params: {
  runId: string;
  state: "succeeded" | "failed" | "canceled";
  output?: string | null;
  error?: string | null;
}) {
  await prisma.remediationRun.update({
    where: { id: params.runId },
    data: {
      state: params.state,
      finishedAt: new Date(),
      output: params.output ?? null,
      error: params.error ?? null,
    },
  });
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

    if (!run.host.enabled) {
      const error = "Host is disabled; queued run canceled.";
      await finishRun({ runId: run.id, state: "canceled", error });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "canceled",
        error,
      });
      continue;
    }

    if (!isWithinMinutes(run.requestedAt, resolvedPolicy.policy.queueTtlMinutes)) {
      const error = `Queued run expired (>${resolvedPolicy.policy.queueTtlMinutes}m).`;
      await finishRun({ runId: run.id, state: "canceled", error });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "canceled",
        error,
      });
      continue;
    }

    const params = parseExecuteRunParams(run.paramsJson);
    if (!params) {
      const error = "Invalid queued execute payload.";
      await finishRun({ runId: run.id, state: "failed", error });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "failed",
        error,
      });
      continue;
    }

    const validationIssues = validateRemediationCommands(
      params.commands,
      resolvedPolicy.guardPolicy
    );
    if (validationIssues.length > 0) {
      const issueSummary = validationIssues
        .slice(0, 8)
        .map((v) => `#${v.index}:${v.reason}`)
        .join("; ");
      const error = `Execution blocked by policy at dequeue time: ${issueSummary}`;
      await finishRun({ runId: run.id, state: "failed", error });
      items.push({
        runId: run.id,
        hostId: run.hostId,
        actionKey: run.action.key,
        state: "failed",
        error,
      });
      continue;
    }

    let executionOk = false;
    let executionOutput = "";
    let executionError: string | null = null;

    try {
      const execution = await executeRemediationCommands(params.commands, {
        timeoutMs: resolvedPolicy.policy.commandTimeoutMs,
        maxBufferBytes: resolvedPolicy.policy.maxBufferBytes,
      });
      executionOk = execution.ok;
      executionOutput = formatExecutionForLog(execution);
      if (!execution.ok) {
        executionError = "One or more remediation commands failed.";
      }
    } catch (err: unknown) {
      executionOk = false;
      executionError = String(err);
      executionOutput = `execution_error=${executionError}`;
    }

    const finalState: "succeeded" | "failed" = executionOk ? "succeeded" : "failed";

    await finishRun({
      runId: run.id,
      state: finalState,
      output: executionOutput,
      error: executionError,
    });

    await prisma.auditLog.create({
      data: {
        userId: run.requestedByUserId,
        hostId: run.hostId,
        action: "remediate.execute.dequeued",
        detail: `${run.action.key} ${finalState} (profile=${resolvedPolicy.profile})`,
        metaJson: JSON.stringify({
          runId: run.id,
          actionId: params.actionId,
          profile: resolvedPolicy.profile,
          queueTtlMinutes: resolvedPolicy.policy.queueTtlMinutes,
          commandTimeoutMs: resolvedPolicy.policy.commandTimeoutMs,
          maxBufferBytes: resolvedPolicy.policy.maxBufferBytes,
        }),
      },
    });

    items.push({
      runId: run.id,
      hostId: run.hostId,
      actionKey: run.action.key,
      state: finalState,
      error: executionError ?? undefined,
    });
  }

  return {
    ok: items.every((x) => x.state === "succeeded"),
    requestedLimit,
    processed: items.length,
    items,
  };
}
