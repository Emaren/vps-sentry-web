// /var/www/vps-sentry-web/src/app/api/remediate/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const RAW_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost";

function normalizeBase(input: string): string {
  const s = String(input ?? "").trim();
  if (!s || s === "[object Object]") return "http://localhost";

  // absolute already?
  try {
    return new URL(s).toString();
  } catch {
    // if missing scheme, try https then http
    try {
      return new URL(`https://${s}`).toString();
    } catch {
      try {
        return new URL(`http://${s}`).toString();
      } catch {
        return "http://localhost";
      }
    }
  }
}

const FALLBACK_BASE = normalizeBase(RAW_BASE);

// ---------- build-worker / weird Request hardening ----------

function isBadUrlString(v: unknown): boolean {
  if (typeof v !== "string") return true;
  const s = v.trim();
  if (!s) return true;
  if (s === "[object Object]") return true;
  return false;
}

function canParseUrlString(v: unknown): boolean {
  if (isBadUrlString(v)) return false;
  const s = String(v).trim();
  try {
    // eslint-disable-next-line no-new
    new URL(s, FALLBACK_BASE);
    return true;
  } catch {
    return false;
  }
}

function canParseNextUrl(nextUrl: unknown): boolean {
  if (!nextUrl || typeof nextUrl !== "object") return false;
  const anyNext = nextUrl as any;

  if (!isBadUrlString(anyNext?.href)) return canParseUrlString(anyNext.href);

  if (!isBadUrlString(anyNext?.pathname)) {
    const pathname = String(anyNext.pathname).trim();
    const search = typeof anyNext.search === "string" ? anyNext.search : "";
    return canParseUrlString(`${pathname}${search}`);
  }

  return false;
}

function shouldStub(req: Request): boolean {
  if (IS_BUILD_TIME) return true;

  const anyReq = req as any;
  const okUrl = canParseUrlString(anyReq?.url);

  const hasNextUrl = anyReq?.nextUrl !== undefined;
  const okNextUrl = !hasNextUrl ? true : canParseNextUrl(anyReq?.nextUrl);

  return !(okUrl && okNextUrl);
}

function safeUrlString(req: Request): string {
  const anyReq = req as any;

  const raw = anyReq?.url;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s && s !== "[object Object]") return s;
  }

  const href = anyReq?.nextUrl?.href;
  if (typeof href === "string") {
    const s = href.trim();
    if (s && s !== "[object Object]") return s;
  }

  return "/";
}

function toAbsoluteUrlString(u: string): string {
  const s = String(u ?? "/").trim() || "/";
  if (s === "[object Object]") return new URL("/", FALLBACK_BASE).toString();

  // absolute?
  try {
    return new URL(s).toString();
  } catch {
    // relative -> base (guard base too)
    try {
      return new URL(s, FALLBACK_BASE).toString();
    } catch {
      return new URL("/", FALLBACK_BASE).toString();
    }
  }
}

/**
 * Minimal Request-like object with safe *absolute* string `url` and no `nextUrl`.
 * Use this when passing req into helpers that might do new URL(req.url).
 */
function makeSafeReq(req: Request): Request {
  const url = toAbsoluteUrlString(safeUrlString(req));
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stub(req: Request) {
  const safeReq = makeSafeReq(req);

  let query: Record<string, string> = {};
  try {
    const u = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);
    query = Object.fromEntries(u.searchParams.entries());
  } catch {
    query = {};
  }

  return NextResponse.json({
    ok: true,
    buildPhase: true,
    route: "/api/remediate",
    note: "stubbed during build collection",
    method: (safeReq as any).method ?? null,
    query,
  });
}

// ---------- types (local, runtime-safe) ----------

type RemediationMode = "plan" | "dry-run" | "execute" | "drain-queue";

type RemediationAction = {
  id: string;
  title: string;
  why: string;
  commands: string[];
  sourceCodes: string[];
  requiresConfirm?: boolean;
  confirmPhrase?: string;
  rollbackNotes?: string[];
  rollbackCommands?: string[];
  canaryChecks?: string[];
  autoTier?: unknown;
};

type ExecuteRunPayload = any;
type RemediationPolicyProfile = any;

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

// ---------- small helpers ----------

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeMode(v: unknown): RemediationMode {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "dry-run" || t === "execute" || t === "drain-queue") return t as RemediationMode;
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

