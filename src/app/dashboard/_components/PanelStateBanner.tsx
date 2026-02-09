import React from "react";
import Box from "./Box";
import type { DashboardPanelHealth } from "../_lib/types";

function chipClass(status: DashboardPanelHealth["status"]): string {
  if (status === "ready") return "dashboard-chip dashboard-chip-ok";
  if (status === "empty") return "dashboard-chip dashboard-chip";
  if (status === "loading") return "dashboard-chip dashboard-chip-warn";
  if (status === "forbidden") return "dashboard-chip dashboard-chip-warn";
  return "dashboard-chip dashboard-chip-bad";
}

function titleFor(status: DashboardPanelHealth["status"]): string {
  if (status === "ready") return "Live data connected";
  if (status === "empty") return "No records in this window";
  if (status === "loading") return "Loading";
  if (status === "forbidden") return "Access required";
  return "Data unavailable";
}

export default function PanelStateBanner(props: {
  health: DashboardPanelHealth;
  showWhenReady?: boolean;
}) {
  const { health, showWhenReady = false } = props;
  if (!showWhenReady && health.status === "ready") return null;

  return (
    <Box style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={chipClass(health.status)}>{health.status}</span>
        <div style={{ fontWeight: 700 }}>{titleFor(health.status)}</div>
      </div>
      <div style={{ marginTop: 8, color: "var(--dash-meta)" }}>{health.message}</div>
    </Box>
  );
}
