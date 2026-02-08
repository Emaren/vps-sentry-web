// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/PortsSection.tsx
import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import { thStyle, tdStyle, type DerivedDashboard } from "../../_lib/derive";

export default function PortsSection(props: { derived: DerivedDashboard; snapshotTs: string }) {
  const { derived: d, snapshotTs } = props;

  const rows: React.ReactNode[] = [];
  for (let i = 0; i < (d.portsPublicForAction?.length ?? 0); i++) {
    const p = d.portsPublicForAction[i] as Record<string, unknown>;
    rows.push(
      <tr key={i} style={{ borderTop: "1px solid var(--dash-soft-border, rgba(255,255,255,0.08))" }}>
        <td style={tdStyle}>{String(p.proto ?? "—")}</td>
        <td style={tdStyle}>{String(p.host ?? "—")}</td>
        <td style={tdStyle}>{String(p.port ?? "—")}</td>
        <td style={tdStyle}>{String(p.proc ?? "—")}</td>
        <td style={tdStyle}>{String(p.pid ?? "—")}</td>
      </tr>
    );
  }

  const hasAllowlistedOnly = d.publicPortsTotalCount > 0 && d.publicPortsCount === 0;

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Public Listening Ports</h2>
        <NoobTip text="Internet-exposed service ports. Unexpected ports are possible attack doors." />
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b>
      </div>

      {d.publicPortsCount === 0 ? (
        <Box>
          ✅ No unexpected public listeners detected.
          {hasAllowlistedOnly ? (
            <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
              Total public ports: <b>{d.publicPortsTotalCount}</b>
              {d.expectedPublicPorts?.length ? (
                <>
                  {" "}
                  · Allowlisted: <b>{d.expectedPublicPorts.join(", ")}</b>
                </>
              ) : null}
            </div>
          ) : null}
        </Box>
      ) : (
        <Box>
          <div style={{ marginBottom: 8 }}>
            Unexpected public ports: <b>{d.publicPortsCount}</b>
            {d.publicPortsTotalCount !== d.publicPortsCount ? (
              <> · Total public ports: {d.publicPortsTotalCount}</>
            ) : null}
          </div>
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
              <tbody>{rows}</tbody>
            </table>
          </div>
        </Box>
      )}
    </section>
  );
}