function toPolicyPreview(input: {
  profile: RemediationPolicyProfile;
  policy: any;
  guardPolicy: any;
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

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [
    prismaMod,
    remediateMod,
    policyMod,
    guardMod,
    hostPolicyMod,
    queueMod,
    queueRuntimeMod,
    rbacMod,
    rbacPolicyMod,
  ] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/remediate"),
    import("@/lib/remediate/policy"),
    import("@/lib/remediate/guard"),
    import("@/lib/remediate/host-policy"),
    import("@/lib/remediate/queue"),
    import("@/lib/remediate/queue-runtime").catch(() => ({} as any)),
    import("@/lib/rbac"),
    import("@/lib/rbac-policy"),
  ]);

  const prisma = (prismaMod as any).prisma as any;

  const buildRemediationPlanFromSnapshots = (remediateMod as any)
    .buildRemediationPlanFromSnapshots as (snapshots: any[], opts: any) => any;

  const readRemediationPolicy = (policyMod as any).readRemediationPolicy as () => any;
  const isWithinMinutes = (policyMod as any).isWithinMinutes as (d: Date, m: number) => boolean;

  const readCommandGuardPolicy = (guardMod as any).readCommandGuardPolicy as () => any;
  const validateRemediationCommands = (guardMod as any)
    .validateRemediationCommands as (
      cmds: string[],
      guardPolicy: any
    ) => Array<{ index: number; reason: string }>;

  const resolveHostRemediationPolicy = (hostPolicyMod as any)
    .resolveHostRemediationPolicy as (input: any) => any;

  const drainRemediationQueue = (queueMod as any).drainRemediationQueue as (input: any) => Promise<any>;

  const serializeExecuteRunPayload =
    (queueRuntimeMod as any).serializeExecuteRunPayload ?? ((payload: any) => JSON.stringify(payload));

  const requireViewerAccess = (rbacMod as any).requireViewerAccess as () => Promise<any>;
  const hasRequiredRole = (rbacPolicyMod as any).hasRequiredRole as (role: string, required: string) => boolean;

  return {
    prisma,
    buildRemediationPlanFromSnapshots,
    readRemediationPolicy,
    isWithinMinutes,
    readCommandGuardPolicy,
    validateRemediationCommands,
    resolveHostRemediationPolicy,
    drainRemediationQueue,
    serializeExecuteRunPayload,
    requireViewerAccess,
    hasRequiredRole,
  };
}

// ---------- route helpers ----------

async function getRemediationRuns(prisma: any, hostId: string, limit = 15) {
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
      action: { select: { key: true, title: true } },
      requestedBy: { select: { email: true } },
    },
  });
}

// ---------- routes ----------

