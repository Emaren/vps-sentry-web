import React from "react";
import PanelShell from "./PanelShell";

export default function ActionsPanel(props: { actionsNeeded: string[] }) {
  return (
    <PanelShell title="Actions needed">
      <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.92 }}>
        {props.actionsNeeded.map((a, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            {a}
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
