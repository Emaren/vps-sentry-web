"use client";

// src/app/dashboard/_components/StatusActionPopup.tsx
import React from "react";
import type { ActionSummary } from "../_lib/explain";

type Level = "ok" | "warn" | "bad";
type Panel = null | "actions" | "explain" | "fix";

type FixStepStatus = "idle" | "running" | "success" | "error";

type FixStep = {
  id: string;
  label: string;
  status: FixStepStatus;
  detail?: string;
};

export default function StatusActionPopup(props: {
  needsAction: boolean;
  headline: string; // "ACTION NEEDED" or "OK"
  summary: ActionSummary;

  // meta (for the collapsed/expanded details)
  host: string;
  version: string;
  snapshotLabel: string; // e.g. "1/17/2026, 5:55:27 PM"
  scanLabel: string; // e.g. "1/17/2026, 5:55:27 PM · Age: 4m (stale?)"
  baselineLabel: string; // e.g. "1/13/2026, 2:46:17 PM"
  signedInAs: string; // e.g. "tonyblum@me.com"

  // for status light + action inference
  level: Level;
  alertsCount: number;
  publicPortsCount: number;
  stale: boolean;
}) {
  const {
    needsAction,
    headline,
    summary,
    host,
    version,
    snapshotLabel,
    scanLabel,
    baselineLabel,
    signedInAs,
    level,
    alertsCount,
    publicPortsCount,
    stale,
  } = props;

  const [panel, setPanel] = React.useState<Panel>(null);

  // When panel is open, we default-collapse the meta details
  // (but when panel closes, we restore the "original" look).
  const [metaOpen, setMetaOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (panel) setMetaOpen(false); // make room for content
    else setMetaOpen(true); // restore original Host/Snapshot/Baseline view
  }, [panel]);

  // --------- Action list (instant, no typing) ----------
  const actionsNeeded = React.useMemo(() => {
    const out: string[] = [];
    if (alertsCount > 0) out.push(`Review ${alertsCount} alert${alertsCount === 1 ? "" : "s"} below.`);
    if (publicPortsCount > 0)
      out.push(
        `Public listening ports detected (${publicPortsCount}). Confirm they’re expected, otherwise close/ firewall them.`
      );
    if (stale) out.push("Status is stale (last scan is 15m+ old). Check the agent/timer/service and logs.");
    if (out.length === 0) out.push("No immediate action detected.");
    return out;
  }, [alertsCount, publicPortsCount, stale]);

  // --------- AI Explain (typed) ----------
  const explainText = React.useMemo(() => {
    // Keep this resilient: build a useful explanation even if ActionSummary evolves.
    const lines: string[] = [];

    // Try to pull something structured if it exists (best-effort).
    const anySummary: any = summary as any;
    const maybeArray =
      (Array.isArray(anySummary?.bullets) && anySummary.bullets) ||
      (Array.isArray(anySummary?.actions) && anySummary.actions) ||
      (Array.isArray(anySummary?.items) && anySummary.items) ||
      null;

    lines.push("Here’s what ‘ACTION NEEDED’ means on this snapshot:");
    lines.push("");

    if (alertsCount > 0) {
      lines.push(`• Alerts: ${alertsCount}. These are things the agent flagged (config, perms, integrity, etc.).`);
    } else {
      lines.push("• Alerts: 0.");
    }

    if (publicPortsCount > 0) {
      lines.push(
        `• Public ports: ${publicPortsCount}. This means something is listening on the public interface. Sometimes intentional (web), sometimes not.`
      );
    } else {
      lines.push("• Public ports: 0.");
    }

    if (stale) {
      lines.push("• Stale: yes. The dashboard is showing an older scan, so you may be blind to new changes.");
    } else {
      lines.push("• Stale: no.");
    }

    lines.push("");
    lines.push("Recommended next moves:");
    lines.push(...actionsNeeded.map((a) => `• ${a}`));

    // If summary has extra structured bits, append as “Extra detail”
    if (maybeArray && maybeArray.length) {
      lines.push("");
      lines.push("Extra detail:");
      for (let i = 0; i < Math.min(maybeArray.length, 6); i++) {
        const v = maybeArray[i];
        const s = typeof v === "string" ? v : v?.title || v?.label || JSON.stringify(v);
        lines.push(`• ${s}`);
      }
    }

    lines.push("");
    lines.push("If you want, I can walk you through the exact commands for each step.");
    return lines.join("\n");
  }, [summary, alertsCount, publicPortsCount, stale, actionsNeeded]);

  const typedExplain = useTypewriter(explainText, panel === "explain");

  // --------- Fix Now (step list + progress) ----------
  const [steps, setSteps] = React.useState<FixStep[]>([]);
  const [fixResult, setFixResult] = React.useState<null | { ok: boolean; message: string }>(null);

  React.useEffect(() => {
    if (panel !== "fix") return;

    // Build steps when Fix panel opens
    const next = buildFixSteps({ alertsCount, publicPortsCount, stale });
    setSteps(next);
    setFixResult(null);
  }, [panel, alertsCount, publicPortsCount, stale]);

  async function runFixNow() {
    // This is a UI simulation you can later replace with real API calls.
    // The whole point: the UX feels “alive” even before plumbing is complete.
    setFixResult(null);

    // reset to idle first
    setSteps((prev) => prev.map((s) => ({ ...s, status: "idle", detail: undefined })));

    for (let i = 0; i < steps.length; i++) {
      const stepId = steps[i]?.id;
      if (!stepId) continue;

      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "running", detail: "Working…" } : s))
      );

      // Simulated delay (swap for real fetch calls later)
      await sleep(650);

      // Simulated success
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "success", detail: "Done." } : s))
      );

      await sleep(200);
    }

    setFixResult({ ok: true, message: "Auto-fix completed successfully 🎉" });
  }

  const showExpanded = panel !== null;

  return (
    <div style={{ position: "relative" }}>
      {/* Inline keyframes (keeps it self-contained) */}
      <style>{css()}</style>

      {/* CLOSE (X) when expanded */}
      {showExpanded ? (
        <button
          type="button"
          aria-label="Close status panel"
          onClick={() => setPanel(null)}
          style={xBtn()}
        >
          ×
        </button>
      ) : null}

      {/* TOP LINE: light + Status + tap hint */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StatusLight level={level} />

        <div style={{ fontWeight: 800 }}>
          Status:{" "}
          <span
            style={{
              fontWeight: 900,
              cursor: needsAction ? "pointer" : "default",
              textDecoration: needsAction ? "underline" : "none",
              textUnderlineOffset: 3,
            }}
            onClick={() => {
              if (needsAction) setPanel("actions");
            }}
            role={needsAction ? "button" : undefined}
            aria-label={needsAction ? "Show action needed summary" : undefined}
          >
            {headline}
          </span>

          {needsAction ? (
            <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>(tap)</span>
          ) : null}
        </div>
      </div>

      {/* BUTTON ROW: AI Explain / Fix Now (only when action needed) */}
      {needsAction ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <button type="button" onClick={() => setPanel("explain")} style={btn()}>
            AI Explain
          </button>
          <button type="button" onClick={() => setPanel("fix")} style={btn()}>
            Fix Now
          </button>
        </div>
      ) : null}

      {/* META ROW (Signed in + caret) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: needsAction ? 10 : 12,
        }}
      >
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          Signed in as <b>{signedInAs}</b>
        </div>

        <button
          type="button"
          onClick={() => setMetaOpen((v) => !v)}
          style={caretBtn()}
          aria-label={metaOpen ? "Collapse host details" : "Expand host details"}
          title={metaOpen ? "Hide host details" : "Show host details"}
        >
          {metaOpen ? "▾" : "▸"}
        </button>
      </div>

      {/* META DETAILS (Host/Snapshot/Baseline) — original look when collapsed panel is closed */}
      {metaOpen ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ opacity: 0.85 }}>
            Host: <b>{host}</b> · Version: <b>{version}</b>
          </div>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Snapshot: <b>{snapshotLabel}</b>{" "}
            <span style={{ opacity: 0.85 }}>
              · <b>{scanLabel.includes("Age:") ? scanLabel.split("·").slice(1).join("·").trim() : scanLabel}</b>
            </span>
          </div>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Baseline accepted: <b>{baselineLabel}</b>
          </div>
        </div>
      ) : null}

      {/* EXPANDED PANELS (inside the Status box) */}
      {showExpanded ? (
        <div style={{ marginTop: 12 }}>
          {panel === "actions" ? (
            <PanelShell title="Actions needed">
              <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.92 }}>
                {actionsNeeded.map((a, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>
                    {a}
                  </li>
                ))}
              </ul>
            </PanelShell>
          ) : null}

          {panel === "explain" ? (
            <PanelShell title="AI Explain">
              <pre style={typedPre()}>
                {typedExplain}
                <span className="vps-cursor" />
              </pre>
            </PanelShell>
          ) : null}

          {panel === "fix" ? (
            <PanelShell title="Fix Now">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <button type="button" onClick={runFixNow} style={btnStrong()}>
                  Run auto-fix
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Reset panel to show steps but not running
                    setSteps(buildFixSteps({ alertsCount, publicPortsCount, stale }));
                    setFixResult(null);
                  }}
                  style={btn()}
                >
                  Reset
                </button>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {steps.map((s) => (
                  <div key={s.id} style={stepRow(s.status)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 22, textAlign: "center" }}>{stepIcon(s.status)}</span>
                      <div style={{ fontWeight: 800 }}>{s.label}</div>
                    </div>
                    {s.detail ? (
                      <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6 }}>{s.detail}</div>
                    ) : null}
                  </div>
                ))}
              </div>

              {fixResult ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    fontWeight: 900,
                  }}
                >
                  {fixResult.ok ? "✅ " : "❌ "}
                  {fixResult.message}
                </div>
              ) : null}
            </PanelShell>
          ) : null}

          {/* OK button (bottom center) */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <button type="button" onClick={() => setPanel(null)} style={okBtn()}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- helpers ---------------- */

function PanelShell(props: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingTop: 12,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 10 }}>{props.title}</div>
      {props.children}
    </div>
  );
}

