import { readdir, readFile } from "node:fs/promises";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";
import {
  DEFAULT_COUNTERSTRIKE_PLAYBOOK,
  getCounterstrikePlaybook,
} from "./counterstrike-playbooks";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const RUNNING_PATH = "/var/lib/vps-sentry/counterstrike-running.json";
const LAST_PATH = "/var/lib/vps-sentry/counterstrike-last.json";
const RUNS_DIR = "/var/lib/vps-sentry/counterstrike-runs";

type JsonDict = Record<string, unknown>;

export type CounterstrikeArmedState = {
  active: boolean;
  label: "armed" | "standby";
  reason: string;
  candidateCount: number;
};

export type CounterstrikeRunState = {
  runId: string;
  pid: number | null;
  playbook: string;
  playbookLabel: string;
  playbookTitle: string;
  mode: "analyze" | "dry-run" | "execute";
  startedAt: string | null;
  updatedAt: string | null;
  phase: string | null;
  currentLabel: string | null;
  currentCommand: string | null;
  completedSteps: number | null;
  totalSteps: number | null;
  etaSeconds: number | null;
  recentLines: string[];
  consolePath: string | null;
  evidenceDir: string | null;
  rollbackAvailable: boolean;
  evidenceCaptured: boolean;
  armed: CounterstrikeArmedState | null;
};

export type CounterstrikeRunResult = {
  runId: string;
  playbook: string;
  playbookLabel: string;
  playbookTitle: string;
  mode: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  durationSeconds: number | null;
  summary: string;
  host: string | null;
  snapshotTs: string | null;
  alertsCount: number | null;
  evidenceCaptured: boolean;
  rollbackAvailable: boolean;
  consolePath: string | null;
  evidenceDir: string | null;
  recentLines: string[];
  errors: string[];
  matchedCandidates: Array<{
    pid: number | null;
    user: string | null;
    proc: string | null;
    exe: string | null;
    cmdline: string | null;
    reasons: string[];
    score: number | null;
  }>;
  quarantinedPaths: string[];
  cronRemovedLines: number | null;
  cronChangedTargets: string[];
  armedBefore: CounterstrikeArmedState | null;
};

