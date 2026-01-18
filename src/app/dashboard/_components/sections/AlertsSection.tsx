// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/AlertsSection.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import Box from "../Box";

export default function AlertsSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;

  const alertCards: React.ReactNode[] = [];
  for (let i = 0; i < (s.alerts?.length ?? 0); i++) {
    const a = s.alerts[i];
    alertCards.push(
      <Box key={i}>
        <div style={{ fontWeight: 700 }}>{a.title}</div>
        {a.detail ? (
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: 0.9 }}>
            {a.detail}
          </pre>
        ) : null}
      </Box>
    );
  }

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Alerts</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b>
      </div>

      {s.alerts_count === 0 ? (
        <Box>✅ No alerts.</Box>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>{alertCards}</div>
      )}
    </section>
  );
}
