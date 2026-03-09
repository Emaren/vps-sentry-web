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
          disabled={!canReclaim || busy || pending || estimate?.runningCleanup}
        >
          {busy || pending || estimate?.runningCleanup ? "Clearing…" : "Clear Safe Garbage"}
        </button>
        {!canReclaim ? <span className="garbage-tile-action-note">Ops role required.</span> : null}
      </div>

      {feedback ? (
        <div className={`garbage-tile-feedback garbage-tile-feedback-${feedbackTone}`}>{feedback}</div>
      ) : cleanup?.finishedAt ? (
        <div className="garbage-tile-feedback garbage-tile-feedback-meta">
          Last cleanup: freed {fmtBytes(cleanupFreed)} {ageLabel(cleanup.finishedAt)}.
        </div>
      ) : null}
    </div>
  );
}
