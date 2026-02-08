type AnyRecord = Record<string, unknown>;

export type QueueApprovalState = "none" | "pending" | "approved" | "rejected";

export type QueueApprovalMeta = {
  required: boolean;
  status: QueueApprovalState;
  reason: string | null;
  requestedAt: string | null;
  requestedByUserId: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
};

export type QueueCanaryMeta = {
  enabled: boolean;
  rolloutPercent: number;
  bucket: number;
  selected: boolean;
  checks: string[];
  lastCheckedAt: string | null;
  passed: boolean | null;
  error: string | null;
};

export type QueueRollbackMeta = {
  enabled: boolean;
  attempted: boolean;
  succeeded: boolean | null;
  commands: string[];
  lastRunAt: string | null;
  error: string | null;
};

export type QueueRuntimeMeta = {
  version: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  dlq: boolean;
  dlqReason: string | null;
  replayOfRunId: string | null;
  approval: QueueApprovalMeta;
  canary: QueueCanaryMeta;
  rollback: QueueRollbackMeta;
  autoQueued: boolean;
  autoReason: string | null;
  autoTier: string | null;
};

export type ExecuteRunPayload = {
  mode: "execute";
  actionId: string;
  commands: string[];
  sourceCodes: string[];
  rollbackNotes: string[];
  profile?: string;
  queue: QueueRuntimeMeta;
};

type PayloadParseOptions = {
  defaultMaxAttempts: number;
};

function asRecord(v: unknown): AnyRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as AnyRecord;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const t = Math.trunc(v);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return fallback;
}

function toBoolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return null;
}

