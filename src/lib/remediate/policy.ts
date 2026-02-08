import {
  normalizeApprovalRiskThreshold,
  normalizeRemediationAutoTier,
  type RemediationApprovalRiskThreshold,
  type RemediationAutoTier,
} from "@/lib/remediate/autonomous";

export type RemediationPolicy = {
  dryRunMaxAgeMinutes: number;
  executeCooldownMinutes: number;
  maxExecutePerHour: number;
  timelineDedupeWindowMinutes: number;
  maxQueuePerHost: number;
  maxQueueTotal: number;
  queueTtlMinutes: number;
  maxRetryAttempts: number;
  retryBackoffSeconds: number;
  retryBackoffMaxSeconds: number;
  commandTimeoutMs: number;
  maxBufferBytes: number;
  queueAutoDrain: boolean;
  autonomousEnabled: boolean;
  autonomousMaxTier: RemediationAutoTier;
  autonomousMaxQueuedPerCycle: number;
  autonomousMaxQueuedPerHour: number;
  approvalRiskThreshold: RemediationApprovalRiskThreshold;
  canaryRolloutPercent: number;
  canaryRequireChecks: boolean;
  autoRollback: boolean;
};

export type RemediationPolicyOverrides = Partial<{
  dryRunMaxAgeMinutes: number;
  executeCooldownMinutes: number;
  maxExecutePerHour: number;
  timelineDedupeWindowMinutes: number;
  maxQueuePerHost: number;
  maxQueueTotal: number;
  queueTtlMinutes: number;
  maxRetryAttempts: number;
  retryBackoffSeconds: number;
  retryBackoffMaxSeconds: number;
  commandTimeoutMs: number;
  maxBufferBytes: number;
  queueAutoDrain: boolean;
  autonomousEnabled: boolean;
  autonomousMaxTier: RemediationAutoTier;
  autonomousMaxQueuedPerCycle: number;
  autonomousMaxQueuedPerHour: number;
  approvalRiskThreshold: RemediationApprovalRiskThreshold;
  canaryRolloutPercent: number;
  canaryRequireChecks: boolean;
  autoRollback: boolean;
}>;

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const t = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

function parseTierEnv(name: string, fallback: RemediationAutoTier): RemediationAutoTier {
  const raw = process.env[name];
  if (!raw) return fallback;
  return normalizeRemediationAutoTier(raw);
}

function parseApprovalThresholdEnv(
  name: string,
  fallback: RemediationApprovalRiskThreshold
): RemediationApprovalRiskThreshold {
  const raw = process.env[name];
  if (!raw) return fallback;
  return normalizeApprovalRiskThreshold(raw, fallback);
}

export function readRemediationPolicy(): RemediationPolicy {
  const retryBackoffSeconds = clamp(
    parseIntEnv("VPS_REMEDIATE_RETRY_BACKOFF_SECONDS", 15),
    1,
    60 * 60
  );
  const retryBackoffMaxSeconds = clamp(
    parseIntEnv("VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS", 15 * 60),
    retryBackoffSeconds,
    24 * 60 * 60
  );

  return {
    dryRunMaxAgeMinutes: clamp(
      parseIntEnv("VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES", 30),
      1,
      24 * 60
    ),
    executeCooldownMinutes: clamp(
      parseIntEnv("VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES", 5),
      0,
      24 * 60
    ),
    maxExecutePerHour: clamp(
      parseIntEnv("VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR", 6),
      1,
      500
    ),
    timelineDedupeWindowMinutes: clamp(
      parseIntEnv("VPS_SIGNAL_DEDUPE_WINDOW_MINUTES", 30),
      1,
      24 * 60
    ),
    maxQueuePerHost: clamp(
      parseIntEnv("VPS_REMEDIATE_MAX_QUEUE_PER_HOST", 4),
      1,
      200
    ),
    maxQueueTotal: clamp(
      parseIntEnv("VPS_REMEDIATE_MAX_QUEUE_TOTAL", 200),
      1,
      10_000
    ),
    queueTtlMinutes: clamp(
      parseIntEnv("VPS_REMEDIATE_QUEUE_TTL_MINUTES", 120),
      1,
      7 * 24 * 60
    ),
    maxRetryAttempts: clamp(
      parseIntEnv("VPS_REMEDIATE_MAX_RETRY_ATTEMPTS", 3),
      1,
      20
    ),
    retryBackoffSeconds,
    retryBackoffMaxSeconds,
    commandTimeoutMs: clamp(
      parseIntEnv("VPS_REMEDIATE_COMMAND_TIMEOUT_MS", 20_000),
      1_000,
      10 * 60 * 1000
    ),
    maxBufferBytes: clamp(
      parseIntEnv("VPS_REMEDIATE_MAX_BUFFER_BYTES", 512_000),
      32_000,
      8_000_000
    ),
    queueAutoDrain: parseBoolEnv("VPS_REMEDIATE_QUEUE_AUTODRAIN", true),
    autonomousEnabled: parseBoolEnv("VPS_REMEDIATE_AUTONOMOUS_ENABLED", false),
    autonomousMaxTier: parseTierEnv("VPS_REMEDIATE_AUTONOMOUS_MAX_TIER", "safe_auto"),
    autonomousMaxQueuedPerCycle: clamp(
      parseIntEnv("VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_CYCLE", 1),
      1,
      20
    ),
    autonomousMaxQueuedPerHour: clamp(
      parseIntEnv("VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_HOUR", 4),
      1,
      500
    ),
    approvalRiskThreshold: parseApprovalThresholdEnv(
      "VPS_REMEDIATE_APPROVAL_RISK_THRESHOLD",
      "medium"
    ),
    canaryRolloutPercent: clamp(
      parseIntEnv("VPS_REMEDIATE_CANARY_ROLLOUT_PERCENT", 25),
      1,
      100
    ),
    canaryRequireChecks: parseBoolEnv("VPS_REMEDIATE_CANARY_REQUIRE_CHECKS", true),
    autoRollback: parseBoolEnv("VPS_REMEDIATE_AUTO_ROLLBACK", true),
  };
}

