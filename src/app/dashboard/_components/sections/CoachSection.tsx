import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import type { DerivedDashboard } from "../../_lib/derive";
import type { DashboardOpsSnapshot } from "../../_lib/types";

type CoachItem = {
  id: string;
  priority: "critical" | "warning" | "info";
  title: string;
  action: string;
};

function priorityClass(priority: CoachItem["priority"]): string {
  if (priority === "critical") return "dashboard-chip dashboard-chip-bad";
  if (priority === "warning") return "dashboard-chip dashboard-chip-warn";
  return "dashboard-chip dashboard-chip-ok";
}

export default function CoachSection(props: {
  derived: DerivedDashboard;
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { derived: d, ops, snapshotTs } = props;

  const items: CoachItem[] = [];

  if (d.alertsCount > 0) {
    items.push({
      id: "alerts",
      priority: d.topAlertSeverity === "critical" || d.topAlertSeverity === "high" ? "critical" : "warning",
      title: `${d.alertsCount} actionable alert(s) detected`,
      action: "Open Alerts first, handle critical/high items, then re-check status.",
    });
  }

  if (d.publicPortsCount > 0) {
    items.push({
      id: "ports",
      priority: "critical",
      title: `${d.publicPortsCount} unexpected public port(s) exposed`,
      action: "Review Public Listening Ports and run the related remediation dry-run before execute.",
    });
  }

  if ((ops.incidents?.counts.ackOverdue ?? 0) > 0) {
    items.push({
      id: "ack-overdue",
      priority: "critical",
      title: `${ops.incidents?.counts.ackOverdue ?? 0} incident ack deadline(s) overdue`,
      action: "Assign/acknowledge incidents now to stop escalation and start controlled response.",
    });
  }

  if ((ops.queue?.counts.approvalPending ?? 0) > 0) {
    items.push({
      id: "approvals",
      priority: "warning",
      title: `${ops.queue?.counts.approvalPending ?? 0} remediation approval(s) waiting`,
      action: "Review pending approvals and either approve or reject to unblock queue flow.",
    });
  }

  if ((ops.remediation?.counts.dlq ?? 0) > 0) {
    items.push({
      id: "dlq",
      priority: "critical",
      title: `${ops.remediation?.counts.dlq ?? 0} remediation run(s) in DLQ`,
      action: "Inspect failed runs, confirm rollback state, then replay safely with canary enabled.",
    });
  }

  if ((ops.shipping?.counts.failed24h ?? 0) > 0) {
    items.push({
      id: "shipping-fail",
      priority: "warning",
      title: `${ops.shipping?.counts.failed24h ?? 0} notification delivery failure(s) in 24h`,
      action: "Check Shipping section errors and validate SMTP/webhook transport before next alert cycle.",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "healthy",
      priority: "info",
      title: "No urgent blockers detected",
      action: "Stay in observe mode, keep backups/drills current, and watch adaptive recommendations for policy tuning.",
    });
  }

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Noob Coach v2</h2>
        <NoobTip text="Contextual play-by-play: what to do next, in plain language, based on current live risk signals." />
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Auto-prioritized guidance from current dashboard state.
      </div>

      <Box>
        <div style={{ display: "grid", gap: 10 }}>
          {items.slice(0, 6).map((item, idx) => (
            <div key={item.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className={priorityClass(item.priority)}>{item.priority}</span>
                <span style={{ fontWeight: 800 }}>
                  {idx + 1}. {item.title}
                </span>
              </div>
              <div style={{ marginTop: 4, color: "var(--dash-muted)" }}>{item.action}</div>
            </div>
          ))}
        </div>
      </Box>
    </section>
  );
}