function toIsoMaybe(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function toTextOrNull(v: unknown, maxLen = 600): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}...[truncated ${t.length - maxLen} chars]`;
}

export function normalizeQueueRuntimeMeta(
  raw: unknown,
  options: PayloadParseOptions
): QueueRuntimeMeta {
  const rec = asRecord(raw) ?? {};
  const defaultMaxAttempts = clampInt(options.defaultMaxAttempts, 1, 20);
  const attempts = clampInt(toInt(rec.attempts) ?? 0, 0, 20_000);
  const maxAttempts = clampInt(toInt(rec.maxAttempts) ?? defaultMaxAttempts, 1, 20);
  const dlq = toBool(rec.dlq, false);
  const approvalRaw = asRecord(rec.approval) ?? {};
  const approvalRequired = toBool(approvalRaw.required, false);
  const approvalStatusRaw =
    typeof approvalRaw.status === "string"
      ? approvalRaw.status.trim().toLowerCase()
      : "";
  let approvalStatus: QueueApprovalState = "none";
  if (approvalRequired) {
    if (approvalStatusRaw === "approved") approvalStatus = "approved";
    else if (approvalStatusRaw === "rejected") approvalStatus = "rejected";
    else approvalStatus = "pending";
  }

  const canaryRaw = asRecord(rec.canary) ?? {};
  const canaryEnabled = toBool(canaryRaw.enabled, false);
  const canaryRolloutPercent = clampInt(toInt(canaryRaw.rolloutPercent) ?? 100, 1, 100);
  const canaryBucket = clampInt(toInt(canaryRaw.bucket) ?? 0, 0, 99);
  const canarySelected = canaryEnabled ? toBool(canaryRaw.selected, true) : true;
  const canaryPassed = toBoolOrNull(canaryRaw.passed);

  const rollbackRaw = asRecord(rec.rollback) ?? {};
  const rollbackEnabled = toBool(rollbackRaw.enabled, false);
  const rollbackSucceeded = toBoolOrNull(rollbackRaw.succeeded);

  const approvalBlocksQueue = approvalRequired && approvalStatus !== "approved";

  return {
    version: 1,
    attempts,
    maxAttempts,
    nextAttemptAt: dlq || approvalBlocksQueue ? null : toIsoMaybe(rec.nextAttemptAt),
    lastAttemptAt: toIsoMaybe(rec.lastAttemptAt),
    lastError: toTextOrNull(rec.lastError, 1200),
    dlq,
    dlqReason: toTextOrNull(rec.dlqReason, 600),
    replayOfRunId: toTextOrNull(rec.replayOfRunId, 120),
    approval: {
      required: approvalRequired,
      status: approvalStatus,
      reason: toTextOrNull(approvalRaw.reason, 280),
      requestedAt: toIsoMaybe(approvalRaw.requestedAt),
      requestedByUserId: toTextOrNull(approvalRaw.requestedByUserId, 120),
      approvedAt: toIsoMaybe(approvalRaw.approvedAt),
      approvedByUserId: toTextOrNull(approvalRaw.approvedByUserId, 120),
    },
    canary: {
      enabled: canaryEnabled,
      rolloutPercent: canaryRolloutPercent,
      bucket: canaryBucket,
      selected: canarySelected,
      checks: toStringArray(canaryRaw.checks).slice(0, 20),
      lastCheckedAt: toIsoMaybe(canaryRaw.lastCheckedAt),
      passed: canaryPassed,
      error: toTextOrNull(canaryRaw.error, 1000),
    },
    rollback: {
      enabled: rollbackEnabled,
      attempted: toBool(rollbackRaw.attempted, false),
      succeeded: rollbackSucceeded,
      commands: toStringArray(rollbackRaw.commands).slice(0, 20),
      lastRunAt: toIsoMaybe(rollbackRaw.lastRunAt),
      error: toTextOrNull(rollbackRaw.error, 1000),
    },
    autoQueued: toBool(rec.autoQueued, false),
    autoReason: toTextOrNull(rec.autoReason, 400),
    autoTier: toTextOrNull(rec.autoTier, 40),
  };
}

function parseRawPayload(raw: string | null | undefined | AnyRecord): AnyRecord | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
  return asRecord(raw);
}

export function parseExecuteRunPayload(
  raw: string | null | undefined | AnyRecord,
  options: PayloadParseOptions
): ExecuteRunPayload | null {
  const parsed = parseRawPayload(raw);
  if (!parsed || parsed.mode !== "execute") return null;

  const actionId = typeof parsed.actionId === "string" ? parsed.actionId.trim() : "";
  const commands = toStringArray(parsed.commands);
  const sourceCodes = toStringArray(parsed.sourceCodes);
  const rollbackNotes = toStringArray(parsed.rollbackNotes);
  const profile = typeof parsed.profile === "string" ? parsed.profile.trim() : undefined;

  if (!actionId || commands.length === 0) return null;

  return {
    mode: "execute",
    actionId,
    commands,
    sourceCodes,
    rollbackNotes,
    ...(profile ? { profile } : {}),
    queue: normalizeQueueRuntimeMeta(parsed.queue, options),
  };
}

export function serializeExecuteRunPayload(payload: ExecuteRunPayload): string {
  return JSON.stringify({
    mode: "execute",
    actionId: payload.actionId,
    profile: payload.profile,
    sourceCodes: payload.sourceCodes,
    commands: payload.commands,
    rollbackNotes: payload.rollbackNotes,
    queue: payload.queue,
  });
}

export function queueMetaIsReady(meta: QueueRuntimeMeta, now = new Date()): boolean {
  if (meta.dlq) return false;
  if (meta.approval.required && meta.approval.status !== "approved") return false;
  if (!meta.nextAttemptAt) return true;
  const nextMs = Date.parse(meta.nextAttemptAt);
  if (!Number.isFinite(nextMs)) return true;
  return nextMs <= now.getTime();
}

export function computeRetryDelaySeconds(
  attemptNumber: number,
  baseSeconds: number,
  maxSeconds: number
): number {
  const safeAttempt = clampInt(attemptNumber, 1, 30);
  const base = clampInt(baseSeconds, 1, 24 * 60 * 60);
  const max = clampInt(maxSeconds, base, 24 * 60 * 60);
  const multiplier = Math.pow(2, safeAttempt - 1);
  const candidate = base * multiplier;
  return clampInt(candidate, base, max);
}

export function computeNextRetryAt(now: Date, delaySeconds: number): string {
  const delayMs = clampInt(delaySeconds, 1, 24 * 60 * 60) * 1000;
  return new Date(now.getTime() + delayMs).toISOString();
}

export function shouldRetryAttempt(
  attemptsAfterFailure: number,
  maxAttempts: number
): boolean {
  const attempts = clampInt(attemptsAfterFailure, 0, 20_000);
  const max = clampInt(maxAttempts, 1, 20);
  return attempts < max;
}

export function truncateQueueErrorMessage(message: string, maxLen = 600): string {
  const m = message.trim();
  if (m.length <= maxLen) return m;
  return `${m.slice(0, maxLen)}...[truncated ${m.length - maxLen} chars]`;
}
