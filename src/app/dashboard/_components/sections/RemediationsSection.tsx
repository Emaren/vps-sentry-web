// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/RemediationsSection.tsx
import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";

export default function RemediationsSection(props: { snapshotTs: string }) {
  const { snapshotTs } = props;

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Remediations</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · This will show “Fix Now” actions + outcomes.
      </div>
      <Box>— remediations not reported yet (will be wired)</Box>
    </section>
  );
}
