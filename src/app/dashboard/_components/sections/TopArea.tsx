// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/TopArea.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt, fmtAny } from "@/lib/status";
import type { AppRole } from "@/lib/rbac-policy";
import type { DashboardBilling, DashboardOpsSnapshot } from "../../_lib/types";

import Box from "../Box";
import StatCard from "../StatCard";
import StatusActionPopup from "../StatusActionPopup";
import NoobTip from "../NoobTip";
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

  return (
    <div className="dashboard-top-stack">
      <div className="dashboard-top-grid">
        <div>
          {showTitle ? <h1 style={{ fontSize: 28, margin: 0 }}>VPS Sentry</h1> : null}

          <Box style={{ marginTop: showTitle ? 12 : 0 }}>
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

      <div className="dashboard-noob-coach">
        Noob coach mode: red means urgent, orange means watch closely, green means healthy.
        Click any <code>?</code> badge for plain-English help.
      </div>

      <div className="dashboard-support-grid">
        {billing ? (
          <Box>
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>Account</div>
              <NoobTip text="Your plan limits and subscription status for this dashboard account." />
            </div>
            <div style={{ color: "var(--dash-muted)", marginTop: 8 }}>
              Plan: <b>{billing.plan ?? "—"}</b> · Host limit:{" "}
              <b>{billing.hostLimit ?? "—"}</b>
            </div>
            <div style={{ color: "var(--dash-muted)", marginTop: 6 }}>
              Subscription status: <b>{billing.subscriptionStatus ?? "—"}</b>
            </div>
            <div style={{ color: "var(--dash-muted)", marginTop: 6 }}>
              Current period end: <b>{fmtAny(billing.currentPeriodEnd)}</b>
            </div>
            <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
              Customer: <b>{billing.stripeCustomerId ?? "—"}</b> · Sub ID:{" "}
              <b>{billing.subscriptionId ?? "—"}</b>
            </div>
          </Box>
        ) : (
          <Box>
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>Account</div>
              <NoobTip text="Your plan limits and subscription status for this dashboard account." />
            </div>
            <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>
              — billing record not found for this user yet
            </div>
          </Box>
        )}

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>Breach Summary</div>
            <NoobTip text="Tracked security incidents with open/fixed state history." />
          </div>
          <div style={{ color: "var(--dash-muted)", marginTop: 8 }}>
            Open: <b>{breachOpen}</b> · Fixed: <b>{breachFixed}</b> · Ignored: <b>{breachIgnored}</b>
          </div>
          <div style={{ color: "var(--dash-muted)", marginTop: 6 }}>
            Total breaches tracked: <b>{breachTotal}</b>
          </div>
          <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
            {liveBreaches
              ? "Live breach ledger connected from datastore."
              : d.hasBreachSignals
              ? "Snapshot breach counts available from latest host status."
              : "No breach records have been observed yet."}
          </div>
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>Shipping / Notifications</div>
            <NoobTip text="Email/webhook delivery health for alerts and reports." />
          </div>
          <div style={{ color: "var(--dash-muted)", marginTop: 8 }}>
            Delivered 24h: <b>{shippingDelivered24h}</b> · Failed 24h: <b>{shippingFailed24h}</b>
          </div>
          <div style={{ color: "var(--dash-muted)", marginTop: 6 }}>
            Pending deliveries: <b>{shippingPending}</b>
          </div>
          <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
            Last delivered: <b>{fmt(shippingLastTs ?? undefined)}</b>
          </div>
          <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
            Last ship error: <b>{shippingLastError ?? "—"}</b>
          </div>
          <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
            {liveShipping
              ? "Live delivery health is connected from notification events."
              : d.hasShippingSignals
              ? "Snapshot shipping data available from latest host status."
              : "No shipping events captured yet."}
          </div>
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>Operator Access</div>
            <NoobTip text="Shows which advanced controls this signed-in role can use right now." />
          </div>
          <div style={{ color: "var(--dash-muted)", marginTop: 8 }}>
            Role: <b>{ops.access.role}</b>
          </div>
          <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
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
          <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
            Capability snapshot generated at <b>{fmt(ops.generatedAtIso)}</b>
          </div>
        </Box>
      </div>

      <DashboardActions userRole={userRole} />
    </div>
  );
}
