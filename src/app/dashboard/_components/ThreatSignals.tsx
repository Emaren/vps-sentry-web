// /var/www/vps-sentry-web/src/app/dashboard/_components/ThreatSignals.tsx
import React from "react";
import Box from "./Box";
import { safeJson } from "@/lib/status";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export default function ThreatSignals({ threat }: { threat?: unknown }) {
  const t = asRecord(threat) ?? {};

  const blocks: React.ReactNode[] = [];
  const entries: Array<[string, unknown]> = [
    ["Suspicious processes", t["suspicious_processes"]],
    ["Top CPU (new hogs)", t["top_cpu"]],
    ["Outbound suspicious (pool/stratum)", t["outbound_suspicious"]],
    ["Persistence hits (user/system)", t["persistence_hits"]],
  ];

  for (let i = 0; i < entries.length; i++) {
    const label = entries[i][0];
    const value = entries[i][1];

    let body: React.ReactNode = (
      <div style={{ opacity: 0.75 }}>— not reported by agent yet</div>
    );

    if (Array.isArray(value)) {
      if (value.length === 0) body = <div>✅ none</div>;
      else body = (
        <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: 0.9 }}>
          {safeJson(value)}
        </pre>
      );
    } else if (value !== undefined) {
      body = (
        <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: 0.9 }}>
          {safeJson(value)}
        </pre>
      );
    }

    blocks.push(
      <Box key={i}>
        <div style={{ fontWeight: 800 }}>{label}</div>
        <div style={{ marginTop: 8 }}>{body}</div>
      </Box>
    );
  }

  return <div style={{ display: "grid", gap: 10 }}>{blocks}</div>;
}
