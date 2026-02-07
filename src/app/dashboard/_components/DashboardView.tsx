// /var/www/vps-sentry-web/src/app/dashboard/_components/DashboardView.tsx
import React from "react";
import Link from "next/link";
import Image from "next/image";

import type { DashboardBilling, DashboardEnv } from "../_lib/types";

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
import DashboardThemeControls from "./DashboardThemeControls";

export default function DashboardView(props: {
  env: DashboardEnv;
  billing: DashboardBilling;
  signedInAs: string;
}) {
  const { env, billing, signedInAs } = props;
  const s = env.last;

  const d: DerivedDashboard = deriveDashboard(env);

  return (
    <main id="dashboard-page" className="dashboard-shell dashboard-main" data-dashboard-theme="dark">
      <div className="app-header">
        <div className="app-header-brand">
          <Link href="/" aria-label="VPS Sentry home" className="app-header-logo-link">
            <Image
              src="/vps-sentry-logo.png"
              alt="VPS Sentry logo"
              width={52}
              height={52}
              priority
              className="app-header-logo"
            />
          </Link>
          <div className="app-header-copy">
            <h1 className="app-header-title">Dashboard</h1>
            <p className="app-header-subtitle">Live VPS snapshot and response controls</p>
            <p className="app-header-meta">Monitor actionable alerts, public port exposure, and response state.</p>
          </div>
        </div>
        <div className="app-header-actions">
          <Link href="/hosts" className="app-header-btn">
            Hosts
          </Link>
          <Link href="/billing" className="app-header-btn">
            Billing
          </Link>
          <Link href="/get-vps-sentry" className="app-header-btn">
            Install guide
          </Link>
        </div>
      </div>

      <div className="dashboard-theme-row">
        <DashboardThemeControls rootId="dashboard-page" />
      </div>

      <div style={{ marginTop: 10 }}>
        <TopArea
          status={s}
          billing={billing}
          signedInAs={signedInAs}
          derived={d}
          showTitle={false}
        />
      </div>

      <AlertsSection derived={d} snapshotTs={d.snapshotTs} />
      <PortsSection derived={d} snapshotTs={d.snapshotTs} />
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
