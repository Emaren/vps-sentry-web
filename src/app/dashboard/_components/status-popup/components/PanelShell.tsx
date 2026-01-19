// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/components/PanelShell.tsx
import React from "react";

export default function PanelShell(props: { title: string; children: React.ReactNode }) {
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
