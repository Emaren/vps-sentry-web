import React from "react";
import PanelShell from "./PanelShell";

export default function ActionsPanel(props: { actionsNeeded: string[] }) {
  return (
    <PanelShell title="Actions needed">
      <ul className="vps-actions-list">
        {props.actionsNeeded.map((a, i) => (
          <li key={i} className="vps-actions-list-item">
            {a}
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}
