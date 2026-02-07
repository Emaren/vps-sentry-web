// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/AlertsSection.tsx
import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import type { DerivedDashboard } from "../../_lib/derive";

export default function AlertsSection(props: { derived: DerivedDashboard; snapshotTs: string }) {
  const { derived: d, snapshotTs } = props;

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Alerts</h2>
      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b>
      </div>

      {d.maintenanceActive ? (
        <Box>
          <div style={{ fontWeight: 800, color: "var(--dash-warn-text, #fcd34d)" }}>Maintenance mode active</div>
          <div style={{ marginTop: 8, opacity: 0.9 }}>
            Non-critical alerts are currently suppressed during maintenance.
            {d.maintenanceUntil ? ` Until ${fmt(d.maintenanceUntil)}.` : ""}
          </div>
        </Box>
      ) : null}

      {d.alertsSuppressedCount > 0 ? (
        <Box>
          <div style={{ fontWeight: 700 }}>
            Suppressed alerts: <b>{d.alertsSuppressedCount}</b>
          </div>
          <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
            Suppression can come from allowlist noise filtering, custom suppression regex, package-change toggle, or maintenance mode.
          </div>
        </Box>
      ) : null}

      {d.alertsCount === 0 ? (
        <Box>✅ No actionable alerts.</Box>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {d.alertsForAction.map((a, i) => (
            <Box key={`${a.title}-${i}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 700 }}>{a.title}</div>
                <SeverityBadge severity={a.severityLevel} />
              </div>
              {a.detail ? (
                <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: 0.9 }}>
                  {a.detail}
                </pre>
              ) : null}
            </Box>
          ))}
        </div>
      )}
    </section>
  );
}

function SeverityBadge(props: { severity: "critical" | "high" | "medium" | "low" | "info" }) {
  const tone =
    props.severity === "critical"
      ? { bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", color: "#fecaca" }
      : props.severity === "high"
        ? { bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.35)", color: "#fcd34d" }
        : props.severity === "medium"
          ? { bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.35)", color: "#bfdbfe" }
          : { bg: "rgba(156,163,175,0.12)", border: "rgba(156,163,175,0.35)", color: "#d1d5db" };

  return (
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
      {props.severity}
    </span>
  );
}
