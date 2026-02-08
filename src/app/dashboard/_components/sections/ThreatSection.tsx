// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/ThreatSection.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import ThreatSignals from "../ThreatSignals";
import Box from "../Box";
import NoobTip from "../NoobTip";
import { deriveThreatIndicators } from "../../_lib/derive";

export default function ThreatSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;
  const indicators = deriveThreatIndicators(s);

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Threat signals (runtime)</h2>
        <NoobTip text="Runtime behavior hints like suspicious processes, outbound mining traffic, or persistence attempts." />
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · These show “not reported” until the agent emits them.
      </div>
      {indicators.length > 0 ? (
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          {indicators.map((x) => {
            const tone =
              x.severity === "critical"
                ? "var(--dash-sev-critical-text)"
                : x.severity === "warn"
                  ? "var(--dash-sev-high-text)"
                  : "var(--dash-sev-medium-text)";
            return (
              <Box key={x.id}>
                <div style={{ fontWeight: 800, color: tone }}>{x.title}</div>
                {x.detail ? (
                  <div style={{ marginTop: 8, color: "var(--dash-muted)" }}>{x.detail}</div>
                ) : null}
              </Box>
            );
          })}
        </div>
      ) : null}
      <ThreatSignals threat={s.threat} />
    </section>
  );
}
