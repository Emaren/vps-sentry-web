// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/ShippingSection.tsx
import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import type { DerivedDashboard } from "../../_lib/derive";

export default function ShippingSection(props: { derived: DerivedDashboard; snapshotTs: string }) {
  const { derived: d, snapshotTs } = props;
  const shipping = d.shipping;

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Shipping & Notifications</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · This will surface “email blocked / shipping failed” states.
      </div>

      <Box>
        <div style={{ opacity: 0.8, fontSize: 12 }}>Last ship ok</div>
        <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
          {shipping?.last_ship_ok === undefined
            ? "—"
            : shipping.last_ship_ok
              ? "true"
              : "false"}
        </div>

        <div style={{ opacity: 0.8, fontSize: 12, marginTop: 10 }}>Last ship timestamp</div>
        <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
          {fmt(shipping?.last_ship_ts)}
        </div>

        <div style={{ opacity: 0.8, fontSize: 12, marginTop: 10 }}>Last ship error</div>
        <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", opacity: 0.9 }}>
          {shipping?.last_ship_error ? shipping.last_ship_error : "—"}
        </pre>

        <div style={{ opacity: 0.65, fontSize: 12, marginTop: 10 }}>
          {d.hasShippingSignals
            ? "If outbound is blocked during containment, this will become a primary signal."
            : "— not reported yet (will be wired)."}
        </div>
      </Box>
    </section>
  );
}
