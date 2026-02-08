export type RemediationPolicy = {
  dryRunMaxAgeMinutes: number;
  executeCooldownMinutes: number;
  maxExecutePerHour: number;
  timelineDedupeWindowMinutes: number;
  maxQueuePerHost: number;
  maxQueueTotal: number;
  queueTtlMinutes: number;
  commandTimeoutMs: number;
  maxBufferBytes: number;
  queueAutoDrain: boolean;
};

export type RemediationPolicyOverrides = Partial<{
  dryRunMaxAgeMinutes: number;
  executeCooldownMinutes: number;
  maxExecutePerHour: number;
  timelineDedupeWindowMinutes: number;
  maxQueuePerHost: number;
  maxQueueTotal: number;
  queueTtlMinutes: number;
  commandTimeoutMs: number;
  maxBufferBytes: number;
  queueAutoDrain: boolean;
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

export function readRemediationPolicy(): RemediationPolicy {
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
  };
}

export function applyRemediationPolicyOverrides(
  base: RemediationPolicy,
  overrides?: RemediationPolicyOverrides
): RemediationPolicy {
  if (!overrides) return base;
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
  };
}

export function isWithinMinutes(ts: Date, minutes: number, now = new Date()): boolean {
  const ageMs = now.getTime() - ts.getTime();
  return ageMs >= 0 && ageMs <= minutes * 60_000;
}
