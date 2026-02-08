import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import type { DerivedDashboard } from "../../_lib/derive";
import type { DashboardOpsSnapshot } from "../../_lib/types";

function severityTone(severity: "info" | "warn" | "critical"): {
  bg: string;
  border: string;
  color: string;
} {
  if (severity === "critical") {
    return {
      bg: "var(--dash-sev-critical-bg, rgba(239,68,68,0.14))",
      border: "var(--dash-sev-critical-border, rgba(239,68,68,0.35))",
      color: "var(--dash-sev-critical-text, #fecaca)",
    };
  }
  if (severity === "warn") {
    return {
      bg: "var(--dash-sev-high-bg, rgba(245,158,11,0.14))",
      border: "var(--dash-sev-high-border, rgba(245,158,11,0.35))",
      color: "var(--dash-sev-high-text, #fcd34d)",
    };
  }
  return {
    bg: "var(--dash-sev-medium-bg, rgba(59,130,246,0.14))",
    border: "var(--dash-sev-medium-border, rgba(59,130,246,0.35))",
    color: "var(--dash-sev-medium-text, #bfdbfe)",
  };
}

function stateTone(state: "open" | "fixed" | "ignored"): string {
  if (state === "open") return "dashboard-chip dashboard-chip-bad";
  if (state === "fixed") return "dashboard-chip dashboard-chip-ok";
  return "dashboard-chip dashboard-chip-warn";
}

export default function BreachesSection(props: {
  derived: DerivedDashboard;
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { derived: d, ops, snapshotTs } = props;
  const live = ops.breaches;
  const rows = live?.recent ?? [];

  const openCount = live?.counts.open ?? d.breachesOpen ?? 0;
  const fixedCount = live?.counts.fixed ?? d.breachesFixed ?? 0;
  const ignoredCount = live?.counts.ignored ?? 0;
  const totalCount = live?.counts.total ?? rows.length;

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <NoobTip text="Live breach ledger from DB: open/fixed/ignored states with host and timing context.">
            Breaches
          </NoobTip>
        </h2>
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Live source: breach records in datastore.
      </div>

      <div className="dashboard-chip-row" style={{ marginBottom: 10 }}>
        <span className={openCount > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
          open {openCount}
        </span>
        <span className={fixedCount > 0 ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip"}>
          fixed {fixedCount}
        </span>
        <span className={ignoredCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip"}>
          ignored {ignoredCount}
        </span>
        <span className="dashboard-chip">total {totalCount}</span>
      </div>

      {rows.length === 0 ? (
        <Box>
          {openCount > 0
            ? "Open breach count exists but no detailed records were returned in this window."
            : "No breach records yet for this account."}
        </Box>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row) => {
            const tone = severityTone(row.severity);
            return (
              <Box key={row.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>
                    {row.title}
                    <span style={{ marginLeft: 8, color: "var(--dash-meta)", fontWeight: 600 }}>
                      {row.hostName}
                      {row.hostSlug ? ` · /${row.hostSlug}` : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        border: `1px solid ${tone.border}`,
                        background: tone.bg,
                        color: tone.color,
                        borderRadius: 999,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                        textTransform: "uppercase",
                      }}
                    >
                      {row.severity}
                    </span>
                    <span className={stateTone(row.state)}>{row.state}</span>
                  </div>
                </div>

                <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 6 }}>
                  Opened: <b>{fmt(row.openedTs)}</b> · Fixed: <b>{fmt(row.fixedTs ?? undefined)}</b> · Updated:{" "}
                  <b>{fmt(row.updatedAt)}</b>
                  {row.code ? <> · Code: <b>{row.code}</b></> : null}
                </div>

                {row.detail ? (
                  <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "var(--dash-muted)" }}>
                    {row.detail}
                  </pre>
                ) : (
                  <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>No additional breach detail captured.</div>
                )}
              </Box>
            );
          })}
        </div>
      )}
    </section>
  );
}
