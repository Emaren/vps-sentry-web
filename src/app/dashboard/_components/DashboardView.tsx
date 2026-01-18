// /var/www/vps-sentry-web/src/app/dashboard/_components/DashboardView.tsx
import React from "react";

import { fmt, safeJson, type Status } from "@/lib/status";
import Box from "../_components/Box";

import { deriveDashboard, type DerivedDashboard } from "../_lib/derive";

import {
  AlertsSection,
  BreachesSection,
  ChangesDebugSection,
  DashboardFooter,
  PortsSection,
  RemediationsSection,
  ShippingSection,
  ThreatSection,
  TopArea,
} from "./sections";

export default function DashboardView(props: {
  env: { ok: boolean; ts?: string; diff?: unknown; raw: unknown; last: Status };
  billing: any | null;
  signedInAs: string;
}) {
  const { env, billing, signedInAs } = props;
  const s = env.last;

  const d: DerivedDashboard = deriveDashboard(env);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <TopArea
        status={s}
        billing={billing}
        signedInAs={signedInAs}
        derived={d}
      />

      <AlertsSection status={s} snapshotTs={d.snapshotTs} />
      <PortsSection status={s} snapshotTs={d.snapshotTs} />
      <ThreatSection status={s} snapshotTs={d.snapshotTs} />

      <BreachesSection derived={d} snapshotTs={d.snapshotTs} />
      <ShippingSection derived={d} snapshotTs={d.snapshotTs} />
      <RemediationsSection snapshotTs={d.snapshotTs} />

      <ChangesDebugSection
        snapshotTs={d.snapshotTs}
        envOk={env.ok}
        envTs={env.ts}
        canonicalStatus={d.canonicalStatus}
        rawWarnings={d.rawWarnings}
        rawPaths={d.rawPaths}
        diff={env.diff}
        raw={env.raw}
      />

      <div style={{ marginTop: 14, opacity: 0.65, fontSize: 12 }}>
        Data source: /var/lib/vps-sentry/public/status.json
      </div>

      <DashboardFooter links={d.footerLinks} />
    </main>
  );
}
