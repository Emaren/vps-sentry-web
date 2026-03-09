"use client";

import React from "react";
import Box from "./Box";
import { DEFAULT_COUNTERSTRIKE_PLAYBOOK, type CounterstrikeMode } from "@/lib/ops/counterstrike-playbooks";

type CounterstrikeArmedState = {
  active: boolean;
  label: "armed" | "standby";
  reason: string;
  candidateCount: number;
};

type CounterstrikeRunState = {
  runId: string;
  playbookLabel: string;
  playbookTitle: string;
  mode: CounterstrikeMode;
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

type CounterstrikeRunResult = {
  runId: string;
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
    reasons: string[];
  }>;
  plannedActions: {
    candidateCount: number;
    stopPids: number[];
    quarantinePaths: string[];
    cronRemovedLines: number | null;
    cronChangedTargets: string[];
  } | null;
  quarantinedPaths: string[];
  cronRemovedLines: number | null;
  cronChangedTargets: string[];
  armedBefore: CounterstrikeArmedState | null;
};

type CounterstrikeStatusResponse = {
  ok: boolean;
  canRun: boolean;
  armed: CounterstrikeArmedState;
  running: CounterstrikeRunState | null;
  last: CounterstrikeRunResult | null;
};

type CounterstrikeHistoryResponse = {
  ok: boolean;
  runs: CounterstrikeRunResult[];
};

type CounterstrikeRunResponse = {
  ok?: boolean;
  accepted?: boolean;
  detail?: string;
  error?: string;
  snapshot?: CounterstrikeStatusResponse;
};

type CounterstrikeTileProps = {
  canRun: boolean;
  initialSnapshot?: CounterstrikeStatusResponse | null;
  initialHistory?: CounterstrikeRunResult[];
};

