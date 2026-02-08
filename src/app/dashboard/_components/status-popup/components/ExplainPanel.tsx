import React from "react";
import PanelShell from "./PanelShell";
import { typedPre } from "../styles";

export default function ExplainPanel(props: { typedExplain: string }) {
  return (
    <PanelShell title="AI Explain">
      <pre style={typedPre()}>
        {props.typedExplain}
        <span className="vps-cursor" />
      </pre>
    </PanelShell>
  );
}
