import type { HeartbeatState } from "@/lib/host-heartbeat";
import { buildIncidentTimeline, type IncidentSignal } from "@/lib/incident-signals";

export type ThreatBand = "low" | "guarded" | "elevated" | "critical";
export type ContainmentStage = "observe" | "watch" | "contain" | "lockdown";

export type SecurityPosture = {
  score: number;
  band: ThreatBand;
  stage: ContainmentStage;
  nextMove: string;
  signalCount: number;
  priorityCodes: string[];
};

type SnapshotInput = {
  id: string;
  ts: Date | string;
  status: Record<string, unknown>;
};

const SEVERITY_MULTIPLIER: Record<IncidentSignal["severity"], number> = {
  critical: 1.25,
  high: 1,
  medium: 0.72,
  low: 0.42,
  info: 0.25,
};

const CODE_BASE_WEIGHT: Record<string, number> = {
  config_tamper: 30,
  unexpected_public_ports: 28,
  firewall_drift: 20,
  account_drift: 14,
  ssh_failed_password: 12,
  ssh_invalid_user: 11,
  package_drift: 8,
  ingest_integrity_warning: 6,
  app_release_mismatch: 3,
  ssh_new_accepts: 2,
};

const LOCKDOWN_CODES = new Set(["config_tamper", "unexpected_public_ports"]);

function clampInt(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return Math.round(v);
}

function toAgeMinutes(ts: string, now = new Date()): number {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 9_999;
  const minutes = Math.round((now.getTime() - t) / 60_000);
  if (!Number.isFinite(minutes)) return 9_999;
  return Math.max(0, minutes);
}

function recencyMultiplier(ageMinutes: number): number {
  if (ageMinutes <= 30) return 1;
  if (ageMinutes <= 180) return 0.84;
  if (ageMinutes <= 24 * 60) return 0.58;
  if (ageMinutes <= 3 * 24 * 60) return 0.36;
  return 0.22;
}

function heartbeatPenalty(state: HeartbeatState): number {
  if (state === "missing") return 20;
  if (state === "stale") return 12;
  if (state === "delayed") return 6;
  return 0;
}

function scoreFromSignals(signals: IncidentSignal[], heartbeatState: HeartbeatState, now = new Date()): number {
  let score = 0;
  let activeLockdownSignal = false;

  for (const s of signals) {
    const ageMinutes = toAgeMinutes(s.ts, now);
    const base = CODE_BASE_WEIGHT[s.code] ?? 6;
    const sev = SEVERITY_MULTIPLIER[s.severity];
    const recency = recencyMultiplier(ageMinutes);
    score += base * sev * recency;

    if (LOCKDOWN_CODES.has(s.code) && ageMinutes <= 180) {
      activeLockdownSignal = true;
    }
  }

  score += heartbeatPenalty(heartbeatState);

  if (activeLockdownSignal && score < 72) score = 72;
  return clampInt(score, 0, 100);
}

function bandFromScore(score: number): ThreatBand {
  if (score >= 70) return "critical";
  if (score >= 40) return "elevated";
  if (score >= 20) return "guarded";
  return "low";
}

function stageFromScore(score: number, signals: IncidentSignal[]): ContainmentStage {
  const activeHighRisk = signals.some((s) => LOCKDOWN_CODES.has(s.code));
  if (score >= 80 || activeHighRisk) return "lockdown";
  if (score >= 55) return "contain";
  if (score >= 30) return "watch";
  return "observe";
}

function nextMoveForStage(stage: ContainmentStage): string {
  if (stage === "lockdown") {
    return "Run lock-down and quarantine actions now (dry-run first), then verify access + firewall integrity.";
  }
  if (stage === "contain") {
    return "Run targeted containment action(s), verify unexpected listeners are gone, and capture forensic logs.";
  }
  if (stage === "watch") {
    return "Increase watch level: review timeline deltas and confirm whether drift is planned maintenance.";
  }
  return "Maintain baseline hygiene and keep heartbeat + snapshots healthy.";
}

function topCodes(signals: IncidentSignal[]): string[] {
  const counts = new Map<string, number>();
  for (const s of signals) {
    counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([code]) => code);
}

export function buildSecurityPosture(
  signals: IncidentSignal[],
  heartbeatState: HeartbeatState,
  now = new Date()
): SecurityPosture {
  const score = scoreFromSignals(signals, heartbeatState, now);
  const band = bandFromScore(score);
  const stage = stageFromScore(score, signals);

  return {
    score,
    band,
    stage,
    nextMove: nextMoveForStage(stage),
    signalCount: signals.length,
    priorityCodes: topCodes(signals),
  };
}

export function buildSecurityPostureFromSnapshots(
  snapshots: SnapshotInput[],
  heartbeatState: HeartbeatState,
  opts?: { dedupeWindowMinutes?: number; now?: Date }
): SecurityPosture {
  const timeline = buildIncidentTimeline(snapshots, {
    dedupeWindowMinutes: opts?.dedupeWindowMinutes,
  }).timeline;

  return buildSecurityPosture(timeline, heartbeatState, opts?.now ?? new Date());
}
