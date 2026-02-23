// /var/www/vps-sentry-web/src/app/dashboard/dashboard-actions.tsx
"use client";

import Link from "next/link";
import React from "react";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";
import { boxStyle, subtleText } from "./_styles";

type JsonResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  detail?: string;
  warning?: string;
  emailed?: boolean;
  triggered?: boolean;
  to?: string;
  subject?: string;
  code?: string;
  drained?: {
    ok?: boolean;
    processed?: number;
    requestedLimit?: number;
    items?: Array<{ state?: string; dlq?: boolean; error?: string | null }>;
  };
  summary?: {
    ok?: boolean;
    replayed?: number;
    skipped?: number;
  };
};

const linkStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg, rgba(255,255,255,0.04))",
  color: "inherit",
  textDecoration: "none",
  fontWeight: 800,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
  color: "inherit",
  fontWeight: 800,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.65,
  cursor: "not-allowed",
};

async function postJson(path: string, body?: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: JsonResponse = await res.json().catch(() => ({} as JsonResponse));
  if (!res.ok) {
    const parts = [data?.error, data?.detail, data?.code].filter(Boolean);
    throw new Error(parts.length > 0 ? parts.join(" | ") : `${path} ${res.status}`);
  }
  return data;
}

function asErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function DashboardActions(props: { userRole: AppRole }) {
  const canRunOps = hasRequiredRole(props.userRole, "ops");
  const [busy, setBusy] = React.useState<null | "test-email" | "report-now" | "drain-queue" | "replay-dlq">(null);
  const [notice, setNotice] = React.useState<
    null | { tone: "info" | "ok" | "bad"; title: string; detail: string }
  >(null);

  React.useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  async function sendTestEmail() {
    setBusy("test-email");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Sending test email now.",
    });

    try {
      await postJson("/api/ops/test-email");
      setNotice({
        tone: "ok",
        title: "Test email sent",
        detail: "Delivery accepted by SMTP.",
      });
    } catch (e: unknown) {
      console.error(e);
      setNotice({
        tone: "bad",
        title: "Test email failed",
        detail: asErrorMessage(e, "Failed to send test email"),
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendReportNow() {
    setBusy("report-now");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Triggering scan and sending report email.",
    });

    try {
      const data = await postJson("/api/ops/report-now");
      const subjectPart = data?.subject ? ` Subject: ${data.subject}` : "";
      const recipientPart = data?.to ? ` To: ${data.to}.` : "";
      const fallbackDetail = data?.emailed
        ? `Report sent.${recipientPart}${subjectPart}`
        : data?.warning
        ? data.warning
        : data?.triggered
        ? "Report trigger accepted."
        : "Report completed.";

      setNotice({
        tone: data?.ok === false ? "bad" : "ok",
        title: data?.ok === false ? "Report failed" : "Report sent",
        detail: data?.message ?? fallbackDetail,
      });
    } catch (e: unknown) {
      console.error(e);
      setNotice({
        tone: "bad",
        title: "Report failed",
        detail: asErrorMessage(e, "Failed to trigger report"),
      });
    } finally {
      setBusy(null);
    }
  }

  async function drainQueueNow() {
    setBusy("drain-queue");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Draining queued remediation runs now.",
    });

    try {
      const data = await postJson("/api/ops/remediate-drain", { limit: 20 });
      const processed = data?.drained?.processed ?? 0;
      const requested = data?.drained?.requestedLimit ?? 20;
      const failed = Array.isArray(data?.drained?.items)
        ? data.drained.items.filter((x) => x?.state === "failed" || x?.dlq).length
        : 0;
      setNotice({
        tone: data?.ok === false || data?.drained?.ok === false ? "bad" : failed > 0 ? "bad" : "ok",
        title: failed > 0 ? "Queue drained with failures" : "Queue drained",
        detail: `Processed ${processed}/${requested} queued run(s).${failed > 0 ? ` ${failed} run(s) still failed/DLQ.` : ""}`,
      });
    } catch (e: unknown) {
      console.error(e);
      setNotice({
        tone: "bad",
        title: "Queue drain failed",
        detail: asErrorMessage(e, "Failed to drain queue"),
      });
    } finally {
      setBusy(null);
    }
  }

  async function replayDlqBatch() {
    setBusy("replay-dlq");
    setNotice({
      tone: "info",
      title: "Working...",
      detail: "Replaying DLQ batch now.",
    });

    try {
      const data = await postJson("/api/ops/remediate-replay", { mode: "dlq-batch", limit: 10 });
      const replayed = data?.summary?.replayed ?? 0;
      const skipped = data?.summary?.skipped ?? 0;
      const ok = data?.ok !== false && data?.summary?.ok !== false;
      setNotice({
        tone: ok ? "ok" : "bad",
        title: ok ? "DLQ replay queued" : "DLQ replay failed",
        detail: `Replayed ${replayed} run(s), skipped ${skipped}.`,
      });
    } catch (e: unknown) {
      console.error(e);
      setNotice({
        tone: "bad",
        title: "DLQ replay failed",
        detail: asErrorMessage(e, "Failed to replay DLQ batch"),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/" style={linkStyle}>
          ← Back to landing
        </Link>

        {canRunOps ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={sendTestEmail}
              style={busy !== null ? disabledButtonStyle : buttonStyle}
            >
              {busy === "test-email" ? "Working..." : "Send test email"}
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={sendReportNow}
              style={busy !== null ? disabledButtonStyle : buttonStyle}
            >
              {busy === "report-now" ? "Working..." : "Send report now"}
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={drainQueueNow}
              style={busy !== null ? disabledButtonStyle : buttonStyle}
            >
              {busy === "drain-queue" ? "Working..." : "Drain queue now"}
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={replayDlqBatch}
              style={busy !== null ? disabledButtonStyle : buttonStyle}
            >
              {busy === "replay-dlq" ? "Working..." : "Replay DLQ batch"}
            </button>
          </>
        ) : (
          <span style={{ ...subtleText, alignSelf: "center" }}>
            Ops actions require an ops/admin/owner role.
          </span>
        )}
      </div>

      {notice ? (
        <div
          style={{
            ...boxStyle,
            marginTop: 10,
            borderColor:
              notice.tone === "ok"
                ? "rgba(34,197,94,0.35)"
                : notice.tone === "bad"
                ? "rgba(239,68,68,0.35)"
                : "rgba(59,130,246,0.35)",
            background:
              notice.tone === "ok"
                ? "rgba(34,197,94,0.08)"
                : notice.tone === "bad"
                ? "rgba(239,68,68,0.10)"
                : "rgba(59,130,246,0.08)",
            padding: 10,
          }}
          role="status"
          aria-live="polite"
        >
          <div style={{ fontWeight: 800 }}>{notice.title}</div>
          <div style={{ marginTop: 4, ...subtleText }}>{notice.detail}</div>
        </div>
      ) : null}
    </div>
  );
}
