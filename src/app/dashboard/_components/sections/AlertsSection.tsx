"use client";
// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/AlertsSection.tsx

import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import Box from "../Box";
import { deriveThreatIndicators } from "../../_lib/derive";

type AlertItem = {
  title?: string;
  detail?: string;
  severity?: "info" | "warn" | "critical";
  code?: string;
  ts?: string;
  [k: string]: any;
};

async function copyText(txt: string) {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch {
    try {
      // eslint-disable-next-line no-alert
      prompt("Copy to clipboard:", txt);
      return true;
    } catch {
      return false;
    }
  }
}

async function post(endpoint: string) {
  const res = await fetch(endpoint, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function sevBadge(sev?: AlertItem["severity"]) {
  const s = sev ?? "warn";
  const label = s.toUpperCase();

  const bg =
    s === "critical"
      ? "rgba(255,80,80,0.14)"
      : s === "warn"
      ? "rgba(255,170,60,0.12)"
      : "rgba(120,255,160,0.10)";

  const border =
    s === "critical"
      ? "1px solid rgba(255,80,80,0.30)"
      : s === "warn"
      ? "1px solid rgba(255,170,60,0.26)"
      : "1px solid rgba(120,255,160,0.22)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        background: bg,
        border,
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: 0.2,
        opacity: 0.95,
      }}
      title={`severity: ${s}`}
    >
      {label}
    </span>
  );
}

function compactAlertText(a: AlertItem, idx: number) {
  const title = (a.title ?? `Alert ${idx + 1}`).trim();
  const detail = (a.detail ?? "").trim();

  const lines: string[] = [];
  lines.push(title);
  if (detail) lines.push(detail);
  if (a.code) lines.push(`code: ${a.code}`);
  if (a.ts) lines.push(`ts: ${a.ts}`);
  return lines.join("\n\n");
}

export default function AlertsSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;
  const indicators = deriveThreatIndicators(s);
  const criticalIndicators = indicators.filter((x) => x.severity === "critical");

  const alertsRaw: AlertItem[] = Array.isArray((s as any).alerts) ? ((s as any).alerts as AlertItem[]) : [];
  const alertsCount = typeof (s as any).alerts_count === "number" ? (s as any).alerts_count : alertsRaw.length;

  // Optional extra context (if/when agent emits it):
  // - actionable_alerts_count: number
  // - alerts_actionable: AlertItem[]
  // If present, we surface it. Otherwise, we treat s.alerts as the best list available.
  const actionableCount =
    typeof (s as any).actionable_alerts_count === "number" ? ((s as any).actionable_alerts_count as number) : null;

  const alertsActionable: AlertItem[] | null = Array.isArray((s as any).alerts_actionable)
    ? ((s as any).alerts_actionable as AlertItem[])
    : null;

  const listToRender = alertsActionable ?? alertsRaw;

  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const topLine = (() => {
    if (alertsCount === 0) return "✅ No alerts.";
    if (actionableCount !== null && actionableCount !== alertsCount) {
      const suppressed = Math.max(0, alertsCount - actionableCount);
      return `Alerts: ${actionableCount} actionable · ${suppressed} suppressed noise · ${alertsCount} total`;
    }
    return `Alerts: ${alertsCount}`;
  })();

  const alertCards: React.ReactNode[] = [];
  for (let i = 0; i < listToRender.length; i++) {
    const a = listToRender[i];
    const title = (a.title ?? `Alert ${i + 1}`).trim();

    alertCards.push(
      <Box key={i}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {sevBadge(a.severity)}
            <div style={{ fontWeight: 800 }}>{title}</div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              style={btnSmall()}
              onClick={async () => {
                const ok = await copyText(compactAlertText(a, i));
                setToast(ok ? "Alert copied." : "Copy failed.");
              }}
            >
              Copy
            </button>
          </div>
        </div>

        {a.detail ? (
          <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
            {a.detail}
          </pre>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.75 }}>— no detail</div>
        )}

        {(a.code || a.ts) && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            {a.code ? (
              <span style={{ marginRight: 10 }}>
                <b>code:</b> {a.code}
              </span>
            ) : null}
            {a.ts ? (
              <span>
                <b>ts:</b> {a.ts}
              </span>
            ) : null}
          </div>
        )}
      </Box>
    );
  }

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Alerts</h2>

      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b>
      </div>
      {criticalIndicators.length > 0 ? (
        <Box>
          <div style={{ fontWeight: 800, color: "#ffb4b4" }}>
            Potential compromise pattern detected
          </div>
          <div style={{ marginTop: 8 }}>
            Combined security-surface changes were detected in this snapshot. Treat this as high-priority and run runtime process + outbound connection checks.
          </div>
        </Box>
      ) : null}

      <Box>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>{topLine}</div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              style={btnSmall()}
              onClick={async () => {
                try {
                  setBusy("report");
                  await post("/api/ops/report-now");
                  setToast("Report triggered. Refresh in a few seconds.");
                } catch (e: any) {
                  setToast(`Failed: ${String(e?.message ?? e)}`);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "report" ? "Working…" : "Send report now"}
            </button>

            <button
              style={btnSmall()}
              onClick={async () => {
                const txt =
                  listToRender.length === 0
                    ? "No alerts."
                    : listToRender.map((a, i) => compactAlertText(a, i)).join("\n\n---\n\n");
                const ok = await copyText(txt);
                setToast(ok ? "Alerts copied." : "Copy failed.");
              }}
            >
              Copy all
            </button>
          </div>
        </div>

        {alertsCount === 0 ? (
          <div style={{ marginTop: 8, opacity: 0.75 }}>All good.</div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            Tip: actionable alerts are what we want paging you; suppressed alerts are usually “public ports” noise when everything is allowlisted.
          </div>
        )}
      </Box>

      {alertsCount === 0 ? (
        <div style={{ marginTop: 10 }}>
          <Box>✅ No alerts.</Box>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>{alertCards}</div>
      )}

      {toast ? (
        <div style={{ marginTop: 10 }}>
          <Box>
            <div style={{ fontWeight: 900 }}>Notice</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>{toast}</div>
          </Box>
        </div>
      ) : null}
    </section>
  );
}

function btnSmall(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    padding: "8px 10px",
    fontWeight: 900,
    cursor: "pointer",
    color: "inherit",
    fontSize: 12,
  };
}
