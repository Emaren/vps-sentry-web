import { prisma } from "@/lib/prisma";
import { buildRemediationPlanFromSnapshots } from "@/lib/remediate";
import type { RemediationAction } from "@/lib/remediate/actions";
import {
  canaryPercentForTier,
  isAutoExecutableTier,
  riskRequiresApproval,
  shouldSelectCanary,
} from "@/lib/remediate/autonomous";
import {
  readCommandGuardPolicy,
  validateRemediationCommands,
} from "@/lib/remediate/guard";
import { resolveHostRemediationPolicy } from "@/lib/remediate/host-policy";
import { isWithinMinutes, readRemediationPolicy } from "@/lib/remediate/policy";
import { drainRemediationQueue } from "@/lib/remediate/queue";
import { readHostFleetPolicyConfig } from "@/lib/remediate/fleet-policy";
import {
  serializeExecuteRunPayload,
  type ExecuteRunPayload,
} from "@/lib/remediate/queue-runtime";

function safeParseRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeCommandList(input: string[] | undefined): string[] {
  if (!input?.length) return [];
  return input
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
    .slice(0, 20);
}

export type AutonomousQueueDecisionState =
  | "queued"
  | "approval_pending"
  | "skipped";

export type AutonomousQueueDecision = {
  actionId: string;
  actionTitle: string;
  autoTier: string;
  risk: string;
  state: AutonomousQueueDecisionState;
  reason: string;
  runId: string | null;
  approvalRequired: boolean;
  approvalStatus: "none" | "pending";
  canaryRolloutPercent: number;
  canaryBucket: number | null;
  canarySelected: boolean;
  canaryEnabled: boolean;
  rollbackEnabled: boolean;
};

export type AutonomousQueueSummary = {
  ok: boolean;
  hostId: string;
  hostName: string | null;
  profile: string | null;
  autonomousEnabled: boolean;
  evaluated: number;
  queued: number;
  approvalPending: number;
  skipped: number;
  queueAutoDrainTriggered: boolean;
  items: AutonomousQueueDecision[];
  error?: string;
};

function skipDecision(action: RemediationAction, reason: string): AutonomousQueueDecision {
  return {
    actionId: action.id,
    actionTitle: action.title,
    autoTier: action.autoTier,
    risk: action.risk,
    state: "skipped",
    reason,
    runId: null,
    approvalRequired: false,
    approvalStatus: "none",
    canaryRolloutPercent: 0,
    canaryBucket: null,
    canarySelected: false,
    canaryEnabled: false,
    rollbackEnabled: false,
  };
}

function approvalReasonForAction(input: {
  action: RemediationAction;
  threshold: string;
}): string {
  if (input.action.autoTier === "risky_manual") {
    return "Risky tier action requires manual approval before execute.";
  }
  return `Action risk '${input.action.risk}' crossed approval threshold '${input.threshold}'.`;
}

