// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/PortsSection.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import Box from "../Box";
import { thStyle, tdStyle } from "../../_lib/derive";

export default function PortsSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;

  const portRows: React.ReactNode[] = [];
  for (let i = 0; i < (s.ports_public?.length ?? 0); i++) {
    const p = s.ports_public[i];
    portRows.push(
      <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <td style={tdStyle}>{p.proto}</td>
        <td style={tdStyle}>{p.host}</td>
        <td style={tdStyle}>{p.port}</td>
        <td style={tdStyle}>{p.proc}</td>
        <td style={tdStyle}>{p.pid}</td>
      </tr>
    );
  }

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Public Listening Ports</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b>
      </div>

      {s.public_ports_count === 0 ? (
        <Box>✅ No public listeners detected.</Box>
      ) : (
        <Box>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 540 }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.8 }}>
                  <th style={thStyle}>Proto</th>
                  <th style={thStyle}>Host</th>
                  <th style={thStyle}>Port</th>
                  <th style={thStyle}>Process</th>
                  <th style={thStyle}>PID</th>
                </tr>
              </thead>
              <tbody>{portRows}</tbody>
            </table>
          </div>
        </Box>
      )}
    </section>
  );
}
