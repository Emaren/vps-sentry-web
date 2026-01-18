// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/BreachesSection.tsx
import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import type { DerivedDashboard } from "../../_lib/derive";
import { pickString } from "../../_lib/derive";

export default function BreachesSection(props: { derived: DerivedDashboard; snapshotTs: string }) {
  const { derived: d, snapshotTs } = props;

  const breaches = d.breaches;

  const breachCards: React.ReactNode[] = [];
  if (Array.isArray(breaches)) {
    for (let i = 0; i < breaches.length; i++) {
      const b = breaches[i] ?? {};
      const title = pickString((b as any).title) ?? "Breach";
      const detail = pickString((b as any).detail) ?? null;
      const sev = pickString((b as any).severity) ?? null;
      const state = pickString((b as any).state) ?? null;
      const opened = pickString((b as any).opened_ts) ?? null;
      const fixed = pickString((b as any).fixed_ts) ?? null;

      breachCards.push(
        <Box key={i}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <div style={{ fontWeight: 800 }}>{title}</div>
            {sev ? <span style={{ opacity: 0.75, fontSize: 12 }}>{sev}</span> : null}
            {state ? <span style={{ opacity: 0.75, fontSize: 12 }}>· {state}</span> : null}
          </div>

          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 6 }}>
            Opened: <b>{fmt(opened ?? undefined)}</b> {" · "} Fixed:{" "}
            <b>{fmt(fixed ?? undefined)}</b>
          </div>

          {detail ? (
            <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: 0.9 }}>
              {detail}
            </pre>
          ) : (
            <div style={{ marginTop: 8, opacity: 0.75 }}>
              — details not reported yet (will be wired)
            </div>
          )}
        </Box>
      );
    }
  }

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Breaches</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · These show “not reported” until the agent emits them.
      </div>

      {!d.hasBreachSignals ? (
        <Box>— breaches not reported yet (will be wired)</Box>
      ) : Array.isArray(breaches) && breaches.length === 0 ? (
        <Box>✅ No breaches.</Box>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {breachCards.length ? breachCards : <Box>— breach details not reported yet</Box>}
        </div>
      )}
    </section>
  );
}
