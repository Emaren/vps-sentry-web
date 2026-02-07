export type HeartbeatState = "fresh" | "delayed" | "stale" | "missing";

export type HeartbeatConfig = {
  expectedMinutes: number;
  staleAfterMinutes: number;
  missingAfterMinutes: number;
};

export type EnvLike = Record<string, string | undefined>;

export type HeartbeatInfo = {
  state: HeartbeatState;
  minutesSince: number | null;
  expectedMinutes: number;
  staleAfterMinutes: number;
  missingAfterMinutes: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return fallback;
  return Math.round(n);
}

export function readHeartbeatConfig(env: EnvLike = process.env): HeartbeatConfig {
  const expectedMinutes = parsePositiveInt(env.VPS_HEARTBEAT_EXPECTED_MINUTES, 5);
  const staleMultiplier = parsePositiveInt(env.VPS_HEARTBEAT_STALE_MULTIPLIER, 3);
  const missingMultiplierRaw = parsePositiveInt(env.VPS_HEARTBEAT_MISSING_MULTIPLIER, 12);
  const missingMultiplier = Math.max(missingMultiplierRaw, staleMultiplier + 1);

  return {
    expectedMinutes,
    staleAfterMinutes: expectedMinutes * staleMultiplier,
    missingAfterMinutes: expectedMinutes * missingMultiplier,
  };
}

export function minutesSince(date: Date | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const diffMs = now.getTime() - date.getTime();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs < 0) return 0;
  return Math.round(diffMs / 60000);
}

export function classifyHeartbeat(
  lastSeenAt: Date | null | undefined,
  now = new Date(),
  config = readHeartbeatConfig()
): HeartbeatInfo {
  const mins = minutesSince(lastSeenAt, now);
  if (mins === null) {
    return {
      state: "missing",
      minutesSince: null,
      expectedMinutes: config.expectedMinutes,
      staleAfterMinutes: config.staleAfterMinutes,
      missingAfterMinutes: config.missingAfterMinutes,
    };
  }

  const state: HeartbeatState =
    mins <= config.expectedMinutes
      ? "fresh"
      : mins <= config.staleAfterMinutes
      ? "delayed"
      : mins <= config.missingAfterMinutes
      ? "stale"
      : "missing";

  return {
    state,
    minutesSince: mins,
    expectedMinutes: config.expectedMinutes,
    staleAfterMinutes: config.staleAfterMinutes,
    missingAfterMinutes: config.missingAfterMinutes,
  };
}

export function heartbeatLabel(info: HeartbeatInfo): string {
  if (info.minutesSince === null) return "Missing (never)";
  if (info.state === "fresh") return `Fresh (${info.minutesSince}m)`;
  if (info.state === "delayed") return `Delayed (${info.minutesSince}m)`;
  if (info.state === "stale") return `Stale (${info.minutesSince}m)`;
  return `Missing (${info.minutesSince}m)`;
}