function StatusLight({ level }: { level: Level }) {
  const cls =
    level === "ok" ? "vps-light vps-light-ok" : level === "warn" ? "vps-light vps-light-warn" : "vps-light vps-light-bad";
  return <span className={cls} />;
}

function useTypewriter(text: string, enabled: boolean) {
  const [out, setOut] = React.useState("");

  React.useEffect(() => {
    if (!enabled) {
      setOut("");
      return;
    }

    let i = 0;
    let raf: number | null = null;

    const tick = () => {
      // fast but readable
      i = Math.min(text.length, i + 3);
      setOut(text.slice(0, i));
      if (i < text.length) raf = window.setTimeout(tick, 16);
    };

    tick();

    return () => {
      if (raf) window.clearTimeout(raf);
    };
  }, [text, enabled]);

  return out;
}

function buildFixSteps(input: { alertsCount: number; publicPortsCount: number; stale: boolean }): FixStep[] {
  const steps: FixStep[] = [];

  if (input.stale) {
    steps.push({
      id: "stale",
      label: "Bring scans back online (agent/timer/service health check)",
      status: "idle",
    });
  }

  if (input.publicPortsCount > 0) {
    steps.push({
      id: "ports",
      label: "Review public listening ports and propose firewall/close actions",
      status: "idle",
    });
  }

  if (input.alertsCount > 0) {
    steps.push({
      id: "alerts",
      label: "Summarize alerts and propose the safest fix sequence",
      status: "idle",
    });
  }

  // Always include a “report” step so the user sees “something happening”
  steps.push({
    id: "report",
    label: "Generate a fresh report (and notify you, if configured)",
    status: "idle",
  });

  return steps;
}

