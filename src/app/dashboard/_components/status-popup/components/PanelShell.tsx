// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/components/PanelShell.tsx
import React from "react";

export default function PanelShell(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="vps-panel-shell">
      <div className="vps-panel-head">
        <div className="vps-panel-kicker">Operator Console</div>
        <div className="vps-panel-title">{props.title}</div>
      </div>
      {props.children}
    </div>
  );
}
