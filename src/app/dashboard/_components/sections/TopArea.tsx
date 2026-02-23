// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/TopArea.tsx
import React from "react";
import Link from "next/link";
import type { Status } from "@/lib/status";
import { fmt, fmtAny } from "@/lib/status";
import type { AppRole } from "@/lib/rbac-policy";
import type { DashboardBilling, DashboardOpsSnapshot } from "../../_lib/types";

import Box from "../Box";
import StatCard from "../StatCard";
import StatusActionPopup from "../StatusActionPopup";
import NoobTip from "../NoobTip";
import PanelStateBanner from "../PanelStateBanner";
import DashboardActions from "../../dashboard-actions";
import type { DerivedDashboard } from "../../_lib/derive";

export default function TopArea(props: {
  status: Status;
  billing: DashboardBilling;
  ops: DashboardOpsSnapshot;
  signedInAs: string;
  derived: DerivedDashboard;
  userRole: AppRole;
  showTitle?: boolean;
}) {
  const { status: s, billing, ops, signedInAs, derived: d, userRole, showTitle = true } = props;

  // actionable = unexpected if present, else total (fallback)
  const actionablePublicPorts = d.publicPortsCount;
  const totalPublicPorts = d.publicPortsTotalCount;
  const expectedPublicPorts = d.expectedPublicPorts ?? null;
  const liveBreaches = ops.breaches;
  const liveShipping = ops.shipping;
  const breachHealth = ops.panelHealth.breaches;
  const shippingHealth = ops.panelHealth.shipping;

  const showPortsContext =
    typeof totalPublicPorts === "number" &&
    typeof actionablePublicPorts === "number" &&
    totalPublicPorts !== actionablePublicPorts;

  const breachOpen = liveBreaches?.counts.open ?? d.breachesOpen ?? 0;
  const breachFixed = liveBreaches?.counts.fixed ?? d.breachesFixed ?? 0;
  const breachIgnored = liveBreaches?.counts.ignored ?? 0;
  const breachTotal = liveBreaches?.counts.total ?? d.breaches?.length ?? 0;

  const shippingFailed24h = liveShipping?.counts.failed24h ?? 0;
  const shippingDelivered24h =
    liveShipping ? Math.max(0, liveShipping.counts.last24h - liveShipping.counts.failed24h) : 0;
  const shippingPending = liveShipping?.counts.pending ?? 0;
  const shippingLastError = liveShipping?.lastError ?? d.shipping?.last_ship_error ?? null;
  const shippingLastTs = liveShipping?.lastDeliveredTs ?? d.shipping?.last_ship_ts ?? null;
  const queueQueuedCount = ops.queue?.counts.queued ?? ops.remediation?.counts.queued ?? 0;
  const queueDlqCount = ops.queue?.counts.dlq ?? ops.remediation?.counts.dlq ?? 0;
  const queueHasFollowUp = queueQueuedCount > 0 || queueDlqCount > 0;

  return (
    <div className="dashboard-top-stack">
      <div className="dashboard-top-grid">
        <div className="dashboard-top-primary">
          {showTitle ? <h1 style={{ fontSize: 28, margin: 0 }}>VPS Sentry</h1> : null}

          <Box className="dashboard-status-card" style={{ marginTop: showTitle ? 12 : 0 }}>
            <StatusActionPopup
              needsAction={d.needsAction}
              headline={d.headline}
              summary={d.actionSummary}
              level={d.level}
              alertsCount={d.alertsCount}
              // IMPORTANT: pass actionable ports, not raw total
              publicPortsCount={actionablePublicPorts}
              // Optional context for richer messaging inside popup
              publicPortsTotalCount={
                typeof totalPublicPorts === "number" ? totalPublicPorts : undefined
              }
              expectedPublicPorts={expectedPublicPorts}
              stale={d.stale}
              host={s.host}
              version={s.version}
              snapshotTsIso={d.snapshotTs}
              snapshotLabel={fmt(d.snapshotTs)}
              scanLabel={d.scanLabel}
              baselineLabel={fmt(s.baseline_last_accepted_ts)}
              signedInAs={signedInAs}
            />

            {/* Optional: show allowlist context when total != actionable */}
            {showPortsContext ? (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--dash-meta)" }}>
                Total public ports: <b>{totalPublicPorts}</b>{" "}
                {expectedPublicPorts && expectedPublicPorts.length ? (
                  <>
                    · Allowlisted: <b>{expectedPublicPorts.join(", ")}</b>
                  </>
                ) : null}
              </div>
            ) : null}

            {d.maintenanceActive ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--dash-warn-text, #fcd34d)" }}>
                Maintenance mode active
                {d.maintenanceUntil ? <> until <b>{fmt(d.maintenanceUntil)}</b></> : null}
                . Non-critical alerts are suppressed.
              </div>
            ) : null}

            {queueHasFollowUp ? (
              <div className="dashboard-queue-followup">
                <div className="dashboard-queue-followup-title">
                  Queue follow-up: queued <b>{queueQueuedCount}</b> · dlq <b>{queueDlqCount}</b>
                </div>
                <div className="dashboard-queue-followup-copy">
                  This is remediation pipeline debt. Host security can still be OK while queue/DLQ needs operator cleanup.
                </div>
                <div className="dashboard-queue-followup-actions">
                  <Link href="/dashboard#remediations" className="dashboard-queue-followup-link">
                    Open queue console
                  </Link>
                  <Link href="#remediations" className="dashboard-queue-followup-link">
                    Jump to remediations
                  </Link>
                </div>
              </div>
            ) : null}
          </Box>
        </div>

        <div className="dashboard-kpi-grid">
          <StatCard
            label="Alerts (Actionable)"
            value={d.alertsCount}
            hint="Issues you should act on now after filtering out known-safe noise."
          />

          {d.alertsSuppressedCount > 0 ? (
            <StatCard
              label="Alerts (Suppressed)"
              value={d.alertsSuppressedCount}
              hint="Hidden alerts due to maintenance/suppression rules to reduce false positives."
            />
          ) : null}

          {/* Label clarified: this is actionable/unexpected count */}
          <StatCard
            label="Public Ports (Unexpected)"
            value={actionablePublicPorts}
            hint="Internet-facing ports that are not on your expected allowlist."
          />

          {showPortsContext ? (
            <StatCard
              label="Public Ports (Total)"
              value={totalPublicPorts as number}
              hint="All internet-facing ports, including allowlisted ones."
            />
          ) : null}

          <StatCard
            label="SSH Failed"
            value={s.auth?.ssh_failed_password ?? 0}
            hint="Failed SSH password attempts observed in this snapshot window."
          />
          <StatCard
            label="Invalid User"
            value={s.auth?.ssh_invalid_user ?? 0}
            hint="SSH login attempts using non-existent usernames."
          />

          <Box>
            <div style={{ color: "var(--dash-meta)", fontSize: 12 }}>As-of timestamp</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
              {fmt(d.snapshotTs)}
            </div>
            <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 6 }}>
              These stats are a single snapshot from vps-sentry.
            </div>
          </Box>
        </div>
      </div>

      <div className="dashboard-support-grid">
        {billing ? (
          <SupportTile
            title="Account"
            tip="Your plan limits and subscription status for this dashboard account."
          >
            <div className="dashboard-support-metrics">
              <div className="dashboard-support-metric-pair">
                <SupportMetric label="Plan" value={billing.plan ?? "—"} />
                <SupportMetric label="Host limit" value={billing.hostLimit ?? "—"} />
              </div>
              <SupportMetric
                label="Subscription status"
                value={billing.subscriptionStatus ?? "—"}
              />
              <SupportMetric
                label="Current period end"
                value={fmtAny(billing.currentPeriodEnd)}
              />
              <div className="dashboard-support-metric-pair">
                <SupportMetric label="Customer" value={billing.stripeCustomerId ?? "—"} />
                <SupportMetric label="Sub ID" value={billing.subscriptionId ?? "—"} />
              </div>
            </div>
          </SupportTile>
        ) : (
          <SupportTile
            title="Account"
            tip="Your plan limits and subscription status for this dashboard account."
          >
            <div className="dashboard-support-empty">
              — billing record not found for this user yet
            </div>
          </SupportTile>
        )}

        <SupportTile
          title="Breach Summary"
          tip="Tracked security incidents with open/fixed state history."
        >
          <PanelStateBanner health={breachHealth} />
          {breachHealth.status === "error" ||
          breachHealth.status === "forbidden" ||
          breachHealth.status === "loading" ? null : (
            <div className="dashboard-support-metrics">
              <div className="dashboard-support-metric-trio">
                <SupportMetric label="Open" value={breachOpen} />
                <SupportMetric label="Fixed" value={breachFixed} />
                <SupportMetric label="Ignored" value={breachIgnored} />
              </div>
              <SupportMetric label="Total breaches tracked" value={breachTotal} />
              <div className="dashboard-support-note">
                {liveBreaches
                  ? "Live breach ledger connected from datastore."
                  : d.hasBreachSignals
                  ? "Snapshot breach counts available from latest host status."
                  : "No breach records have been observed yet."}
              </div>
            </div>
          )}
        </SupportTile>

        <SupportTile
          title="Shipping / Notifications"
          tip="Email/webhook delivery health for alerts and reports."
        >
          <PanelStateBanner health={shippingHealth} />
          {shippingHealth.status === "error" ||
          shippingHealth.status === "forbidden" ||
          shippingHealth.status === "loading" ? null : (
            <div className="dashboard-support-metrics">
              <div className="dashboard-support-metric-pair">
                <SupportMetric label="Delivered 24h" value={shippingDelivered24h} />
                <SupportMetric label="Failed 24h" value={shippingFailed24h} />
              </div>
              <SupportMetric label="Pending deliveries" value={shippingPending} />
              <SupportMetric
                label="Last delivered"
                value={fmt(shippingLastTs ?? undefined)}
              />
              <SupportMetric label="Last ship error" value={shippingLastError ?? "—"} />
              <div className="dashboard-support-note">
                {liveShipping
                  ? "Live delivery health is connected from notification events."
                  : d.hasShippingSignals
                  ? "Snapshot shipping data available from latest host status."
                  : "No shipping events captured yet."}
              </div>
            </div>
          )}
        </SupportTile>

        <SupportTile
          title="Operator Access"
          tip="Shows which advanced controls this signed-in role can use right now."
        >
          <div className="dashboard-support-metrics">
            <SupportMetric label="Role" value={ops.access.role} />
            <div className="dashboard-chip-row">
              <span className={ops.access.canOps ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip"}>
                ops {ops.access.canOps ? "enabled" : "locked"}
              </span>
              <span
                className={
                  ops.access.canAdmin ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip"
                }
              >
                admin {ops.access.canAdmin ? "enabled" : "locked"}
              </span>
            </div>
            <SupportMetric
              label="Capability snapshot"
              value={fmt(ops.generatedAtIso)}
            />
          </div>
        </SupportTile>
      </div>

      <DashboardActions userRole={userRole} />
    </div>
  );
}

function SupportTile(props: { title: string; tip: string; children: React.ReactNode }) {
  return (
    <Box className="dashboard-support-card">
      <div className="dashboard-card-title-row">
        <div className="dashboard-support-title">
          <NoobTip text={props.tip}>{props.title}</NoobTip>
        </div>
      </div>
      {props.children}
    </Box>
  );
}

function SupportMetric(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="dashboard-support-metric">
      <span className="dashboard-support-metric-label">{props.label}</span>
      <span className="dashboard-support-metric-value">{props.value}</span>
    </div>
  );
}