function asDict(value: unknown): JsonDict | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonDict;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function asInt(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

async function readJson(path: string): Promise<JsonDict | null> {
  try {
    const raw = await readFile(path, "utf8");
    return asDict(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function playbookMeta(id: string | null | undefined) {
  return getCounterstrikePlaybook(id) ?? DEFAULT_COUNTERSTRIKE_PLAYBOOK;
}

function parseArmedState(value: unknown): CounterstrikeArmedState | null {
  const raw = asDict(value);
  if (!raw) return null;
  return {
    active: asBoolean(raw.active),
    label: asBoolean(raw.active) ? "armed" : "standby",
    reason: asString(raw.reason) ?? "Counterstrike is standing by.",
    candidateCount: Math.max(0, asInt(raw.candidate_count ?? raw.candidateCount) ?? 0),
  };
}

const USER_WRITABLE_PREFIXES = ["/home/", "/tmp/", "/var/tmp/", "/dev/shm/", "/run/user/", "/root/"];

function isUserWritablePath(pathValue: string | null): boolean {
  if (!pathValue) return false;
  return USER_WRITABLE_PREFIXES.some((prefix) => pathValue.startsWith(prefix));
}

function deriveArmedStateFromStatus(status: JsonDict | null): CounterstrikeArmedState {
  const threat = asDict(status?.threat);
  const rows = asList(threat?.suspicious_processes);
  const candidateCount = rows.filter((row) => {
    const item = asDict(row);
    if (!item) return false;
    return isUserWritablePath(asString(item.exe));
  }).length;
  if (candidateCount > 0) {
    return {
      active: true,
      label: "armed",
      reason: `${candidateCount} suspicious runtime candidate(s) matched the Counterstrike playbook.`,
      candidateCount,
    };
  }
  return {
    active: false,
    label: "standby",
    reason: "No miner-persistence candidates matched the current threat snapshot.",
    candidateCount: 0,
  };
}

function normalizeRunState(raw: JsonDict | null): CounterstrikeRunState | null {
  if (!raw) return null;
  const playbook = playbookMeta(asString(raw.playbook));
  return {
    runId: asString(raw.run_id) ?? "unknown",
    pid: asInt(raw.pid),
    playbook: playbook.id,
    playbookLabel: asString(raw.playbook_label) ?? playbook.label,
    playbookTitle: asString(raw.playbook_title) ?? playbook.title,
    mode: (asString(raw.mode) as CounterstrikeRunState["mode"]) ?? "analyze",
    startedAt: asString(raw.started_at),
    updatedAt: asString(raw.updated_at),
    phase: asString(raw.phase),
    currentLabel: asString(raw.current_label),
    currentCommand: asString(raw.current_command),
    completedSteps: asInt(raw.completed_steps),
    totalSteps: asInt(raw.total_steps),
    etaSeconds: asInt(raw.eta_seconds),
    recentLines: asList(raw.recent_lines).map((line) => asString(line)).filter((line): line is string => Boolean(line)),
    consolePath: asString(raw.console_path),
    evidenceDir: asString(raw.evidence_dir),
    rollbackAvailable: asBoolean(raw.rollback_available),
    evidenceCaptured: asBoolean(raw.evidence_captured),
    armed: parseArmedState(raw.armed),
  };
}

function normalizeCandidate(raw: unknown): CounterstrikeRunResult["matchedCandidates"][number] | null {
  const item = asDict(raw);
  if (!item) return null;
  return {
    pid: asInt(item.pid),
    user: asString(item.user),
    proc: asString(item.proc),
    exe: asString(item.exe),
    cmdline: asString(item.cmdline),
    reasons: asList(item.reasons).map((reason) => asString(reason)).filter((reason): reason is string => Boolean(reason)),
    score: asInt(item.score),
  };
}

function normalizeRunResult(raw: JsonDict | null): CounterstrikeRunResult | null {
  if (!raw) return null;
  const playbook = playbookMeta(asString(raw.playbook));
  return {
    runId: asString(raw.run_id) ?? "unknown",
    playbook: playbook.id,
    playbookLabel: asString(raw.playbook_label) ?? playbook.label,
    playbookTitle: asString(raw.playbook_title) ?? playbook.title,
    mode: asString(raw.mode) ?? "analyze",
    status: asString(raw.status) ?? "failed",
    startedAt: asString(raw.started_at),
    finishedAt: asString(raw.finished_at),
    updatedAt: asString(raw.updated_at),
    durationSeconds: asInt(raw.duration_seconds),
    summary: asString(raw.summary) ?? "Counterstrike run recorded.",
    host: asString(raw.host),
    snapshotTs: asString(raw.snapshot_ts),
    alertsCount: asInt(raw.alerts_count),
    evidenceCaptured: asBoolean(raw.evidence_captured),
    rollbackAvailable: asBoolean(raw.rollback_available),
    consolePath: asString(raw.console_path),
    evidenceDir: asString(raw.evidence_dir),
    recentLines: asList(raw.recent_lines).map((line) => asString(line)).filter((line): line is string => Boolean(line)),
    errors: asList(raw.errors).map((line) => asString(line)).filter((line): line is string => Boolean(line)),
    matchedCandidates: asList(raw.matched_candidates)
      .map((item) => normalizeCandidate(item))
      .filter((item): item is CounterstrikeRunResult["matchedCandidates"][number] => item !== null),
    quarantinedPaths: asList(raw.quarantined_paths).map((line) => asString(line)).filter((line): line is string => Boolean(line)),
    cronRemovedLines: asInt(raw.cron_removed_lines),
    cronChangedTargets: asList(raw.cron_changed_targets).map((line) => asString(line)).filter((line): line is string => Boolean(line)),
    armedBefore: parseArmedState(raw.armed_before),
  };
}

function sortNewestFirst(a: CounterstrikeRunResult, b: CounterstrikeRunResult): number {
  const aMs = Date.parse(a.finishedAt ?? a.updatedAt ?? a.startedAt ?? "") || 0;
  const bMs = Date.parse(b.finishedAt ?? b.updatedAt ?? b.startedAt ?? "") || 0;
  return bMs - aMs;
}

export async function readCounterstrikeStatus(options?: {
  role?: AppRole | null;
}): Promise<{
  canRun: boolean;
  armed: CounterstrikeArmedState;
  running: CounterstrikeRunState | null;
  last: CounterstrikeRunResult | null;
}> {
  const [status, runningRaw, lastRaw] = await Promise.all([
    readJson(STATUS_PATH),
    readJson(RUNNING_PATH),
    readJson(LAST_PATH),
  ]);

  const running = normalizeRunState(runningRaw);
  const last = normalizeRunResult(lastRaw);
  const armed = running?.armed ?? deriveArmedStateFromStatus(status);

  return {
    canRun: hasRequiredRole(options?.role ?? null, "ops"),
    armed,
    running,
    last,
  };
}

export async function listCounterstrikeHistory(limit = 8): Promise<CounterstrikeRunResult[]> {
  try {
    const entries = await readdir(RUNS_DIR, { withFileTypes: true });
    const runDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => `${RUNS_DIR}/${entry.name}`);
    const results = await Promise.all(
      runDirs.map(async (runDir) => normalizeRunResult(await readJson(`${runDir}/result.json`)))
    );
    return results.filter((item): item is CounterstrikeRunResult => item !== null).sort(sortNewestFirst).slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}
