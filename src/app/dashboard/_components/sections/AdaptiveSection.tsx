import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import PanelStateBanner from "../PanelStateBanner";
import type { DashboardOpsSnapshot } from "../../_lib/types";

function priorityTone(priority: "high" | "medium" | "low"): string {
  if (priority === "high") return "dashboard-chip dashboard-chip-bad";
  if (priority === "medium") return "dashboard-chip dashboard-chip-warn";
  return "dashboard-chip dashboard-chip-ok";
}

export default function AdaptiveSection(props: {
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { ops, snapshotTs } = props;
  const adaptive = ops.adaptive;
  const health = ops.panelHealth.adaptive;
  const correlations = adaptive?.correlations ?? [];
  const recommendations = adaptive?.recommendations ?? [];

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <NoobTip text="Cross-host signal correlation and explainable policy-tuning recommendations generated from recent telemetry.">
            Adaptive Guard (Learning)
          </NoobTip>
        </h2>
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Adaptive snapshot: <b>{fmt(adaptive?.generatedAtIso)}</b>
      </div>
      <PanelStateBanner health={health} />

      {health.status === "error" || health.status === "forbidden" || health.status === "loading" ? null : (
        <>
          {correlations.length === 0 ? (
            <Box>No cross-host correlation pattern detected yet.</Box>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {correlations.map((corr) => (
                <Box key={corr.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>{corr.title}</div>
                    <span
                      className={
                        corr.severity === "critical"
                          ? "dashboard-chip dashboard-chip-bad"
                          : corr.severity === "warn"
                          ? "dashboard-chip dashboard-chip-warn"
                          : "dashboard-chip dashboard-chip-ok"
                      }
                    >
                      {corr.severity}
                    </span>
                  </div>
                  <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 6 }}>
                    {corr.detail} · key: <b>{corr.key}</b>
                  </div>
                  <div style={{ marginTop: 8, color: "var(--dash-muted)" }}>
                    Hosts: {corr.hosts.join(", ")}
                  </div>
                </Box>
              ))}
            </div>
          )}

          {recommendations.length > 0 ? (
            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {recommendations.map((rec) => (
                <Box key={rec.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>{rec.title}</div>
                    <span className={priorityTone(rec.priority)}>{rec.priority}</span>
                  </div>
                  <div style={{ marginTop: 8, color: "var(--dash-muted)" }}>{rec.why}</div>
                  <div style={{ marginTop: 8 }}>
                    <strong>Suggested action:</strong> {rec.suggestedAction}
                  </div>
                  {rec.evidence.length > 0 ? (
                    <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                      {rec.evidence.map((item) => (
                        <span key={item} className="dashboard-chip">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Box>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
