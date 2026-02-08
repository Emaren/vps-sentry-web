import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import type { DerivedDashboard } from "../../_lib/derive";
import type { DashboardOpsSnapshot } from "../../_lib/types";

export default function ShippingSection(props: {
  derived: DerivedDashboard;
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { derived: d, ops, snapshotTs } = props;
  const live = ops.shipping;
  const recent = live?.recent ?? [];

  const failed24h = live?.counts.failed24h ?? 0;
  const delivered24h = (live?.counts.last24h ?? 0) - failed24h;
  const pendingCount = live?.counts.pending ?? 0;

  const lastShipOk =
    live?.lastDeliveredTs != null
      ? true
      : d.shipping?.last_ship_ok === undefined
      ? null
      : d.shipping.last_ship_ok;
  const lastShipTs = live?.lastDeliveredTs ?? d.shipping?.last_ship_ts ?? null;
  const lastShipError = live?.lastError ?? d.shipping?.last_ship_error ?? null;

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Shipping & Notifications</h2>
        <NoobTip text="Live delivery event stream for email/webhook alerts, with error visibility and recent transport health." />
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Live source: notification event ledger.
      </div>

      <div className="dashboard-chip-row" style={{ marginBottom: 10 }}>
        <span className={failed24h > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
          failed 24h {failed24h}
        </span>
        <span className={delivered24h > 0 ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip"}>
          delivered 24h {delivered24h}
        </span>
        <span className={pendingCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
          pending {pendingCount}
        </span>
        <span className="dashboard-chip">events {live?.counts.total ?? 0}</span>
      </div>

      <Box>
        <div style={{ color: "var(--dash-meta)", fontSize: 12 }}>Last ship ok</div>
        <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
          {lastShipOk === null ? "—" : lastShipOk ? "true" : "false"}
        </div>

        <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 10 }}>Last successful ship</div>
        <div style={{ fontSize: 14, fontWeight: 800, marginTop: 6 }}>
          {fmt(lastShipTs ?? undefined)}
        </div>

        <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 10 }}>Last ship error</div>
        <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", color: "var(--dash-muted)" }}>
          {lastShipError ? lastShipError : "—"}
        </pre>
      </Box>

      <div style={{ marginTop: 10 }}>
        {recent.length === 0 ? (
          <Box>No shipping events recorded yet for this account.</Box>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {recent.slice(0, 10).map((row) => (
              <Box key={row.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>
                    {row.title}
                    <span style={{ marginLeft: 8, color: "var(--dash-meta)", fontWeight: 500 }}>
                      {row.hostName ?? "account-level"} · {row.eventType}
                    </span>
                  </div>
                  <span
                    className={
                      row.deliveredOk === true
                        ? "dashboard-chip dashboard-chip-ok"
                        : row.deliveredOk === false
                        ? "dashboard-chip dashboard-chip-bad"
                        : "dashboard-chip dashboard-chip-warn"
                    }
                  >
                    {row.deliveredOk === true
                      ? "delivered"
                      : row.deliveredOk === false
                      ? "failed"
                      : "pending"}
                  </span>
                </div>

                <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                  Created: <b>{fmt(row.createdAt)}</b> · Delivered: <b>{fmt(row.deliveredTs ?? undefined)}</b>
                  {row.endpointKind ? <> · Endpoint: <b>{row.endpointKind.toLowerCase()}</b></> : null}
                </div>

                {row.detail ? (
                  <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--dash-muted)" }}>
                    {row.detail}
                  </pre>
                ) : null}

                {row.error ? (
                  <pre
                    style={{
                      marginTop: 8,
                      whiteSpace: "pre-wrap",
                      color: "var(--dash-sev-critical-text, #fecaca)",
                    }}
                  >
                    {row.error}
                  </pre>
                ) : null}
              </Box>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
