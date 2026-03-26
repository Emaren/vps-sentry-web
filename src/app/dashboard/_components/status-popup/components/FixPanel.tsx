import React from "react";
import PanelShell from "./PanelShell";
import type { FixResult, FixStep } from "../types";
import { btn, btnStrong, stepRow } from "../styles";
import { stepIcon } from "../logic";

export default function FixPanel(props: {
  steps: FixStep[];
  fixResult: FixResult | null;
  running: boolean;
  onRun: () => void;
  onReset: () => void;
}) {
  const { steps, fixResult, running, onRun, onReset } = props;

  return (
    <PanelShell title="Fix Now">
      <div className="vps-fix-intro">
        Safe playbooks run first. Anything destructive or system-path sensitive stays manual on purpose.
      </div>

      <div className="vps-fix-toolbar">
        <button
          type="button"
          onClick={onRun}
          style={{ ...btnStrong(), cursor: running ? "not-allowed" : "pointer" }}
          disabled={running}
        >
          {running ? "Running..." : "Run auto-fix"}
        </button>
        <button
          type="button"
          onClick={onReset}
          style={{ ...btn(), cursor: running ? "not-allowed" : "pointer" }}
          disabled={running}
        >
          Reset
        </button>
      </div>

      <div className="vps-fix-grid">
        {steps.map((s) => (
          <div key={s.id} className="vps-step-row" data-status={s.status} style={stepRow(s.status)}>
            <div className="vps-step-head">
              <span className="vps-step-icon">{stepIcon(s.status)}</span>
              <div className="vps-step-label">{s.label}</div>
              <span className="vps-step-state">
                {s.status === "idle" ? "queued" : s.status === "running" ? "working" : s.status}
              </span>
            </div>
            {s.detail ? <div className="vps-step-detail">{s.detail}</div> : null}
          </div>
        ))}
      </div>

      {fixResult ? (
        <div className="vps-result-card" data-ok={fixResult.ok ? "true" : "false"}>
          <div className="vps-result-title">
            {fixResult.ok ? "Stabilization update" : "Manual follow-up still required"}
          </div>
          <div className="vps-result-message">{fixResult.message}</div>
          {fixResult.details?.length ? (
            <div className="vps-result-details">
              {fixResult.details.map((detail, index) => (
                <div key={`${detail}-${index}`} className="vps-result-detail">
                  {detail}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </PanelShell>
  );
}