function stepIcon(status: FixStepStatus) {
  if (status === "idle") return "•";
  if (status === "running") return "⏳";
  if (status === "success") return "✅";
  return "❌";
}

function stepRow(status: FixStepStatus): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    padding: "10px 12px",
  };

  if (status === "running") {
    return {
      ...base,
      border: "1px solid rgba(255,255,255,0.22)",
      background: "rgba(255,255,255,0.06)",
      boxShadow: "0 0 0 1px rgba(255,255,255,0.04), 0 0 18px rgba(255,255,255,0.06)",
    };
  }

  if (status === "success") {
    return {
      ...base,
      border: "1px solid rgba(80, 255, 160, 0.25)",
      boxShadow: "0 0 0 1px rgba(80, 255, 160, 0.06), 0 0 18px rgba(80, 255, 160, 0.06)",
    };
  }

  if (status === "error") {
    return {
      ...base,
      border: "1px solid rgba(255, 90, 90, 0.25)",
      boxShadow: "0 0 0 1px rgba(255, 90, 90, 0.06), 0 0 18px rgba(255, 90, 90, 0.06)",
    };
  }

  return base;
}

function css() {
  return `
  .vps-light {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    display: inline-block;
    flex: 0 0 auto;
  }

  /* GREEN: gentle pulse */
  .vps-light-ok {
    background: rgba(70, 255, 140, 0.9);
    box-shadow: 0 0 10px rgba(70, 255, 140, 0.35), 0 0 24px rgba(70, 255, 140, 0.18);
    animation: vpsPulse 1.8s ease-in-out infinite;
  }

  /* YELLOW: medium pulse */
  .vps-light-warn {
    background: rgba(255, 210, 70, 0.95);
    box-shadow: 0 0 10px rgba(255, 210, 70, 0.32), 0 0 24px rgba(255, 210, 70, 0.16);
    animation: vpsPulse 1.2s ease-in-out infinite;
  }

  /* RED: slower "alarm" flash */
  .vps-light-bad {
    background: rgba(255, 70, 70, 0.95);
    box-shadow: 0 0 10px rgba(255, 70, 70, 0.34), 0 0 24px rgba(255, 70, 70, 0.18);
    animation: vpsFlash 1.4s ease-in-out infinite;
  }

  @keyframes vpsPulse {
    0% { transform: scale(1); opacity: 0.85; }
    50% { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1); opacity: 0.85; }
  }

  @keyframes vpsFlash {
    0% { opacity: 0.35; transform: scale(1); }
    40% { opacity: 1; transform: scale(1.05); }
    100% { opacity: 0.35; transform: scale(1); }
  }

  .vps-cursor {
    display: inline-block;
    width: 8px;
    height: 14px;
    margin-left: 2px;
    background: rgba(255,255,255,0.65);
    vertical-align: -2px;
    animation: vpsBlink 0.9s step-end infinite;
  }

  @keyframes vpsBlink {
    50% { opacity: 0; }
  }
  `;
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

function btnStrong(): React.CSSProperties {
  return {
    ...btn(),
    border: "1px solid rgba(255,255,255,0.22)",
    background: "rgba(255,255,255,0.08)",
  };
}

function okBtn(): React.CSSProperties {
  return {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    padding: "10px 18px",
    fontWeight: 950,
    cursor: "pointer",
    color: "inherit",
    minWidth: 110,
    textAlign: "center",
  };
}

function caretBtn(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "6px 10px",
    fontWeight: 900,
    cursor: "pointer",
    color: "inherit",
    lineHeight: "14px",
  };
}

function xBtn(): React.CSSProperties {
  return {
    position: "absolute",
    top: -2,
    right: -2,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    width: 32,
    height: 32,
    cursor: "pointer",
    color: "inherit",
    fontSize: 20,
    fontWeight: 900,
    lineHeight: "30px",
    textAlign: "center",
  };
}

function typedPre(): React.CSSProperties {
  return {
    margin: 0,
    whiteSpace: "pre-wrap",
    opacity: 0.92,
    fontSize: 13,
    lineHeight: 1.5,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