export async function queueAutonomousRemediationForHost(input: {
  hostId: string;
  reason?: string;
  snapshotsLimit?: number;
}): Promise<AutonomousQueueSummary> {
  const hostId = input.hostId.trim();
  if (!hostId) {
    return {
      ok: false,
      hostId: "",
      hostName: null,
      profile: null,
      autonomousEnabled: false,
      evaluated: 0,
      queued: 0,
      approvalPending: 0,
      skipped: 0,
      queueAutoDrainTriggered: false,
      items: [],
      error: "hostId is required",
    };
  }

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      id: true,
      userId: true,
      name: true,
      enabled: true,
      metaJson: true,
    },
  });

  if (!host) {
    return {
      ok: false,
      hostId,
      hostName: null,
      profile: null,
      autonomousEnabled: false,
      evaluated: 0,
      queued: 0,
      approvalPending: 0,
      skipped: 0,
      queueAutoDrainTriggered: false,
      items: [],
      error: "Host not found",
    };
  }

  const globalPolicy = readRemediationPolicy();
  const globalGuardPolicy = readCommandGuardPolicy();
  const resolved = resolveHostRemediationPolicy({
    metaJson: host.metaJson,
    globalPolicy,
    globalGuardPolicy,
  });
  const fleet = readHostFleetPolicyConfig(host.metaJson);

  if (!host.enabled || !resolved.policy.autonomousEnabled || fleet.rolloutPaused) {
    return {
      ok: true,
      hostId: host.id,
      hostName: host.name,
      profile: resolved.profile,
      autonomousEnabled: false,
      evaluated: 0,
      queued: 0,
      approvalPending: 0,
      skipped: 0,
      queueAutoDrainTriggered: false,
      items: [],
    };
  }

  const snapshotsLimit = Number.isFinite(input.snapshotsLimit)
    ? Math.max(10, Math.min(Math.trunc(input.snapshotsLimit ?? 40), 120))
    : 40;

  const snapshots = await prisma.hostSnapshot.findMany({
    where: { hostId: host.id },
    orderBy: { ts: "desc" },
    take: snapshotsLimit,
    select: {
      id: true,
      ts: true,
      statusJson: true,
    },
  });

  const parsedSnapshots = snapshots
    .map((snap) => ({ id: snap.id, ts: snap.ts, status: safeParseRecord(snap.statusJson) }))
    .filter(
      (x): x is { id: string; ts: Date; status: Record<string, unknown> } =>
        Boolean(x.status)
    );

  const plan = buildRemediationPlanFromSnapshots(parsedSnapshots, {
    dedupeWindowMinutes: resolved.policy.timelineDedupeWindowMinutes,
  });

  if (!plan.actions.length) {
    return {
      ok: true,
      hostId: host.id,
      hostName: host.name,
      profile: resolved.profile,
      autonomousEnabled: true,
      evaluated: 0,
      queued: 0,
      approvalPending: 0,
      skipped: 0,
      queueAutoDrainTriggered: false,
      items: [],
    };
  }

  const executeFilter = { paramsJson: { contains: '"mode":"execute"' } };
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [hostActiveExecute, globalQueuedExecute, hostAutoQueuedHour, hostExecuteHour] =
    await Promise.all([
      prisma.remediationRun.count({
        where: {
          hostId: host.id,
          state: { in: ["queued", "running"] },
          ...executeFilter,
        },
      }),
      prisma.remediationRun.count({
        where: {
          state: "queued",
          ...executeFilter,
        },
      }),
      prisma.remediationRun.count({
        where: {
          hostId: host.id,
          requestedAt: { gte: oneHourAgo },
          AND: [executeFilter, { paramsJson: { contains: '"autoQueued":true' } }],
        },
      }),
      prisma.remediationRun.count({
        where: {
          hostId: host.id,
          requestedAt: { gte: oneHourAgo },
          ...executeFilter,
        },
      }),
    ]);

  let activeForHost = hostActiveExecute;
  let queuedGlobal = globalQueuedExecute;
  let queuedAutoHour = hostAutoQueuedHour;
  let executeInHour = hostExecuteHour;
  let queuedNow = 0;
  let approvalPending = 0;

  const decisions: AutonomousQueueDecision[] = [];

  for (const action of plan.actions) {
    if (queuedNow >= resolved.policy.autonomousMaxQueuedPerCycle) {
      decisions.push(skipDecision(action, "autonomous cycle limit reached"));
      continue;
    }

    if (action.autoTier === "observe") {
      decisions.push(skipDecision(action, "observe tier only (no execute)"));
      continue;
    }

    if (!isAutoExecutableTier(action.autoTier, resolved.policy.autonomousMaxTier)) {
      decisions.push(
        skipDecision(
          action,
          `action tier '${action.autoTier}' is above max '${resolved.policy.autonomousMaxTier}'`
        )
      );
      continue;
    }

    if (queuedAutoHour >= resolved.policy.autonomousMaxQueuedPerHour) {
      decisions.push(skipDecision(action, "autonomous hourly queue limit reached"));
      continue;
    }

    if (executeInHour >= resolved.policy.maxExecutePerHour) {
      decisions.push(skipDecision(action, "execute hourly rate limit reached"));
      continue;
    }

    if (activeForHost >= resolved.policy.maxQueuePerHost) {
      decisions.push(skipDecision(action, "host queue backlog limit reached"));
      continue;
    }

    if (queuedGlobal >= resolved.policy.maxQueueTotal) {
      decisions.push(skipDecision(action, "global queue backlog limit reached"));
      continue;
    }

    const activeForAction = await prisma.remediationRun.count({
      where: {
        hostId: host.id,
        state: { in: ["queued", "running"] },
        action: { key: action.id },
        ...executeFilter,
      },
    });
    if (activeForAction > 0) {
      decisions.push(skipDecision(action, "active run already exists for this action"));
      continue;
    }

    const latestRunForAction = await prisma.remediationRun.findFirst({
      where: {
        hostId: host.id,
        action: { key: action.id },
        ...executeFilter,
      },
      orderBy: { requestedAt: "desc" },
      select: {
        requestedAt: true,
      },
    });
    if (
      latestRunForAction &&
      resolved.policy.executeCooldownMinutes > 0 &&
      isWithinMinutes(
        latestRunForAction.requestedAt,
        resolved.policy.executeCooldownMinutes
      )
    ) {
      decisions.push(
        skipDecision(
          action,
          `execute cooldown active (${resolved.policy.executeCooldownMinutes}m)`
        )
      );
      continue;
    }

    const guardIssues = validateRemediationCommands(action.commands, resolved.guardPolicy);
    if (guardIssues.length > 0) {
      const firstIssue = guardIssues[0];
      decisions.push(
        skipDecision(action, `guard blocked command #${firstIssue.index}: ${firstIssue.reason}`)
      );
      continue;
    }

    const canaryChecks = normalizeCommandList(action.canaryChecks);
    const canaryRolloutPercent = canaryPercentForTier(
      action.autoTier,
      resolved.policy.canaryRolloutPercent
    );
    const { bucket: canaryBucket, selected: canarySelected } = shouldSelectCanary(
      host.id,
      action.id,
      canaryRolloutPercent
    );
    if (!canarySelected) {
      decisions.push(skipDecision(action, "outside canary rollout bucket"));
      continue;
    }

    if (resolved.policy.canaryRequireChecks && canaryChecks.length === 0) {
      decisions.push(skipDecision(action, "canary checks required but action defines none"));
      continue;
    }

    const approvalRequired =
      action.autoTier === "risky_manual" ||
      riskRequiresApproval(action.risk, resolved.policy.approvalRiskThreshold);
    const approvalReason = approvalRequired
      ? approvalReasonForAction({
          action,
          threshold: resolved.policy.approvalRiskThreshold,
        })
      : null;

    const rollbackCommands = normalizeCommandList(action.rollbackCommands);
    const rollbackEnabled =
      resolved.policy.autoRollback && rollbackCommands.length > 0;
    const now = new Date();
    const nowIso = now.toISOString();

    const payload: ExecuteRunPayload = {
      mode: "execute",
      actionId: action.id,
      profile: resolved.profile,
      sourceCodes: action.sourceCodes,
      commands: action.commands,
      rollbackNotes: action.rollbackNotes ?? [],
      queue: {
        version: 1,
        attempts: 0,
        maxAttempts: resolved.policy.maxRetryAttempts,
        nextAttemptAt: null,
        lastAttemptAt: null,
        lastError: null,
        dlq: false,
        dlqReason: null,
        replayOfRunId: null,
        approval: {
          required: approvalRequired,
          status: approvalRequired ? "pending" : "none",
          reason: approvalReason,
          requestedAt: approvalRequired ? nowIso : null,
          requestedByUserId: null,
          approvedAt: null,
          approvedByUserId: null,
        },
        canary: {
          enabled: canaryChecks.length > 0,
          rolloutPercent: canaryRolloutPercent,
          bucket: canaryBucket,
          selected: canarySelected,
          checks: canaryChecks,
          lastCheckedAt: null,
          passed: null,
          error: null,
        },
        rollback: {
          enabled: rollbackEnabled,
          attempted: false,
          succeeded: null,
          commands: rollbackEnabled ? rollbackCommands : [],
          lastRunAt: null,
          error: null,
        },
        autoQueued: true,
        autoReason: input.reason?.trim() || "host_status_ingest",
        autoTier: action.autoTier,
      },
    };

    const created = await prisma.$transaction(async (tx) => {
      const actionRow = await tx.remediationAction.upsert({
        where: { key: action.id },
        create: {
          key: action.id,
          title: action.title,
          description: action.why,
          enabled: true,
          paramsSchemaJson: JSON.stringify({
            sourceCodes: action.sourceCodes,
            requiresConfirm: action.requiresConfirm,
            autoTier: action.autoTier,
            risk: action.risk,
          }),
        },
        update: {
          title: action.title,
          description: action.why,
          enabled: true,
          paramsSchemaJson: JSON.stringify({
            sourceCodes: action.sourceCodes,
            requiresConfirm: action.requiresConfirm,
            autoTier: action.autoTier,
            risk: action.risk,
          }),
        },
        select: { id: true },
      });

      const run = await tx.remediationRun.create({
        data: {
          hostId: host.id,
          actionId: actionRow.id,
          requestedByUserId: host.userId,
          state: "queued",
          startedAt: null,
          finishedAt: null,
          paramsJson: serializeExecuteRunPayload(payload),
          output: null,
          error: approvalRequired ? "Awaiting operator approval." : null,
        },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          userId: host.userId,
          hostId: host.id,
          action: approvalRequired
            ? "remediate.execute.autonomous_queued_pending_approval"
            : "remediate.execute.autonomous_queued",
          detail: `${action.id} queued autonomously`,
          metaJson: JSON.stringify({
            runId: run.id,
            actionId: action.id,
            profile: resolved.profile,
            autoTier: action.autoTier,
            risk: action.risk,
            approvalRequired,
            canaryRolloutPercent,
            canaryBucket,
            canarySelected,
            rollbackEnabled,
          }),
        },
      });

      return run;
    });

    queuedNow += 1;
    queuedGlobal += 1;
    queuedAutoHour += 1;
    executeInHour += 1;
    activeForHost += 1;
    if (approvalRequired) approvalPending += 1;

    decisions.push({
      actionId: action.id,
      actionTitle: action.title,
      autoTier: action.autoTier,
      risk: action.risk,
      state: approvalRequired ? "approval_pending" : "queued",
      reason: approvalRequired ? "queued and waiting for approval" : "queued for execution",
      runId: created.id,
      approvalRequired,
      approvalStatus: approvalRequired ? "pending" : "none",
      canaryRolloutPercent,
      canaryBucket,
      canarySelected,
      canaryEnabled: canaryChecks.length > 0,
      rollbackEnabled,
    });
  }

  const queued = queuedNow;
  const skipped = decisions.filter((x) => x.state === "skipped").length;
  const queueAutoDrainTriggered =
    queuedNow > 0 && resolved.policy.queueAutoDrain;

  if (queueAutoDrainTriggered) {
    void drainRemediationQueue({
      limit: Math.max(1, Math.min(queuedNow, resolved.policy.autonomousMaxQueuedPerCycle)),
    }).catch(() => undefined);
  }

  return {
    ok: true,
    hostId: host.id,
    hostName: host.name,
    profile: resolved.profile,
    autonomousEnabled: true,
    evaluated: plan.actions.length,
    queued,
    approvalPending,
    skipped,
    queueAutoDrainTriggered,
    items: decisions,
  };
}
