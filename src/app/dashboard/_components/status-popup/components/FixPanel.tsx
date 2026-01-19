import React from "react";
import PanelShell from "./PanelShell";
import type { FixResult, FixStep } from "../types";
import { btn, btnStrong, stepRow } from "../styles";
import { stepIcon } from "../logic";

export default function FixPanel(props: {
  steps: FixStep[];
  fixResult: FixResult | null;
  onRun: () => void;
  onReset: () => void;
}) {
  const { steps, fixResult, onRun, onReset } = props;

  return (
    <PanelShell title="Fix Now">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <button type="button" onClick={onRun} style={btnStrong()}>
          Run auto-fix
        </button>
        <button type="button" onClick={onReset} style={btn()}>
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
            {s.detail ? <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6 }}>{s.detail}</div> : null}
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
  );
}
