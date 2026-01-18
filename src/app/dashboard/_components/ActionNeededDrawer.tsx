"use client";

// src/app/dashboard/_components/ActionNeededDrawer.tsx
import React from "react";
import type { ActionItem, ActionSummary } from "../_lib/explain";
import { boxStyle, subtleText, tinyText } from "../_styles";

function sevBadge(sev: ActionItem["severity"]) {
  const label = sev;
  const bg =
    sev === "CRITICAL"
      ? "rgba(255,80,80,0.15)"
      : sev === "HIGH"
      ? "rgba(255,170,60,0.12)"
      : sev === "MEDIUM"
      ? "rgba(120,180,255,0.12)"
      : "rgba(255,255,255,0.06)";

  const border =
    sev === "CRITICAL"
      ? "1px solid rgba(255,80,80,0.35)"
      : sev === "HIGH"
      ? "1px solid rgba(255,170,60,0.30)"
      : sev === "MEDIUM"
      ? "1px solid rgba(120,180,255,0.25)"
      : "1px solid rgba(255,255,255,0.12)";

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
        fontWeight: 800,
        letterSpacing: 0.2,
      }}
    >
      {label}
    </span>
  );
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

export default function ActionNeededDrawer(props: {
  open: boolean;
  onClose: () => void;
  summary: ActionSummary;
  asOfLabel: string;
}) {
  const { open, onClose, summary, asOfLabel } = props;

  const [busy, setBusy] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-end",
        padding: 12,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(980px, 100%)",
          maxHeight: "85vh",
          overflow: "auto",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(10,10,10,0.96)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>What’s wrong (and what to do)</div>
            <div style={{ ...tinyText, marginTop: 6 }}>
              As of <b>{asOfLabel}</b>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.05)",
              padding: "10px 12px",
              fontWeight: 800,
              cursor: "pointer",
              color: "inherit",
              height: 42,
            }}
          >
            Close
          </button>
        </div>

        <div style={{ ...boxStyle, marginTop: 12 }}>
          <div style={{ fontWeight: 900 }}>
            Status: <span style={{ fontWeight: 1000 }}>{summary.headline}</span>
          </div>

          {summary.reasons?.length ? (
            <ul style={{ marginTop: 10, paddingLeft: 18, ...subtleText }}>
              {summary.reasons.map((r, idx) => (
                <li key={idx} style={{ marginTop: 4 }}>
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ marginTop: 10, ...subtleText }}>No issues detected.</div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setToast("AI Explain: coming next (this is the deterministic explainer for now).");
              }}
              style={btn()}
            >
              AI Explain
            </button>
            <button
              onClick={() => {
                // “Fix now” = safe actions only, we surface them per item.
                setToast("Fix Now uses the safe buttons below (Report/Test/Refresh).");
              }}
              style={btn()}
            >
              Fix Now
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {summary.items.map((it) => (
            <div key={it.id} style={boxStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {sevBadge(it.severity)}
                  <div style={{ fontWeight: 900 }}>{it.title}</div>
                </div>
              </div>

              <div style={{ marginTop: 8, ...subtleText }}>{it.summary}</div>

              {it.evidence ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 800, opacity: 0.9 }}>
                    Evidence (geek detail)
                  </summary>
                  <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
                    {it.evidence}
                  </pre>
                </details>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900 }}>Recommended steps</div>
                <ol style={{ marginTop: 8, paddingLeft: 18, ...subtleText }}>
                  {it.recommendedSteps.map((s, idx) => (
                    <li key={idx} style={{ marginTop: 4 }}>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>

              {it.safeActions?.length ? (
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {it.safeActions.map((a, idx) => {
                    if (a.kind === "REFRESH") {
                      return (
                        <button
                          key={idx}
                          style={btn()}
                          onClick={() => {
                            location.reload();
                          }}
                        >
                          {a.label}
                        </button>
                      );
                    }
                    if (a.kind === "LINK") {
                      return (
                        <a key={idx} href={a.href} style={{ ...btn(), display: "inline-flex", textDecoration: "none" }}>
                          {a.label}
                        </a>
                      );
                    }
                    return (
                      <button
                        key={idx}
                        style={btn()}
                        onClick={async () => {
                          try {
                            setBusy(a.endpoint);
                            const out = await post(a.endpoint);
                            setToast(out?.ok ? "Done." : "Done (check results).");
                          } catch (e: any) {
                            setToast(`Failed: ${String(e?.message ?? e)}`);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        {busy === a.endpoint ? "Working…" : a.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {it.copyCommands?.length ? (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 900, opacity: 0.9 }}>
                    Copy commands (manual fix)
                  </summary>
                  <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
                    {it.copyCommands.join("\n")}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </div>

        {toast ? (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              marginTop: 12,
              ...boxStyle,
              borderColor: "rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ fontWeight: 900 }}>Notice</div>
            <div style={{ marginTop: 6, ...subtleText }}>{toast}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function btn(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    padding: "10px 12px",
    fontWeight: 900,
    cursor: "pointer",
    color: "inherit",
  };
}
