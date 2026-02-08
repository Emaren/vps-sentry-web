// /var/www/vps-sentry-web/src/app/dashboard/_components/StatCard.tsx
import React from "react";
import Box from "./Box";

export default function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Box style={{ minWidth: 140 }}>
      <div style={{ opacity: 0.8, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </Box>
  );
}
