"use client";

import React from "react";
import { useRouter } from "next/navigation";

type NoticeTone = "info" | "ok" | "bad";

type Notice = {
  tone: NoticeTone;
  title: string;
  detail: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" ? (v as JsonRecord) : null;
}

function asInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

async function postJson(path: string, body?: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await res.json().catch(() => ({}))) as JsonRecord;
  const ok = res.ok && payload.ok !== false;
  return {
    ok,
    status: res.status,
    payload,
    error: asString(payload.error) ?? asString(payload.detail) ?? `Request failed (${res.status})`,
  };
}

const buttonStyle: React.CSSProperties = {
  padding: "8px 11px",
  borderRadius: 999,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg, rgba(255,255,255,0.04))",
  color: "inherit",
  fontWeight: 800,
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.08))",
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  cursor: "not-allowed",
  opacity: 0.66,
};

export default function RemediationQueueControls(props: {
  queuedCount: number;
  dlqCount: number;
  approvalPendingCount: number;
}) {
  const { queuedCount, dlqCount, approvalPendingCount } = props;
  const router = useRouter();

  const [busy, setBusy] = React.useState<null | "hygiene" | "drain" | "replay">(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);

  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function runQueueHygiene() {
    setBusy("hygiene");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Running queue hygiene (drain + replay + verify).",
    });

    try {
      const run = await postJson("/api/ops/remediate-hygiene", {
        drainLimit: 50,
        replayLimit: 20,
      });
      if (!run.ok) {
        setNotice({
          tone: "bad",
          title: "Queue hygiene failed",
          detail: run.error,
        });
        return;
      }

      const detail =
        asString(run.payload.detail) ??
        "Queue hygiene completed.";
      const improved = run.payload.improved === true;
      const cleared = run.payload.cleared === true;

      setNotice({
        tone: cleared || improved ? "ok" : "bad",
        title: cleared
          ? "Queue debt cleared"
          : improved
          ? "Queue debt reduced"
          : "Queue debt still pending",
        detail,
      });
      router.refresh();
    } catch (error: unknown) {
      setNotice({
        tone: "bad",
        title: "Queue hygiene failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  async function drainQueuedNow() {
    setBusy("drain");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Draining queued remediation runs.",
    });

    try {
      const run = await postJson("/api/ops/remediate-drain", { limit: 30 });
      if (!run.ok) {
        setNotice({
          tone: "bad",
          title: "Queue drain failed",
          detail: run.error,
        });
        return;
      }
      const drained = asRecord(run.payload.drained);
      const processed = asInt(drained?.processed);
      const requested = asInt(drained?.requestedLimit);
      const items = Array.isArray(drained?.items) ? drained?.items : [];
      const unresolved = items.filter((item) => {
        const row = asRecord(item);
        if (!row) return false;
        const state = asString(row.state)?.toLowerCase() ?? "";
        return state === "failed" || row.dlq === true || state === "canceled";
      }).length;

      setNotice({
        tone: unresolved > 0 ? "bad" : "ok",
        title: unresolved > 0 ? "Queue drained with follow-up" : "Queue drained",
        detail: `Processed ${processed}/${requested} queued run(s).${unresolved > 0 ? ` ${unresolved} run(s) still failed or moved to DLQ.` : ""}`,
      });
      router.refresh();
    } catch (error: unknown) {
      setNotice({
        tone: "bad",
        title: "Queue drain failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  async function replayDlqNow() {
    setBusy("replay");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Replaying DLQ runs.",
    });

    try {
      const run = await postJson("/api/ops/remediate-replay", { mode: "dlq-batch", limit: 15 });
      if (!run.ok) {
        setNotice({
          tone: "bad",
          title: "DLQ replay failed",
          detail: run.error,
        });
        return;
      }
      const summary = asRecord(run.payload.summary);
      const replayed = asInt(summary?.replayed);
      const skipped = asInt(summary?.skipped);

      setNotice({
        tone: skipped > 0 ? "bad" : "ok",
        title: skipped > 0 ? "DLQ replay partial" : "DLQ replay queued",
        detail: `Replayed ${replayed} run(s), skipped ${skipped}.`,
      });
      router.refresh();
    } catch (error: unknown) {
      setNotice({
        tone: "bad",
        title: "DLQ replay failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  }

  const hasDebt = queuedCount > 0 || dlqCount > 0 || approvalPendingCount > 0;

  return (
    <div
      style={{
        border: "1px solid color-mix(in srgb, var(--dash-card-border) 78%, transparent 22%)",
        borderRadius: 12,
        padding: 10,
        background: "color-mix(in srgb, var(--dash-btn-bg) 86%, transparent 14%)",
        marginBottom: 10,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 13 }}>
        Queue operator controls
      </div>
      <div style={{ fontSize: 12, color: "var(--dash-meta)", marginTop: 4 }}>
        Queue debt can exist while host status is OK. Use these controls to clear queued/DLQ runs and keep auto-remediation healthy.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button
          type="button"
          onClick={() => void runQueueHygiene()}
          disabled={busy !== null}
          style={busy !== null ? { ...primaryButtonStyle, ...disabledButtonStyle } : primaryButtonStyle}
        >
          {busy === "hygiene" ? "Running..." : "Run queue hygiene"}
        </button>
        <button
          type="button"
          onClick={() => void drainQueuedNow()}
          disabled={busy !== null}
          style={busy !== null ? disabledButtonStyle : buttonStyle}
        >
          {busy === "drain" ? "Running..." : "Drain queued"}
        </button>
        <button
          type="button"
          onClick={() => void replayDlqNow()}
          disabled={busy !== null}
          style={busy !== null ? disabledButtonStyle : buttonStyle}
        >
          {busy === "replay" ? "Running..." : "Replay DLQ"}
        </button>
      </div>

      {!hasDebt ? (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--dash-meta)" }}>
          Queue is currently clean. Use controls only if new debt appears.
        </div>
      ) : null}

      {notice ? (
        <div
          style={{
            marginTop: 10,
            borderRadius: 10,
            border:
              notice.tone === "ok"
                ? "1px solid var(--dash-sev-ok-border)"
                : notice.tone === "bad"
                ? "1px solid var(--dash-sev-critical-border)"
                : "1px solid var(--dash-card-border)",
            background:
              notice.tone === "ok"
                ? "var(--dash-sev-ok-bg)"
                : notice.tone === "bad"
                ? "var(--dash-sev-critical-bg)"
                : "color-mix(in srgb, var(--dash-btn-bg) 88%, transparent 12%)",
            color:
              notice.tone === "ok"
                ? "var(--dash-sev-ok-text)"
                : notice.tone === "bad"
                ? "var(--dash-sev-critical-text)"
                : "inherit",
            padding: 9,
            fontSize: 12,
            lineHeight: 1.35,
          }}
          role="status"
          aria-live="polite"
        >
          <div style={{ fontWeight: 800 }}>{notice.title}</div>
          <div style={{ marginTop: 4 }}>{notice.detail}</div>
        </div>
      ) : null}
    </div>
  );
}