export function applyRemediationPolicyOverrides(
  base: RemediationPolicy,
  overrides?: RemediationPolicyOverrides
): RemediationPolicy {
  if (!overrides) return base;
  const retryBackoffSeconds =
    typeof overrides.retryBackoffSeconds === "number"
      ? clamp(Math.trunc(overrides.retryBackoffSeconds), 1, 60 * 60)
      : base.retryBackoffSeconds;
  const retryBackoffMaxSeconds =
    typeof overrides.retryBackoffMaxSeconds === "number"
      ? clamp(
          Math.trunc(overrides.retryBackoffMaxSeconds),
          retryBackoffSeconds,
          24 * 60 * 60
        )
      : base.retryBackoffMaxSeconds;
  const autonomousMaxTier =
    overrides.autonomousMaxTier !== undefined
      ? normalizeRemediationAutoTier(overrides.autonomousMaxTier)
      : base.autonomousMaxTier;
  const approvalRiskThreshold =
    overrides.approvalRiskThreshold !== undefined
      ? normalizeApprovalRiskThreshold(
          overrides.approvalRiskThreshold,
          base.approvalRiskThreshold
        )
      : base.approvalRiskThreshold;

  return {
    dryRunMaxAgeMinutes:
      typeof overrides.dryRunMaxAgeMinutes === "number"
        ? clamp(Math.trunc(overrides.dryRunMaxAgeMinutes), 1, 24 * 60)
        : base.dryRunMaxAgeMinutes,
    executeCooldownMinutes:
      typeof overrides.executeCooldownMinutes === "number"
        ? clamp(Math.trunc(overrides.executeCooldownMinutes), 0, 24 * 60)
        : base.executeCooldownMinutes,
    maxExecutePerHour:
      typeof overrides.maxExecutePerHour === "number"
        ? clamp(Math.trunc(overrides.maxExecutePerHour), 1, 500)
        : base.maxExecutePerHour,
    timelineDedupeWindowMinutes:
      typeof overrides.timelineDedupeWindowMinutes === "number"
        ? clamp(Math.trunc(overrides.timelineDedupeWindowMinutes), 1, 24 * 60)
        : base.timelineDedupeWindowMinutes,
    maxQueuePerHost:
      typeof overrides.maxQueuePerHost === "number"
        ? clamp(Math.trunc(overrides.maxQueuePerHost), 1, 200)
        : base.maxQueuePerHost,
    maxQueueTotal:
      typeof overrides.maxQueueTotal === "number"
        ? clamp(Math.trunc(overrides.maxQueueTotal), 1, 10_000)
        : base.maxQueueTotal,
    queueTtlMinutes:
      typeof overrides.queueTtlMinutes === "number"
        ? clamp(Math.trunc(overrides.queueTtlMinutes), 1, 7 * 24 * 60)
        : base.queueTtlMinutes,
    maxRetryAttempts:
      typeof overrides.maxRetryAttempts === "number"
        ? clamp(Math.trunc(overrides.maxRetryAttempts), 1, 20)
        : base.maxRetryAttempts,
    retryBackoffSeconds,
    retryBackoffMaxSeconds,
    commandTimeoutMs:
      typeof overrides.commandTimeoutMs === "number"
        ? clamp(Math.trunc(overrides.commandTimeoutMs), 1_000, 10 * 60 * 1000)
        : base.commandTimeoutMs,
    maxBufferBytes:
      typeof overrides.maxBufferBytes === "number"
        ? clamp(Math.trunc(overrides.maxBufferBytes), 32_000, 8_000_000)
        : base.maxBufferBytes,
    queueAutoDrain:
      typeof overrides.queueAutoDrain === "boolean"
        ? overrides.queueAutoDrain
        : base.queueAutoDrain,
    autonomousEnabled:
      typeof overrides.autonomousEnabled === "boolean"
        ? overrides.autonomousEnabled
        : base.autonomousEnabled,
    autonomousMaxTier,
    autonomousMaxQueuedPerCycle:
      typeof overrides.autonomousMaxQueuedPerCycle === "number"
        ? clamp(Math.trunc(overrides.autonomousMaxQueuedPerCycle), 1, 20)
        : base.autonomousMaxQueuedPerCycle,
    autonomousMaxQueuedPerHour:
      typeof overrides.autonomousMaxQueuedPerHour === "number"
        ? clamp(Math.trunc(overrides.autonomousMaxQueuedPerHour), 1, 500)
        : base.autonomousMaxQueuedPerHour,
    approvalRiskThreshold,
    canaryRolloutPercent:
      typeof overrides.canaryRolloutPercent === "number"
        ? clamp(Math.trunc(overrides.canaryRolloutPercent), 1, 100)
        : base.canaryRolloutPercent,
    canaryRequireChecks:
      typeof overrides.canaryRequireChecks === "boolean"
        ? overrides.canaryRequireChecks
        : base.canaryRequireChecks,
    autoRollback:
      typeof overrides.autoRollback === "boolean"
        ? overrides.autoRollback
        : base.autoRollback,
  };
}

export function isWithinMinutes(ts: Date, minutes: number, now = new Date()): boolean {
  const ageMs = now.getTime() - ts.getTime();
  return ageMs >= 0 && ageMs <= minutes * 60_000;
}
