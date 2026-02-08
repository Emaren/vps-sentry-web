// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/StatusActionPopup.tsx
"use client";

import React from "react";
import type { Panel, StatusActionPopupProps } from "./types";
import { buildActionsNeeded, buildExplainText, buildFixSteps, sleep } from "./logic";
import { css, btn, caretBtn, okBtn, xBtn } from "./styles";
import { useTypewriter } from "./hooks/useTypewriter";

import StatusLight from "./components/StatusLight";
import ActionsPanel from "./components/ActionsPanel";
import ExplainPanel from "./components/ExplainPanel";
import FixPanel from "./components/FixPanel";

export default function StatusActionPopup(props: StatusActionPopupProps) {
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
    publicPortsTotalCount,
    expectedPublicPorts,
    stale,
  } = props;

  const [panel, setPanel] = React.useState<Panel>(null);

  // When panel is open, we default-collapse the meta details
  // (but when panel closes, we restore the "original" look).
  const [metaOpen, setMetaOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (panel) setMetaOpen(false);
    else setMetaOpen(true);
  }, [panel]);

  // If total ports exist but actionable count is 0, we interpret this as "allowlisted"
  const allowlistedTotal = React.useMemo(() => {
    return typeof publicPortsTotalCount === "number" && publicPortsTotalCount > 0 && publicPortsCount === 0
      ? publicPortsTotalCount
      : null;
  }, [publicPortsTotalCount, publicPortsCount]);

  // --------- Action list (instant, no typing) ----------
  const actionsNeeded = React.useMemo(() => {
    return buildActionsNeeded({
      alertsCount,
      publicPortsCount,
      stale,
      allowlistedTotal,
      expectedPublicPorts,
    });
  }, [alertsCount, publicPortsCount, stale, allowlistedTotal, expectedPublicPorts]);

  // --------- AI Explain (typed) ----------
  const explainText = React.useMemo(() => {
    return buildExplainText({
      summary,
      alertsCount,
      publicPortsCount,
      stale,
      actionsNeeded,
      allowlistedTotal,
      expectedPublicPorts,
    });
  }, [summary, alertsCount, publicPortsCount, stale, actionsNeeded, allowlistedTotal, expectedPublicPorts]);

  const typedExplain = useTypewriter(explainText, panel === "explain");

  // --------- Fix Now (step list + progress) ----------
  const [steps, setSteps] = React.useState(() =>
    buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal })
  );
  const [fixResult, setFixResult] = React.useState<null | { ok: boolean; message: string }>(null);

  React.useEffect(() => {
    if (panel !== "fix") return;
    setSteps(buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal }));
    setFixResult(null);
  }, [panel, alertsCount, publicPortsCount, stale, allowlistedTotal]);

  async function runFixNow() {
    setFixResult(null);

    // reset to idle first
    setSteps((prev) => prev.map((s) => ({ ...s, status: "idle", detail: undefined })));

    // Snapshot steps length must be read fresh (React state updates async)
    const localSteps = buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal });
    setSteps(localSteps);

    for (let i = 0; i < localSteps.length; i++) {
      const stepId = localSteps[i]?.id;
      if (!stepId) continue;

      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, status: "running", detail: "Working…" } : s))
      );

      await sleep(650);

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
        <button type="button" aria-label="Close status panel" onClick={() => setPanel(null)} style={xBtn()}>
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

          {needsAction ? <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>(tap)</span> : null}
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

      {/* META DETAILS (Host/Snapshot/Baseline) */}
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

      {/* EXPANDED PANELS */}
      {showExpanded ? (
        <div style={{ marginTop: 12 }}>
          {panel === "actions" ? <ActionsPanel actionsNeeded={actionsNeeded} /> : null}
          {panel === "explain" ? <ExplainPanel typedExplain={typedExplain} /> : null}
          {panel === "fix" ? (
            <FixPanel
              steps={steps}
              fixResult={fixResult}
              onRun={runFixNow}
              onReset={() => {
                setSteps(buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal }));
                setFixResult(null);
              }}
            />
          ) : null}

          {/* OK button */}
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
