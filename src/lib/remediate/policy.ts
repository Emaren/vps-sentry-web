export type RemediationPolicy = {
  dryRunMaxAgeMinutes: number;
  executeCooldownMinutes: number;
  maxExecutePerHour: number;
  timelineDedupeWindowMinutes: number;
};

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
  };
}

export function isWithinMinutes(ts: Date, minutes: number, now = new Date()): boolean {
  const ageMs = now.getTime() - ts.getTime();
  return ageMs >= 0 && ageMs <= minutes * 60_000;
}
