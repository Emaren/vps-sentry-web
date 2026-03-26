"use client";

import React from "react";
import type { DashboardGarbageEstimate } from "../_lib/derive";
import {
  ageLabel,
  cleanupPhaseLabel,
  feedbackToneClass,
  fmtBytes,
  fmtDuration,
  liveBadgeClass,
  triggerGarbageReclaim,
} from "./reclaim-utils";

export default function GarbageTile(props: {
  estimate: DashboardGarbageEstimate | null;
  connected: boolean;
  streamLabel: string;
  canReclaim: boolean;
  children?: React.ReactNode;
}) {
  const { canReclaim, children, connected, estimate, streamLabel } = props;
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
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

  const reclaimable = estimate?.reclaimableBytesTotal ?? estimate?.safeReclaimableBytes ?? null;
  const safeNow = estimate?.safeReclaimableBytes ?? reclaimable;
  const recycling = estimate?.rebuildableBytes ?? null;
  const guided = estimate?.guidedReclaimableBytes ?? null;
  const blocked = estimate?.blockedReclaimableBytes ?? null;
  const topCandidates = estimate?.candidates?.slice(0, 4) ?? [];
  const cleanup = estimate?.lastCleanupResult ?? null;
  const cleanupFreed = cleanup?.freedBytesActual ?? cleanup?.freedBytesEstimated ?? null;
  const progress = estimate?.cleanupProgress ?? null;
  const progressLines = progress?.recentLines.slice(-4) ?? [];
  const progressStepLabel = progress?.currentLabel ?? cleanupPhaseLabel(progress?.phase);
  const progressEtaLabel = fmtDuration(progress?.etaSeconds);
  const isCleanupActive = busy || pending || estimate?.runningCleanup || Boolean(progress);
  const supportCards = React.Children.toArray(children);

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
    setFeedback("Launching Space Hog Slaughter in safe mode…");

    try {
      const data = await triggerGarbageReclaim("safe");
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
          ? `Freed ${fmtBytes(freed)}${typeof deleted === "number" ? ` across ${deleted} target(s)` : ""}.`
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
    <div className="power-vitals-reclaim-stage">
      <div className="power-vitals-reclaim-stage-tab-row">
        <div className="power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-kpi-card-garbage power-vitals-reclaim-stage-tab">
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
              : "Reclaim scan pending."}
          </div>

          <div className="garbage-summary-grid">
            <div className="garbage-summary-pill">
              <span className="garbage-summary-label">Safe now</span>
              <span className="garbage-summary-value">{fmtBytes(safeNow)}</span>
            </div>
            <div className="garbage-summary-pill">
              <span className="garbage-summary-label">Recycling</span>
              <span className="garbage-summary-value">{fmtBytes(recycling)}</span>
            </div>
            <div className="garbage-summary-pill">
              <span className="garbage-summary-label">Guided</span>
              <span className="garbage-summary-value">{fmtBytes(guided)}</span>
            </div>
            <div className="garbage-summary-pill">
              <span className="garbage-summary-label">Blocked</span>
              <span className="garbage-summary-value">{fmtBytes(blocked)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="power-vitals-reclaim-stage-body">
        <div className="power-vitals-reclaim-stage-main">
          <div className="power-vitals-reclaim-stage-head">
            <div>
              <div className="power-vitals-reclaim-stage-kicker">Reclaim Workbench</div>
              <div className="power-vitals-reclaim-stage-title">
                Safe hog preview, cleanup controls, and last-pass telemetry.
              </div>
            </div>
            {cleanup ? (
              <div className="power-vitals-reclaim-stage-pill">
                Last pass {cleanup.ok ? "clean" : "partial"} · {fmtBytes(cleanupFreed)}
              </div>
            ) : null}
          </div>

          <div className="garbage-tile-highlights">
            {topCandidates.length > 0 ? (
              topCandidates.map((candidate) => (
                <div key={candidate.id} className="garbage-tile-highlight">
                  <div className="garbage-tile-highlight-copy">
                    <span className="garbage-tile-highlight-label">{candidate.label}</span>
                    <span className="garbage-tile-highlight-note">
                      {candidate.projectLabel ?? candidate.categoryLabel}
                    </span>
                  </div>
                  <span className="garbage-tile-highlight-value">{fmtBytes(candidate.bytes)}</span>
                </div>
              ))
            ) : (
              <div className="garbage-tile-empty">No reclaim candidates matched in the latest scan.</div>
            )}
          </div>

          <div className="garbage-tile-actions">
            <button
              type="button"
              className="garbage-tile-button"
              onClick={handleReclaim}
              disabled={!canReclaim || isCleanupActive}
            >
              {isCleanupActive ? "Slaughtering…" : "Slaughter Safe Hogs"}
            </button>
            <button
              type="button"
              className="garbage-tile-button garbage-tile-button-secondary"
              onClick={() => setPreviewOpen((value) => !value)}
            >
              {previewOpen ? "Hide Preview" : "Preview Hogs"}
            </button>
            {!canReclaim ? <span className="garbage-tile-action-note">Ops role required.</span> : null}
          </div>

          {previewOpen ? (
            <div className="garbage-preview-list" aria-label="Reclaim candidate preview">
              {topCandidates.length > 0 ? (
                topCandidates.map((candidate) => (
                  <div key={`${candidate.id}-preview`} className="garbage-preview-row">
                    <div className="garbage-preview-head">
                      <span className="garbage-preview-title">{candidate.label}</span>
                      <span className="garbage-preview-bytes">{fmtBytes(candidate.bytes)}</span>
                    </div>
                    <div className="garbage-preview-meta">
                      {[
                        candidate.categoryLabel,
                        candidate.riskLabel,
                        candidate.projectLabel,
                        candidate.requiresStop ? "requires stop-plan" : null,
                        candidate.regrows ? "regrows automatically" : null,
                      ]
                        .filter((value): value is string => Boolean(value))
                        .join(" · ")}
                    </div>
                    <div className="garbage-preview-path">{candidate.path}</div>
                    {candidate.explanation ? (
                      <div className="garbage-preview-note">{candidate.explanation}</div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="garbage-tile-empty">No preview rows available yet.</div>
              )}
            </div>
          ) : null}

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

          {cleanup ? (
            <div className="garbage-tile-meta-strip">
              Last pass: {cleanup.ok ? "clean" : "partial"} · reclaimed {fmtBytes(cleanupFreed)} ·{" "}
              {typeof cleanup.deletedCount === "number" ? `${cleanup.deletedCount} target(s)` : "details pending"}
            </div>
          ) : null}

          {feedback ? <div className={feedbackToneClass(feedbackTone)}>{feedback}</div> : null}
        </div>

        {supportCards.length > 0 ? (
          <div className="power-vitals-reclaim-stage-support">{supportCards}</div>
        ) : null}
      </div>
    </div>
  );
}
