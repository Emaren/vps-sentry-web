// /var/www/vps-sentry-web/src/app/dashboard/_components/StatCard.tsx
import React from "react";
import Box from "./Box";
import NoobTip from "./NoobTip";

export default function StatCard(props: { label: string; value: number; hint?: string }) {
  const { label, value, hint } = props;
  return (
    <Box className="dashboard-kpi-card" style={{ minWidth: 140 }}>
      <div className="dashboard-kpi-card-label">
        {hint ? <NoobTip text={hint}>{label}</NoobTip> : <span>{label}</span>}
      </div>
      <div className="dashboard-kpi-card-value">{value}</div>
      <div className="dashboard-kpi-card-rule" />
      <div className="dashboard-kpi-card-foot">snapshot signal</div>
    </Box>
  );
}
