// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/ThreatSection.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import ThreatSignals from "../ThreatSignals";

export default function ThreatSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Threat signals (runtime)</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · These show “not reported” until the agent emits them.
      </div>
      <ThreatSignals threat={s.threat} />
    </section>
  );
}
