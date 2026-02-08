import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRemediationPlanFromSnapshots } from "@/lib/remediate";
import type { RemediationAction } from "@/lib/remediate/actions";
import { isWithinMinutes, readRemediationPolicy } from "@/lib/remediate/policy";
import {
  readCommandGuardPolicy,
  validateRemediationCommands,
} from "@/lib/remediate/guard";
import {
  resolveHostRemediationPolicy,
  type RemediationPolicyProfile,
} from "@/lib/remediate/host-policy";
import { drainRemediationQueue } from "@/lib/remediate/queue";
import {
  serializeExecuteRunPayload,
  type ExecuteRunPayload,
} from "@/lib/remediate/queue-runtime";
import { requireViewerAccess } from "@/lib/rbac";
import { hasRequiredRole } from "@/lib/rbac-policy";

export const dynamic = "force-dynamic";

type RemediationMode = "plan" | "dry-run" | "execute" | "drain-queue";

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeMode(v: unknown): RemediationMode {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "dry-run" || t === "execute" || t === "drain-queue") return t;
  return "plan";
}

function resolveAction(actions: RemediationAction[], id: string): RemediationAction | null {
  if (!id) return null;
  return actions.find((a) => a.id === id) ?? null;
}

function dryRunOutput(action: RemediationAction): string {
  return [
    `mode=dry-run action=${action.id}`,
    "",
    "No commands were executed on the host.",
    "Commands that would run:",
    ...action.commands.map((c, i) => `${i + 1}. ${c}`),
    "",
    action.rollbackNotes?.length ? `Rollback notes: ${action.rollbackNotes.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function getRemediationRuns(hostId: string, limit = 15) {
  return prisma.remediationRun.findMany({
    where: { hostId },
    orderBy: { requestedAt: "desc" },
    take: Math.max(1, Math.min(limit, 40)),
    select: {
      id: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      output: true,
      error: true,
      action: {
        select: { key: true, title: true },
      },
      requestedBy: {
        select: { email: true },
      },
    },
  });
}

type PolicyPreview = {
  profile: RemediationPolicyProfile;
  dryRunMaxAgeMinutes: number;
  executeCooldownMinutes: number;
  maxExecutePerHour: number;
  maxQueuePerHost: number;
  maxQueueTotal: number;
  queueTtlMinutes: number;
  maxRetryAttempts: number;
  retryBackoffSeconds: number;
  retryBackoffMaxSeconds: number;
  commandTimeoutMs: number;
  maxBufferBytes: number;
  enforceAllowlist: boolean;
  maxCommandsPerAction: number;
  maxCommandLength: number;
};

function toPolicyPreview(input: {
  profile: RemediationPolicyProfile;
  policy: ReturnType<typeof readRemediationPolicy>;
  guardPolicy: ReturnType<typeof readCommandGuardPolicy>;
}): PolicyPreview {
  return {
    profile: input.profile,
    dryRunMaxAgeMinutes: input.policy.dryRunMaxAgeMinutes,
    executeCooldownMinutes: input.policy.executeCooldownMinutes,
    maxExecutePerHour: input.policy.maxExecutePerHour,
    maxQueuePerHost: input.policy.maxQueuePerHost,
    maxQueueTotal: input.policy.maxQueueTotal,
    queueTtlMinutes: input.policy.queueTtlMinutes,
    maxRetryAttempts: input.policy.maxRetryAttempts,
    retryBackoffSeconds: input.policy.retryBackoffSeconds,
    retryBackoffMaxSeconds: input.policy.retryBackoffMaxSeconds,
    commandTimeoutMs: input.policy.commandTimeoutMs,
    maxBufferBytes: input.policy.maxBufferBytes,
    enforceAllowlist: input.guardPolicy.enforceAllowlist,
    maxCommandsPerAction: input.guardPolicy.maxCommandsPerAction,
    maxCommandLength: input.guardPolicy.maxCommandLength,
  };
}

export async function POST(req: Request) {
  const access = await requireViewerAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const body = await req.json().catch(() => ({}));
  const mode = normalizeMode(body?.mode);
  const requiresOps = mode !== "plan";
  if (requiresOps && !hasRequiredRole(access.identity.role, "ops")) {
    await prisma.auditLog.create({
      data: {
        userId: access.identity.userId,
        action: "remediate.denied",
        detail: `Denied mode=${mode} for role=${access.identity.role}`,
        metaJson: JSON.stringify({
          mode,
          requiredRole: "ops",
          role: access.identity.role,
          route: "/api/remediate",
        }),
      },
    });
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (mode === "drain-queue") {
    const limitRaw = Number(body?.limit ?? 5);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 5;
    const drained = await drainRemediationQueue({ limit });

    await prisma.auditLog.create({
      data: {
        userId: access.identity.userId,
        action: "remediate.queue.drain",
        detail: `Processed ${drained.processed}/${drained.requestedLimit} queued remediation run(s)`,
        metaJson: JSON.stringify({
          processed: drained.processed,
          requestedLimit: drained.requestedLimit,
          ok: drained.ok,
        }),
      },
    });

    return NextResponse.json({
      ok: true,
      mode,
      drained,
    });
  }

  const hostId = typeof body?.hostId === "string" ? body.hostId.trim() : "";
  const actionId = typeof body?.actionId === "string" ? body.actionId.trim() : "";
  const confirmPhrase = typeof body?.confirmPhrase === "string" ? body.confirmPhrase.trim() : "";
  const limitRaw = Number(body?.limit ?? 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(10, Math.min(limitRaw, 200)) : 40;

  if (!hostId) {
    return NextResponse.json({ ok: false, error: "hostId is required" }, { status: 400 });
  }

  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: access.identity.userId },
    select: {
      id: true,
      name: true,
      slug: true,
      lastSeenAt: true,
      enabled: true,
      metaJson: true,
    },
  });
  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const snapshots = await prisma.hostSnapshot.findMany({
    where: { hostId: host.id },
    orderBy: { ts: "desc" },
    take: limit,
    select: {
      id: true,
      ts: true,
      statusJson: true,
    },
  });

  const globalPolicy = readRemediationPolicy();
  const globalGuardPolicy = readCommandGuardPolicy();
  const resolvedPolicy = resolveHostRemediationPolicy({
    metaJson: host.metaJson,
    globalPolicy,
    globalGuardPolicy,
  });

  const parsed = snapshots
    .map((s) => ({ id: s.id, ts: s.ts, status: safeParse(s.statusJson) }))
    .filter(
      (s): s is { id: string; ts: Date; status: Record<string, unknown> } =>
        Boolean(s.status && typeof s.status === "object")
    );

  const plan = buildRemediationPlanFromSnapshots(parsed, {
    dedupeWindowMinutes: resolvedPolicy.policy.timelineDedupeWindowMinutes,
  });
  const recentRuns = await getRemediationRuns(host.id);
  const policyPreview = toPolicyPreview({
    profile: resolvedPolicy.profile,
    policy: resolvedPolicy.policy,
    guardPolicy: resolvedPolicy.guardPolicy,
  });

  if (mode === "plan") {
    return NextResponse.json({
      ok: true,
      mode,
      host,
      policy: policyPreview,
      snapshotsConsidered: parsed.length,
      timelineCount: plan.timelineCount,
      topCodes: plan.topCodes,
      context: plan.context,
      actions: plan.actions,
      runs: recentRuns,
    });
  }

  const action = resolveAction(plan.actions, actionId);
  if (!action) {
    return NextResponse.json(
      { ok: false, error: "Unknown actionId for this host/timeline." },
      { status: 404 }
    );
  }

  if (mode === "execute" && action.requiresConfirm && confirmPhrase !== action.confirmPhrase) {
    return NextResponse.json(
      {
        ok: false,
        error: "Confirmation phrase mismatch.",
        expected: action.confirmPhrase,
      },
      { status: 400 }
    );
  }

  const validationIssues = validateRemediationCommands(
    action.commands,
    resolvedPolicy.guardPolicy
  );
  if (validationIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Action blocked by remediation command policy.",
        profile: resolvedPolicy.profile,
        issues: validationIssues.map((i) => ({ index: i.index, reason: i.reason })),
      },
      { status: 400 }
    );
  }

  const actionRow = await prisma.remediationAction.upsert({
    where: { key: action.id },
    create: {
      key: action.id,
      title: action.title,
      description: action.why,
      enabled: true,
      paramsSchemaJson: JSON.stringify({
        sourceCodes: action.sourceCodes,
        requiresConfirm: action.requiresConfirm,
      }),
    },
    update: {
      title: action.title,
      description: action.why,
      enabled: true,
      paramsSchemaJson: JSON.stringify({
        sourceCodes: action.sourceCodes,
        requiresConfirm: action.requiresConfirm,
      }),
    },
    select: { id: true, key: true },
  });

  if (mode === "execute") {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      runningExecuteRun,
      recentExecuteCount,
      latestExecuteRun,
      queuedOrRunningForHost,
      totalQueued,
    ] = await Promise.all([
      prisma.remediationRun.findFirst({
        where: {
          hostId: host.id,
          actionId: actionRow.id,
          state: "running",
          paramsJson: { contains: '"mode":"execute"' },
        },
        select: { id: true, requestedAt: true },
      }),
      prisma.remediationRun.count({
        where: {
          hostId: host.id,
          requestedAt: { gte: oneHourAgo },
          paramsJson: { contains: '"mode":"execute"' },
        },
      }),
      prisma.remediationRun.findFirst({
        where: {
          hostId: host.id,
          actionId: actionRow.id,
          paramsJson: { contains: '"mode":"execute"' },
        },
        orderBy: { requestedAt: "desc" },
        select: { id: true, requestedAt: true },
      }),
      prisma.remediationRun.count({
        where: {
          hostId: host.id,
          state: { in: ["queued", "running"] },
          paramsJson: { contains: '"mode":"execute"' },
        },
      }),
      prisma.remediationRun.count({
        where: {
          state: "queued",
          paramsJson: { contains: '"mode":"execute"' },
        },
      }),
    ]);

    if (runningExecuteRun) {
      return NextResponse.json(
        {
          ok: false,
          error: "An execute run is already in progress for this action.",
          runningRunId: runningExecuteRun.id,
        },
        { status: 409 }
      );
    }

    if (recentExecuteCount >= resolvedPolicy.policy.maxExecutePerHour) {
      return NextResponse.json(
        {
          ok: false,
          error: `Execute rate limit reached (${resolvedPolicy.policy.maxExecutePerHour}/hour).`,
          profile: resolvedPolicy.profile,
        },
        { status: 429 }
      );
    }

    if (
      latestExecuteRun &&
      resolvedPolicy.policy.executeCooldownMinutes > 0 &&
      isWithinMinutes(latestExecuteRun.requestedAt, resolvedPolicy.policy.executeCooldownMinutes)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: `Execute cooldown active (${resolvedPolicy.policy.executeCooldownMinutes}m).`,
          profile: resolvedPolicy.profile,
        },
        { status: 429 }
      );
    }

    if (queuedOrRunningForHost >= resolvedPolicy.policy.maxQueuePerHost) {
      return NextResponse.json(
        {
          ok: false,
          error: `Queue backlog limit reached for host (${resolvedPolicy.policy.maxQueuePerHost}).`,
          profile: resolvedPolicy.profile,
        },
        { status: 429 }
      );
    }

    if (totalQueued >= resolvedPolicy.policy.maxQueueTotal) {
      return NextResponse.json(
        {
          ok: false,
          error: `Global queue backlog limit reached (${resolvedPolicy.policy.maxQueueTotal}).`,
          profile: resolvedPolicy.profile,
        },
        { status: 429 }
      );
    }

    const latestDryRun = await prisma.remediationRun.findFirst({
      where: {
        hostId: host.id,
        actionId: actionRow.id,
        state: "succeeded",
        paramsJson: { contains: '"mode":"dry-run"' },
      },
      orderBy: { requestedAt: "desc" },
      select: {
        id: true,
        requestedAt: true,
      },
    });

    const hasFreshDryRun =
      latestDryRun !== null &&
      isWithinMinutes(latestDryRun.requestedAt, resolvedPolicy.policy.dryRunMaxAgeMinutes);

    if (!hasFreshDryRun) {
      return NextResponse.json(
        {
          ok: false,
          error: `Run dry-run first (within ${resolvedPolicy.policy.dryRunMaxAgeMinutes} minutes) before execute.`,
          profile: resolvedPolicy.profile,
        },
        { status: 409 }
      );
    }

    const canaryChecks = (action.canaryChecks ?? [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .slice(0, 20);
    const rollbackCommands = (action.rollbackCommands ?? [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .slice(0, 20);
    const rollbackEnabled =
      resolvedPolicy.policy.autoRollback && rollbackCommands.length > 0;

    const executePayload: ExecuteRunPayload = {
      mode: "execute",
      actionId: action.id,
      profile: resolvedPolicy.profile,
      sourceCodes: action.sourceCodes,
      commands: action.commands,
      rollbackNotes: action.rollbackNotes ?? [],
      queue: {
        version: 1,
        attempts: 0,
        maxAttempts: resolvedPolicy.policy.maxRetryAttempts,
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
          enabled: canaryChecks.length > 0,
          rolloutPercent: 100,
          bucket: 0,
          selected: true,
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
        autoQueued: false,
        autoReason: null,
        autoTier: action.autoTier,
      },
    };

    const queuedRun = await prisma.remediationRun.create({
      data: {
        hostId: host.id,
        actionId: actionRow.id,
        requestedByUserId: access.identity.userId,
        state: "queued",
        startedAt: null,
        finishedAt: null,
        paramsJson: serializeExecuteRunPayload(executePayload),
        output: null,
      },
      select: {
        id: true,
        state: true,
        requestedAt: true,
        startedAt: true,
        finishedAt: true,
        output: true,
        error: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: access.identity.userId,
        hostId: host.id,
        action: "remediate.execute.queued",
        detail: `Queued execute action ${action.id}`,
        metaJson: JSON.stringify({
          runId: queuedRun.id,
          actionId: action.id,
          profile: resolvedPolicy.profile,
          queueAutoDrain: resolvedPolicy.policy.queueAutoDrain,
          maxRetryAttempts: resolvedPolicy.policy.maxRetryAttempts,
          retryBackoffSeconds: resolvedPolicy.policy.retryBackoffSeconds,
          retryBackoffMaxSeconds: resolvedPolicy.policy.retryBackoffMaxSeconds,
        }),
      },
    });

    if (resolvedPolicy.policy.queueAutoDrain) {
      // Best-effort async kick so execute requests stay queue-first and non-blocking.
      void drainRemediationQueue({ limit: 1 });
    }

    return NextResponse.json({
      ok: true,
      mode,
      queued: true,
      host,
      policy: policyPreview,
      action,
      run: queuedRun,
      queue: {
        autoDrain: resolvedPolicy.policy.queueAutoDrain,
        drainTriggered: resolvedPolicy.policy.queueAutoDrain,
      },
      actions: plan.actions,
      runs: await getRemediationRuns(host.id),
    });
  }

  const run = await prisma.remediationRun.create({
    data: {
      hostId: host.id,
      actionId: actionRow.id,
      requestedByUserId: access.identity.userId,
      state: "succeeded",
      startedAt: new Date(),
      finishedAt: new Date(),
      paramsJson: JSON.stringify({
        mode,
        actionId: action.id,
        profile: resolvedPolicy.profile,
        sourceCodes: action.sourceCodes,
        commands: action.commands,
        rollbackNotes: action.rollbackNotes ?? [],
      }),
      output: dryRunOutput(action),
    },
    select: {
      id: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      output: true,
      error: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: access.identity.userId,
      hostId: host.id,
      action: "remediate.dry_run",
      detail: `Dry-run action ${action.id}`,
      metaJson: JSON.stringify({
        runId: run.id,
        profile: resolvedPolicy.profile,
      }),
    },
  });

  return NextResponse.json({
    ok: true,
    mode,
    host,
    policy: policyPreview,
    action,
    run,
    actions: plan.actions,
    runs: await getRemediationRuns(host.id),
  });
}
