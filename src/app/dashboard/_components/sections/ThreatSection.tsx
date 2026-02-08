// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/ThreatSection.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import ThreatSignals from "../ThreatSignals";
import Box from "../Box";
import { deriveThreatIndicators } from "../../_lib/derive";

export default function ThreatSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;
  const indicators = deriveThreatIndicators(s);

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Threat signals (runtime)</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · These show “not reported” until the agent emits them.
      </div>
      {indicators.length > 0 ? (
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          {indicators.map((x) => {
            const tone =
              x.severity === "critical" ? "#ffb4b4" : x.severity === "warn" ? "#ffe4a3" : "#9fd7ff";
            return (
              <Box key={x.id}>
                <div style={{ fontWeight: 800, color: tone }}>{x.title}</div>
                {x.detail ? <div style={{ marginTop: 8, opacity: 0.9 }}>{x.detail}</div> : null}
              </Box>
            );
          })}
        </div>
      ) : null}
      <ThreatSignals threat={s.threat} />
    </section>
  );
}
