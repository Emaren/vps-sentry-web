// /var/www/vps-sentry-web/src/app/dashboard/_components/StatCard.tsx
import React from "react";
import Box from "./Box";
import NoobTip from "./NoobTip";

export default function StatCard(props: { label: string; value: number; hint?: string }) {
  const { label, value, hint } = props;
  return (
    <Box style={{ minWidth: 140 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--dash-meta)", fontSize: 12 }}>
        {hint ? <NoobTip text={hint}>{label}</NoobTip> : <span>{label}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </Box>
  );
}