export async function GET(req: Request) {
  if (shouldStub(req)) return stub(req);
  return NextResponse.json(
    { ok: false, error: "Use POST /api/remediate" },
    { status: 405, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stub(req);

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  const access = await deps.requireViewerAccess();
  if (!access?.ok) {
    return NextResponse.json(
      { ok: false, error: access?.error ?? "Unauthorized" },
      { status: typeof access?.status === "number" ? access.status : 401 }
    );
  }

  const body: any = await req.json().catch(() => ({}));
  const mode = normalizeMode(body?.mode);

  const requiresOps = mode !== "plan";
  if (requiresOps && !deps.hasRequiredRole(access.identity.role, "ops")) {
    await deps.prisma.auditLog.create({
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

    const drained = await deps.drainRemediationQueue({ limit });

    await deps.prisma.auditLog.create({
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

    const res = NextResponse.json({ ok: true, mode, drained });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  const hostId = typeof body?.hostId === "string" ? body.hostId.trim() : "";
  const actionId = typeof body?.actionId === "string" ? body.actionId.trim() : "";
  const confirmPhrase = typeof body?.confirmPhrase === "string" ? body.confirmPhrase.trim() : "";
  const limitRaw = Number(body?.limit ?? 40);
  const limit = Number.isFinite(limitRaw) ? Math.max(10, Math.min(limitRaw, 200)) : 40;

  if (!hostId) {
    return NextResponse.json({ ok: false, error: "hostId is required" }, { status: 400 });
  }

  const host = await deps.prisma.host.findFirst({
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

  const snapshots = await deps.prisma.hostSnapshot.findMany({
    where: { hostId: host.id },
    orderBy: { ts: "desc" },
    take: limit,
    select: { id: true, ts: true, statusJson: true },
  });

  const globalPolicy = deps.readRemediationPolicy();
  const globalGuardPolicy = deps.readCommandGuardPolicy();

  const resolvedPolicy = deps.resolveHostRemediationPolicy({
    metaJson: host.metaJson,
    globalPolicy,
    globalGuardPolicy,
  });

  const parsed = snapshots
    .map((s: any) => ({ id: s.id, ts: s.ts, status: safeParse(s.statusJson) }))
    .filter(
      (s: any): s is { id: string; ts: Date; status: Record<string, unknown> } =>
        Boolean(s.status && typeof s.status === "object")
    );

  const plan = deps.buildRemediationPlanFromSnapshots(parsed, {
    dedupeWindowMinutes: resolvedPolicy.policy.timelineDedupeWindowMinutes,
  });

  const recentRuns = await getRemediationRuns(deps.prisma, host.id);

  const policyPreview = toPolicyPreview({
    profile: resolvedPolicy.profile,
    policy: resolvedPolicy.policy,
    guardPolicy: resolvedPolicy.guardPolicy,
  });

  if (mode === "plan") {
    const res = NextResponse.json({
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
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  const action = resolveAction(plan.actions as RemediationAction[], actionId);
  if (!action) {
    return NextResponse.json(
      { ok: false, error: "Unknown actionId for this host/timeline." },
      { status: 404 }
    );
  }

  if (mode === "execute" && action.requiresConfirm && confirmPhrase !== action.confirmPhrase) {
    return NextResponse.json(
      { ok: false, error: "Confirmation phrase mismatch.", expected: action.confirmPhrase },
      { status: 400 }
    );
  }

  const validationIssues = deps.validateRemediationCommands(action.commands, resolvedPolicy.guardPolicy);
  if (validationIssues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Action blocked by remediation command policy.",
        profile: resolvedPolicy.profile,
        issues: validationIssues.map((i: any) => ({ index: i.index, reason: i.reason })),
      },
      { status: 400 }
    );
  }

  const actionRow = await deps.prisma.remediationAction.upsert({
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

  // ---- execute (queued) ----
  if (mode === "execute") {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const [
      runningExecuteRun,
      recentExecuteCount,
      latestExecuteRun,
      queuedOrRunningForHost,
      totalQueued,
    ] = await Promise.all([
      deps.prisma.remediationRun.findFirst({
        where: {
          hostId: host.id,
          actionId: actionRow.id,
          state: "running",
          paramsJson: { contains: '"mode":"execute"' },
        },
        select: { id: true, requestedAt: true },
      }),
      deps.prisma.remediationRun.count({
        where: {
          hostId: host.id,
          requestedAt: { gte: oneHourAgo },
          paramsJson: { contains: '"mode":"execute"' },
        },
      }),
      deps.prisma.remediationRun.findFirst({
        where: {
          hostId: host.id,
          actionId: actionRow.id,
          paramsJson: { contains: '"mode":"execute"' },
        },
        orderBy: { requestedAt: "desc" },
        select: { id: true, requestedAt: true },
      }),
      deps.prisma.remediationRun.count({
        where: {
          hostId: host.id,
          state: { in: ["queued", "running"] },
          paramsJson: { contains: '"mode":"execute"' },
        },
      }),
      deps.prisma.remediationRun.count({
        where: { state: "queued", paramsJson: { contains: '"mode":"execute"' } },
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
      deps.isWithinMinutes(latestExecuteRun.requestedAt, resolvedPolicy.policy.executeCooldownMinutes)
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

    const latestDryRun = await deps.prisma.remediationRun.findFirst({
      where: {
        hostId: host.id,
        actionId: actionRow.id,
        state: "succeeded",
        paramsJson: { contains: '"mode":"dry-run"' },
      },
      orderBy: { requestedAt: "desc" },
      select: { id: true, requestedAt: true },
    });

    const hasFreshDryRun =
      latestDryRun !== null &&
      deps.isWithinMinutes(latestDryRun.requestedAt, resolvedPolicy.policy.dryRunMaxAgeMinutes);

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
      .filter(Boolean)
      .slice(0, 20);

    const rollbackCommands = (action.rollbackCommands ?? [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);

    const rollbackEnabled = Boolean(resolvedPolicy.policy.autoRollback && rollbackCommands.length > 0);

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

    const queuedRun = await deps.prisma.remediationRun.create({
      data: {
        hostId: host.id,
        actionId: actionRow.id,
        requestedByUserId: access.identity.userId,
        state: "queued",
        startedAt: null,
        finishedAt: null,
        paramsJson: deps.serializeExecuteRunPayload(executePayload),
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

    await deps.prisma.auditLog.create({
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
      void deps.drainRemediationQueue({ limit: 1 });
    }

    const res = NextResponse.json({
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
      runs: await getRemediationRuns(deps.prisma, host.id),
    });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  // ---- dry-run (record as succeeded w/ output) ----
  const run = await deps.prisma.remediationRun.create({
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

  await deps.prisma.auditLog.create({
    data: {
      userId: access.identity.userId,
      hostId: host.id,
      action: "remediate.dry_run",
      detail: `Dry-run action ${action.id}`,
      metaJson: JSON.stringify({ runId: run.id, profile: resolvedPolicy.profile }),
    },
  });

  const res = NextResponse.json({
    ok: true,
    mode,
    host,
    policy: policyPreview,
    action,
    run,
    actions: plan.actions,
    runs: await getRemediationRuns(deps.prisma, host.id),
  });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
