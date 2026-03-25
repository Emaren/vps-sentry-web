"use client";

import React from "react";
import type {
  DashboardGarbageCandidate,
  DashboardGarbageCategoryKey,
  DashboardGarbageEstimate,
} from "../_lib/derive";
import {
  ageLabel,
  feedbackToneClass,
  fmtBytes,
  liveBadgeClass,
  triggerGarbageReclaim,
  type GarbageReclaimProfile,
} from "./reclaim-utils";

type ReclaimCategoryTileProps = {
  title: string;
  subtitle: string;
  category: Extract<DashboardGarbageCategoryKey, "garbage" | "recycling">;
  actionLabel: string;
  emptyLabel: string;
  estimate: DashboardGarbageEstimate | null;
  connected: boolean;
  streamLabel: string;
  canReclaim: boolean;
};

function profileForCategory(category: ReclaimCategoryTileProps["category"]): GarbageReclaimProfile {
  return category === "recycling" ? "recycling" : "garbage";
}

function countLabel(candidates: DashboardGarbageCandidate[]): string {
  const count = candidates.length;
  return `${count} target${count === 1 ? "" : "s"}`;
}

export default function ReclaimCategoryTile(props: ReclaimCategoryTileProps) {
  const { actionLabel, canReclaim, category, connected, emptyLabel, estimate, streamLabel, subtitle, title } = props;
  const [busy, setBusy] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = React.useState<"ok" | "bad" | "meta">("meta");

  const candidates = (estimate?.candidates ?? []).filter((candidate) => candidate.category === category);
  const totalBytes =
    estimate?.categoryTotals?.find((row) => row.key === category)?.bytes ??
    candidates.reduce((sum, candidate) => sum + (candidate.bytes ?? 0), 0);
  const topCandidates = candidates.slice(0, 4);

  async function handleRun() {
    if (!canReclaim || busy) return;
    setBusy(true);
    setFeedbackTone("meta");
    setFeedback(`${actionLabel} starting…`);

    try {
      const data = await triggerGarbageReclaim(profileForCategory(category));
      if (data.accepted) {
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
    <div className="power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-kpi-card-garbage-sub">
      <div className="power-vitals-kpi-headline">
        <div className="power-vitals-kpi-label">{title}</div>
        <span className={liveBadgeClass(connected)}>{streamLabel}</span>
      </div>

      <div className="power-vitals-kpi-value">{fmtBytes(totalBytes)}</div>

      <div className="power-vitals-kpi-meta">
        {subtitle}
        {estimate?.measuredAt ? ` · scanned ${ageLabel(estimate.measuredAt)}` : ""}
      </div>

      {topCandidates.length > 0 ? (
        <div className="garbage-preview-list">
          {topCandidates.map((candidate) => (
            <div key={candidate.id} className="garbage-preview-row">
              <div className="garbage-preview-head">
                <span className="garbage-preview-title">{candidate.label}</span>
                <span className="garbage-preview-bytes">{fmtBytes(candidate.bytes)}</span>
              </div>
              <div className="garbage-preview-meta">
                {[candidate.projectLabel, candidate.riskLabel, candidate.regrows ? "rebuilds later" : null]
                  .filter((value): value is string => Boolean(value))
                  .join(" · ")}
              </div>
              {previewOpen ? <div className="garbage-preview-path">{candidate.path}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="garbage-tile-empty">{emptyLabel}</div>
      )}

      <div className="garbage-tile-actions">
        <button
          type="button"
          className="garbage-tile-button garbage-tile-button-secondary"
          onClick={() => setPreviewOpen((value) => !value)}
        >
          {previewOpen ? "Hide Preview" : `Preview ${countLabel(candidates)}`}
        </button>
        <button
          type="button"
          className="garbage-tile-button"
          onClick={handleRun}
          disabled={!canReclaim || busy || candidates.length === 0}
        >
          {busy ? "Working…" : actionLabel}
        </button>
      </div>

      {feedback ? <div className={feedbackToneClass(feedbackTone)}>{feedback}</div> : null}
    </div>
  );
}