function fmtTs(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function ageLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  const deltaMs = Date.now() - ms;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function fmtDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function statusChipClass(status: string): string {
  if (status === "contained") return "dashboard-chip dashboard-chip-ok";
  if (status === "analysis_only" || status === "dry_run" || status === "standby") return "dashboard-chip";
  if (status === "partial" || status === "blocked") return "dashboard-chip dashboard-chip-warn";
  if (status === "armed") return "dashboard-chip dashboard-chip-bad";
  return "dashboard-chip dashboard-chip-bad";
}

function statusLabel(status: string): string {
  if (status === "standby") return "standby";
  if (status === "analysis_only") return "analysis only";
  if (status === "dry_run") return "dry run";
  if (status === "contained") return "contained";
  if (status === "partial") return "partial";
  if (status === "blocked") return "blocked";
  if (status === "armed") return "armed";
  return status.replace(/_/g, " ");
}

function toneClass(tone: "meta" | "bad" | "ok"): string {
  if (tone === "bad") return "counterstrike-feedback counterstrike-feedback-bad";
  if (tone === "ok") return "counterstrike-feedback counterstrike-feedback-ok";
  return "counterstrike-feedback counterstrike-feedback-meta";
}

function planSummary(plan: CounterstrikeRunResult["plannedActions"]): string | null {
  if (!plan || plan.candidateCount <= 0) return null;
  const cronLabel =
    typeof plan.cronRemovedLines === "number" ? `${plan.cronRemovedLines} cron line(s)` : "0 cron line(s)";
  return `Would stop ${plan.stopPids.length} process(es), quarantine ${plan.quarantinePaths.length} executable(s), and scrub ${cronLabel}.`;
}

export default function CounterstrikeTile(props: CounterstrikeTileProps) {
  const { canRun, initialHistory = [], initialSnapshot = null } = props;
  const [snapshot, setSnapshot] = React.useState<CounterstrikeStatusResponse | null>(initialSnapshot);
  const [history, setHistory] = React.useState<CounterstrikeRunResult[]>(initialHistory);
  const [loading, setLoading] = React.useState(initialSnapshot === null);
  const [historyOpen, setHistoryOpen] = React.useState(initialHistory.length > 0);
  const [consoleOpen, setConsoleOpen] = React.useState(false);
  const [busyMode, setBusyMode] = React.useState<CounterstrikeMode | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = React.useState<"meta" | "bad" | "ok">("meta");
  const running = snapshot?.running ?? null;
  const isRunning = Boolean(running);
  const armed = snapshot?.armed ?? {
    active: false,
    label: "standby",
    reason: "Loading Counterstrike status…",
    candidateCount: 0,
  };

  React.useEffect(() => {
    let cancelled = false;

    async function pullStatus() {
      try {
        const res = await fetch("/api/ops/counterstrike/status", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as CounterstrikeStatusResponse & {
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setSnapshot(data);
          if (data.running) {
            setConsoleOpen(true);
          }
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setFeedbackTone("bad");
          setFeedback(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void pullStatus();
    const interval = window.setInterval(() => {
      void pullStatus();
    }, isRunning ? 3_000 : 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isRunning]);

  React.useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;

    async function pullHistory() {
      try {
        const res = await fetch("/api/ops/counterstrike/history?limit=8", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as CounterstrikeHistoryResponse & {
          error?: string;
        };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setHistory(data.runs);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setFeedbackTone("bad");
          setFeedback(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void pullHistory();
    const interval = window.setInterval(() => {
      void pullHistory();
    }, isRunning ? 5_000 : 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [historyOpen, isRunning]);

  async function handleRun(mode: CounterstrikeMode) {
    if (!canRun || running || busyMode) return;
    setBusyMode(mode);
    setConsoleOpen(true);
    setFeedbackTone("meta");
    setFeedback(`${DEFAULT_COUNTERSTRIKE_PLAYBOOK.label} is starting in ${mode} mode…`);

    try {
      const res = await fetch("/api/ops/counterstrike/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          playbook: DEFAULT_COUNTERSTRIKE_PLAYBOOK.id,
          mode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CounterstrikeRunResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      if (data.snapshot) {
        setSnapshot(data.snapshot);
      }
      setFeedbackTone("meta");
      setFeedback(data.detail || `${DEFAULT_COUNTERSTRIKE_PLAYBOOK.label} started.`);
      if (historyOpen) {
        setHistory((current) => current);
      }
    } catch (error: unknown) {
      setFeedbackTone("bad");
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyMode(null);
    }
  }

  const last = snapshot?.last ?? null;
  const consoleLines = running?.recentLines.length ? running.recentLines : last?.recentLines ?? [];
  const canMutate = canRun && snapshot?.canRun !== false;
  const lastPlan = last?.plannedActions ?? null;
  const lastPlanCopy = planSummary(lastPlan);

  return (
    <Box className="counterstrike-tile" style={{ marginTop: 12 }}>
      <div className="counterstrike-head">
        <div>
          <div className="counterstrike-kicker">Counterstrike</div>
          <div className="counterstrike-title">One-click response playbooks</div>
        </div>
        <div className="dashboard-chip-row">
          <span className={statusChipClass(armed.active ? "armed" : "standby")}>
            {armed.active ? "armed" : "standby"}
          </span>
          {running ? <span className="dashboard-chip dashboard-chip-warn">live run</span> : null}
        </div>
      </div>

      <div className="counterstrike-copy">{DEFAULT_COUNTERSTRIKE_PLAYBOOK.description}</div>

      <div className="counterstrike-meta-grid">
        <div className="counterstrike-meta-card">
          <div className="counterstrike-meta-label">Last run</div>
          <div className="counterstrike-meta-value">{ageLabel(last?.finishedAt ?? last?.updatedAt)}</div>
          <div className="counterstrike-meta-note">{fmtTs(last?.finishedAt ?? last?.updatedAt)}</div>
        </div>
        <div className="counterstrike-meta-card">
          <div className="counterstrike-meta-label">Last result</div>
          <div className="counterstrike-meta-value">{statusLabel(last?.status ?? "standby")}</div>
          <div className="counterstrike-meta-note">{last?.summary ?? armed.reason}</div>
        </div>
        <div className="counterstrike-meta-card">
          <div className="counterstrike-meta-label">Evidence captured</div>
          <div className="counterstrike-meta-value">
            {running?.evidenceCaptured || last?.evidenceCaptured ? "yes" : "not yet"}
          </div>
          <div className="counterstrike-meta-note">
            {running?.evidenceDir ?? last?.evidenceDir ?? "Run evidence will land in the host state dir."}
          </div>
        </div>
        <div className="counterstrike-meta-card">
          <div className="counterstrike-meta-label">Rollback</div>
          <div className="counterstrike-meta-value">
            {running?.rollbackAvailable || last?.rollbackAvailable ? "available" : "manual only"}
          </div>
          <div className="counterstrike-meta-note">
            {armed.reason}
          </div>
        </div>
      </div>

      <div className="counterstrike-actions">
        <button
          type="button"
          className="counterstrike-button counterstrike-button-primary"
          onClick={() => void handleRun("execute")}
          disabled={!canMutate || Boolean(running) || Boolean(busyMode)}
        >
          {busyMode === "execute" ? "Launching…" : DEFAULT_COUNTERSTRIKE_PLAYBOOK.label}
        </button>
        <button
          type="button"
          className="counterstrike-button"
          onClick={() => void handleRun("analyze")}
          disabled={!canMutate || Boolean(running) || Boolean(busyMode)}
        >
          {busyMode === "analyze" ? "Launching…" : "Analyze Only"}
        </button>
        <button
          type="button"
          className="counterstrike-button"
          onClick={() => void handleRun("dry-run")}
          disabled={!canMutate || Boolean(running) || Boolean(busyMode)}
        >
          {busyMode === "dry-run" ? "Launching…" : "Dry Run"}
        </button>
        <button
          type="button"
          className="counterstrike-button counterstrike-button-ghost"
          onClick={() => setHistoryOpen((value) => !value)}
        >
          {historyOpen ? "Hide History" : "History"}
        </button>
        <button
          type="button"
          className="counterstrike-button counterstrike-button-ghost"
          onClick={() => setConsoleOpen((value) => !value)}
        >
          {consoleOpen ? "Hide Console" : "Open Console"}
        </button>
      </div>

      {!canMutate ? (
        <div className="counterstrike-note">Ops role required to launch Counterstrike playbooks.</div>
      ) : null}

      {running ? (
        <div className="counterstrike-progress">
          <div className="counterstrike-progress-head">
            <div>
              <div className="counterstrike-progress-title">{running.currentLabel ?? "Counterstrike in progress"}</div>
              <div className="counterstrike-progress-meta">
                {[
                  running.phase ? `phase: ${running.phase}` : null,
                  running.completedSteps !== null && running.totalSteps !== null
                    ? `${running.completedSteps}/${running.totalSteps}`
                    : null,
                  running.etaSeconds ? `ETA ~ ${fmtDuration(running.etaSeconds)}` : null,
                  running.updatedAt ? `updated ${ageLabel(running.updatedAt)}` : null,
                ]
                  .filter((value): value is string => Boolean(value))
                  .join(" · ")}
              </div>
            </div>
            <span className="dashboard-chip dashboard-chip-warn">{statusLabel(running.mode)}</span>
          </div>
          {running.currentCommand ? (
            <div className="counterstrike-command">{running.currentCommand}</div>
          ) : null}
        </div>
      ) : null}

      {!running &&
      lastPlan &&
      lastPlanCopy &&
      (last?.status === "analysis_only" || last?.status === "dry_run") ? (
        <div className="counterstrike-plan">
          <div className="counterstrike-plan-title">Planned response</div>
          <div className="counterstrike-plan-copy">{lastPlanCopy}</div>
          <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
            <span className="dashboard-chip">targets {lastPlan.candidateCount}</span>
            <span className="dashboard-chip">stop {lastPlan.stopPids.length}</span>
            <span className="dashboard-chip">quarantine {lastPlan.quarantinePaths.length}</span>
            {typeof lastPlan.cronRemovedLines === "number" ? (
              <span className="dashboard-chip">cron {lastPlan.cronRemovedLines}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {consoleOpen ? (
        <div className="counterstrike-console">
          <div className="counterstrike-console-title">Battlefeed console</div>
          {consoleLines.length > 0 ? (
            consoleLines.slice(-8).map((line, index) => (
              <div key={`${running?.runId ?? last?.runId ?? "console"}-${index}`} className="counterstrike-console-line">
                {line}
              </div>
            ))
          ) : (
            <div className="counterstrike-console-empty">
              {loading ? "Loading Counterstrike console…" : "No Counterstrike console output recorded yet."}
            </div>
          )}
        </div>
      ) : null}

      {feedback ? <div className={toneClass(feedbackTone)}>{feedback}</div> : null}

      {historyOpen ? (
        <div className="counterstrike-history">
          <div className="counterstrike-history-head">
            <div className="counterstrike-history-title">Battlefeed</div>
            <span className="dashboard-chip">{history.length} recent run{history.length === 1 ? "" : "s"}</span>
          </div>
          {history.length > 0 ? (
            <div className="counterstrike-history-list">
              {history.map((entry) => {
                const entryPlanCopy = planSummary(entry.plannedActions);
                return (
                  <div key={entry.runId} className="counterstrike-history-entry">
                  <div className="counterstrike-history-entry-head">
                    <div>
                      <span className={statusChipClass(entry.status)}>{statusLabel(entry.status)}</span>
                      <span className="counterstrike-history-entry-time">{fmtTs(entry.finishedAt ?? entry.updatedAt)}</span>
                    </div>
                    <div className="counterstrike-history-entry-mode">{entry.playbookLabel}</div>
                  </div>
                  <div className="counterstrike-history-entry-summary">{entry.summary}</div>
                  {entryPlanCopy && (entry.status === "analysis_only" || entry.status === "dry_run") ? (
                    <div className="counterstrike-history-entry-plan">{entryPlanCopy}</div>
                  ) : null}
                  <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                    <span className="dashboard-chip">{entry.mode}</span>
                    {typeof entry.alertsCount === "number" ? (
                      <span className="dashboard-chip">alerts {entry.alertsCount}</span>
                    ) : null}
                    {entry.plannedActions ? (
                      <span className="dashboard-chip">targets {entry.plannedActions.candidateCount}</span>
                    ) : null}
                    {typeof entry.cronRemovedLines === "number" ? (
                      <span className="dashboard-chip">cron removed {entry.cronRemovedLines}</span>
                    ) : null}
                    {entry.quarantinedPaths.length > 0 ? (
                      <span className="dashboard-chip">quarantine {entry.quarantinedPaths.length}</span>
                    ) : null}
                    {entry.evidenceCaptured ? <span className="dashboard-chip dashboard-chip-ok">evidence</span> : null}
                  </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="counterstrike-console-empty">No Counterstrike runs recorded yet.</div>
          )}
        </div>
      ) : null}
    </Box>
  );
}
