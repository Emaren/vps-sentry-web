// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/TopArea.tsx
import React from "react";
import type { Status } from "@/lib/status";
import { fmt, fmtAny } from "@/lib/status";

import Box from "../Box";
import StatCard from "../StatCard";
import StatusActionPopup from "../StatusActionPopup";
import DashboardActions from "../../dashboard-actions";
import type { DerivedDashboard } from "../../_lib/derive";

export default function TopArea(props: {
  status: Status;
  billing: any | null;
  signedInAs: string;
  derived: DerivedDashboard;
}) {
  const { status: s, billing, signedInAs, derived: d } = props;

  // actionable = unexpected if present, else total (fallback)
  const actionablePublicPorts = d.publicPortsCount;
  const totalPublicPorts = d.publicPortsTotalCount;
  const expectedPublicPorts = d.expectedPublicPorts ?? null;

  const showPortsContext =
    typeof totalPublicPorts === "number" &&
    typeof actionablePublicPorts === "number" &&
    totalPublicPorts !== actionablePublicPorts;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
        alignItems: "start",
      }}
    >
      <div>
        <h1 style={{ fontSize: 28, margin: 0 }}>VPS Sentry</h1>

        <Box style={{ marginTop: 12 }}>
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
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Total public ports: <b>{totalPublicPorts}</b>{" "}
              {expectedPublicPorts && expectedPublicPorts.length ? (
                <>
                  · Allowlisted: <b>{expectedPublicPorts.join(", ")}</b>
                </>
              ) : null}
            </div>
          ) : null}

          {d.maintenanceActive ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#fcd34d" }}>
              Maintenance mode active
              {d.maintenanceUntil ? <> until <b>{fmt(d.maintenanceUntil)}</b></> : null}
              . Non-critical alerts are suppressed.
            </div>
          ) : null}
        </Box>

        {billing ? (
          <Box style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800 }}>Account</div>
            <div style={{ opacity: 0.85, marginTop: 8 }}>
              Plan: <b>{billing.plan ?? "—"}</b> · Host limit:{" "}
              <b>{billing.hostLimit ?? "—"}</b>
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Subscription status: <b>{billing.subscriptionStatus ?? "—"}</b>
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Current period end: <b>{fmtAny(billing.currentPeriodEnd)}</b>
            </div>
            <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
              Customer: <b>{billing.stripeCustomerId ?? "—"}</b> · Sub ID:{" "}
              <b>{billing.subscriptionId ?? "—"}</b>
            </div>
          </Box>
        ) : (
          <Box style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 800 }}>Account</div>
            <div style={{ marginTop: 8, opacity: 0.75 }}>
              — billing record not found for this user yet
            </div>
          </Box>
        )}

        {/* NEW (additive): Breach Summary placeholder */}
        <Box style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>Breach Summary</div>
          <div style={{ opacity: 0.75, marginTop: 8 }}>
            Open: <b>{d.breachesOpen !== null ? d.breachesOpen : "—"}</b> · Fixed:{" "}
            <b>{d.breachesFixed !== null ? d.breachesFixed : "—"}</b>
          </div>
          <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
            {d.hasBreachSignals
              ? "Breaches are now surfaced when the agent emits them (wiring next)."
              : "— not reported yet (will be wired)."}
          </div>
        </Box>

        {/* NEW (additive): Shipping / Notifications placeholder */}
        <Box style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>Shipping / Notifications</div>
          <div style={{ opacity: 0.85, marginTop: 8 }}>
            Last ship ok:{" "}
            <b>
              {d.shipping?.last_ship_ok === undefined
                ? "—"
                : d.shipping.last_ship_ok
                  ? "true"
                  : "false"}
            </b>
          </div>
          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Last ship ts: <b>{fmt(d.shipping?.last_ship_ts)}</b>
          </div>
          <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
            Last ship error:{" "}
            <b>{d.shipping?.last_ship_error ? d.shipping.last_ship_error : "—"}</b>
          </div>
          <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
            {d.hasShippingSignals
              ? "This panel will be wired to alert if outbound blocks email shipping."
              : "— not reported yet (will be wired)."}
          </div>
        </Box>

        <DashboardActions />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <StatCard label="Alerts (Actionable)" value={d.alertsCount} />

        {d.alertsSuppressedCount > 0 ? (
          <StatCard label="Alerts (Suppressed)" value={d.alertsSuppressedCount} />
        ) : null}

        {/* Label clarified: this is actionable/unexpected count */}
        <StatCard label="Public Ports (Unexpected)" value={actionablePublicPorts} />

        {showPortsContext ? (
          <StatCard label="Public Ports (Total)" value={totalPublicPorts as number} />
        ) : null}

        <StatCard label="SSH Failed" value={s.auth?.ssh_failed_password ?? 0} />
        <StatCard label="Invalid User" value={s.auth?.ssh_invalid_user ?? 0} />

        <Box>
          <div style={{ opacity: 0.8, fontSize: 12 }}>As-of timestamp</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
            {fmt(d.snapshotTs)}
          </div>
          <div style={{ opacity: 0.65, fontSize: 12, marginTop: 6 }}>
            These stats are a single snapshot from vps-sentry.
          </div>
        </Box>
      </div>
    </div>
  );
}
