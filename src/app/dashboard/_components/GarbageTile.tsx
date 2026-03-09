"use client";

import React from "react";
import type { DashboardGarbageEstimate } from "../_lib/derive";

type GarbageReclaimResponse = {
  ok?: boolean;
  accepted?: boolean;
  detail?: string;
  error?: string;
  cleanup?: {
    freedBytesActual?: number | null;
    freedBytesEstimated?: number | null;
    deletedCount?: number | null;
  } | null;
};

function fmtBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(decimals)}${units[unitIndex]}`;
}

function ageLabel(ts: string | null | undefined): string {
  if (!ts) return "—";
  const ms = Date.parse(ts);
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

function fmtDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function cleanupPhaseLabel(phase: string | null | undefined): string {
  switch ((phase ?? "").trim().toLowerCase()) {
    case "scanning":
      return "Scanning safe cleanup candidates";
    case "reclaiming":
      return "Removing matched garbage";
    case "rescanning":
      return "Re-scanning reclaimable space";
    case "publishing":
      return "Publishing refreshed snapshot";
    default:
      return "Cleanup in progress";
  }
}

function liveBadgeClass(connected: boolean): string {
  if (connected) return "power-vitals-live-badge power-vitals-live-badge-snapshot";
  return "power-vitals-live-badge power-vitals-live-badge-disconnected";
}

export default function GarbageTile(props: {
  estimate: DashboardGarbageEstimate | null;
  connected: boolean;
  streamLabel: string;
  canReclaim: boolean;
}) {
  const { canReclaim, connected, estimate, streamLabel } = props;
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [sawRunningProgress, setSawRunningProgress] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = React.useState<"ok" | "bad" | "meta">("meta");
  const pendingTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
      }
    };
  }, []);

  const reclaimable = estimate?.safeReclaimableBytes ?? estimate?.reclaimableBytesTotal ?? null;
  const topBuckets = estimate?.buckets.slice(0, 3) ?? [];
  const cleanup = estimate?.lastCleanupResult ?? null;
  const cleanupFreed = cleanup?.freedBytesActual ?? cleanup?.freedBytesEstimated ?? null;
  const progress = estimate?.cleanupProgress ?? null;
  const progressLines = progress?.recentLines.slice(-4) ?? [];
  const progressStepLabel = progress?.currentLabel ?? cleanupPhaseLabel(progress?.phase);
  const progressEtaLabel = fmtDuration(progress?.etaSeconds);
  const isCleanupActive = busy || pending || estimate?.runningCleanup || Boolean(progress);

  React.useEffect(() => {
    if (estimate?.runningCleanup || progress) {
      setSawRunningProgress(true);
    }
  }, [estimate?.runningCleanup, progress]);

  React.useEffect(() => {
    if (!pending || !sawRunningProgress) return;
    if (estimate?.runningCleanup || progress) return;
    setPending(false);
    setSawRunningProgress(false);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (feedbackTone === "meta" && feedback && feedback.toLowerCase().includes("cleanup started")) {
      setFeedback(null);
    }
  }, [pending, sawRunningProgress, estimate?.runningCleanup, progress, feedback, feedbackTone]);

  async function handleReclaim() {
    if (!canReclaim || busy) return;
    setBusy(true);
    setFeedbackTone("meta");
    setFeedback("Clearing safe garbage…");

    try {
      const res = await fetch("/api/ops/garbage/reclaim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ profile: "safe" }),
      });
      const data = (await res.json().catch(() => ({}))) as GarbageReclaimResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      if (data.accepted) {
        setPending(true);
        setSawRunningProgress(false);
        if (pendingTimerRef.current !== null) {
          window.clearTimeout(pendingTimerRef.current);
        }
        pendingTimerRef.current = window.setTimeout(() => {
          setPending(false);
          pendingTimerRef.current = null;
        }, 15_000);
        setFeedbackTone("meta");
        setFeedback(data.detail || "Cleanup started. The tile will refresh after the reclaim pass completes.");
        return;
      }

      const freed = data.cleanup?.freedBytesActual ?? data.cleanup?.freedBytesEstimated ?? null;
      const deleted = data.cleanup?.deletedCount ?? null;
      setFeedbackTone("ok");
      setFeedback(
        freed !== null
          ? `Freed ${fmtBytes(freed)}${typeof deleted === "number" ? ` across ${deleted} item(s)` : ""}.`
          : "Cleanup completed."
      );
    } catch (error: unknown) {
      setFeedbackTone("bad");
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-kpi-card-garbage">
      <div className="power-vitals-kpi-headline">
        <div className="power-vitals-kpi-label">Reclaimable Space</div>
        <span className={liveBadgeClass(connected)}>{streamLabel}</span>
      </div>

      <div className="power-vitals-kpi-value">{fmtBytes(reclaimable)}</div>

      <div className="power-vitals-kpi-meta">
        {estimate?.measuredAt
          ? `Scanned ${ageLabel(estimate.measuredAt)}${
              typeof estimate.ttlSeconds === "number" && estimate.ttlSeconds > 0
                ? ` · refreshes about every ${Math.max(1, Math.round(estimate.ttlSeconds / 60))}m`
                : ""
            }.`
          : "Safe-garbage scan pending."}
      </div>

      <div className="garbage-tile-highlights">
        {topBuckets.length > 0 ? (
          topBuckets.map((bucket) => (
            <div key={bucket.key} className="garbage-tile-highlight">
              <span className="garbage-tile-highlight-label">{bucket.label}</span>
              <span className="garbage-tile-highlight-value">{fmtBytes(bucket.bytes)}</span>
            </div>
          ))
        ) : (
          <div className="garbage-tile-empty">No safe garbage buckets matched in the latest scan.</div>
        )}
      </div>

      <div className="garbage-tile-actions">
        <button
          type="button"
          className="garbage-tile-button"
          onClick={handleReclaim}
          disabled={!canReclaim || isCleanupActive}
        >
          {isCleanupActive ? "Clearing…" : "Clear Safe Garbage"}
        </button>
        {!canReclaim ? <span className="garbage-tile-action-note">Ops role required.</span> : null}
      </div>

      {progress ? (
        <div className="garbage-tile-progress">
          <div className="garbage-tile-progress-head">
            <div className="garbage-tile-progress-title">{progressStepLabel}</div>
            {typeof progress.completedSteps === "number" && typeof progress.totalSteps === "number" ? (
              <div className="garbage-tile-progress-count">
                {Math.max(0, progress.completedSteps)}/{Math.max(0, progress.totalSteps)}
              </div>
            ) : null}
          </div>
          <div className="garbage-tile-progress-meta">
            {[
              progress?.phase ? cleanupPhaseLabel(progress.phase) : null,
              progressEtaLabel ? `ETA ~ ${progressEtaLabel}` : null,
              progress?.updatedAt ? `updated ${ageLabel(progress.updatedAt)}` : null,
              typeof progress?.errorsCount === "number" && progress.errorsCount > 0
                ? `${progress.errorsCount} error${progress.errorsCount === 1 ? "" : "s"}`
                : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ")}
          </div>
          {progress.currentCommand || progressLines.length > 0 ? (
            <div className="garbage-tile-console" aria-label="Cleanup progress log">
              {progressLines.length > 0 ? (
                progressLines.map((line, index) => (
                  <div key={`${progress.updatedAt ?? "line"}-${index}`} className="garbage-tile-console-line">
                    {line}
                  </div>
                ))
              ) : progress.currentCommand ? (
                <div className="garbage-tile-console-line">{progress.currentCommand}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {feedback ? (
        <div className={`garbage-tile-feedback garbage-tile-feedback-${feedbackTone}`}>{feedback}</div>
      ) : cleanup?.finishedAt ? (
        <div
          className={`garbage-tile-feedback ${
            cleanup.ok === false && cleanup.errors.length > 0
              ? "garbage-tile-feedback-bad"
              : "garbage-tile-feedback-meta"
          }`}
        >
          {cleanup.ok === false && cleanup.errors.length > 0
            ? `Partial cleanup: freed ${fmtBytes(cleanupFreed)} ${ageLabel(cleanup.finishedAt)} with ${cleanup.errors.length} error${
                cleanup.errors.length === 1 ? "" : "s"
              }.`
            : `Last cleanup: freed ${fmtBytes(cleanupFreed)} ${ageLabel(cleanup.finishedAt)}.`}
        </div>
      ) : null}
    </div>
  );
}
