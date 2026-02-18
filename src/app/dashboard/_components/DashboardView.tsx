// /var/www/vps-sentry-web/src/app/dashboard/_components/DashboardView.tsx
import React from "react";
import Link from "next/link";
import Image from "next/image";
import SiteThemeControls from "@/app/_components/SiteThemeControls";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";

import type { DashboardBilling, DashboardEnv, DashboardOpsSnapshot } from "../_lib/types";

import { deriveDashboard, type DerivedDashboard } from "../_lib/derive";

import {
  AdaptiveSection,
  AlertsSection,
  BreachesSection,
  CommandCenterSection,
  ChangesDebugSection,
  DashboardFooter,
  MissionControlSection,
  PortsSection,
  RemediationsSection,
  ShippingSection,
  ThreatSection,
  TopArea,
} from "./sections";
import DashboardLogoutButton from "./DashboardLogoutButton";
import LivePulseStrip from "./LivePulseStrip";
import PowerMemoryTile from "./PowerMemoryTile";
import ViewScreen from "./ViewScreen";

export default function DashboardView(props: {
  env: DashboardEnv;
  billing: DashboardBilling;
  ops: DashboardOpsSnapshot;
  signedInAs: string;
  userRole: AppRole;
}) {
  const { env, billing, ops, signedInAs, userRole } = props;
  const s = env.last;

  const d: DerivedDashboard = deriveDashboard(env);
  const canOpenAdmin = hasRequiredRole(userRole, "admin");
  const livePulse = {
    ts: new Date().toISOString(),
    snapshotTs: d.snapshotTs,
    alertsCount: d.alertsCount,
    unexpectedPorts: d.publicPortsCount,
    openBreaches: ops.breaches?.counts.open ?? d.breachesOpen ?? 0,
    incidentsOpen: ops.incidents?.counts.open ?? 0,
    queueQueued: ops.queue?.counts.queued ?? ops.remediation?.counts.queued ?? 0,
    queueDlq: ops.queue?.counts.dlq ?? ops.remediation?.counts.dlq ?? 0,
    shippingFailed24h: ops.shipping?.counts.failed24h ?? 0,
  };

  return (
    <main className="dashboard-shell dashboard-main">
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
        <div className="app-header-actions app-header-actions-with-theme">
          <div className="app-header-actions-row">
            <Link href="/hosts" className="app-header-btn">
              Hosts
            </Link>
            <Link href="/billing" className="app-header-btn">
              Billing
            </Link>
            <Link href="/actions" className="app-header-btn">
              Actions
            </Link>
            <Link href="/get-vps-sentry" className="app-header-btn">
              Install guide
            </Link>
            {canOpenAdmin ? (
              <Link href="/admin" className="app-header-btn">
                Admin
              </Link>
            ) : null}
            <DashboardLogoutButton />
          </div>
          <div className="app-header-actions-theme-row">
            <SiteThemeControls variant="inline" />
          </div>
        </div>
      </div>

      <PowerMemoryTile derived={d} />
      <ViewScreen status={s} derived={d} initialPulse={livePulse} />

      <div style={{ marginTop: 10 }}>
        <TopArea
          status={s}
          billing={billing}
          ops={ops}
          signedInAs={signedInAs}
          derived={d}
          userRole={userRole}
          showTitle={false}
        />
      </div>

      <MissionControlSection ops={ops} snapshotTs={d.snapshotTs} />
      <LivePulseStrip initial={livePulse} />
      <CommandCenterSection ops={ops} snapshotTs={d.snapshotTs} />
      <AdaptiveSection ops={ops} snapshotTs={d.snapshotTs} />

      <AlertsSection derived={d} snapshotTs={d.snapshotTs} />
      <PortsSection derived={d} snapshotTs={d.snapshotTs} />
      <ThreatSection status={s} snapshotTs={d.snapshotTs} />

      <BreachesSection derived={d} ops={ops} snapshotTs={d.snapshotTs} />
      <ShippingSection derived={d} ops={ops} snapshotTs={d.snapshotTs} />
      <RemediationsSection ops={ops} snapshotTs={d.snapshotTs} />

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
