import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import type { DashboardOpsSnapshot } from "../../_lib/types";

type CenterEntry = {
  id: string;
  ts: string;
  kind: "incident" | "remediation";
  title: string;
  subtitle: string;
  tone: "ok" | "warn" | "bad";
  chips: string[];
};

function toneClass(tone: "ok" | "warn" | "bad"): string {
  if (tone === "ok") return "dashboard-chip dashboard-chip-ok";
  if (tone === "warn") return "dashboard-chip dashboard-chip-warn";
  return "dashboard-chip dashboard-chip-bad";
}

function toMs(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}

export default function CommandCenterSection(props: {
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { ops, snapshotTs } = props;
  const entries: CenterEntry[] = [];

  for (const incident of ops.incidents?.incidents ?? []) {
    const tone =
      incident.state === "open"
        ? "bad"
        : incident.state === "acknowledged"
        ? "warn"
        : "ok";
    entries.push({
      id: `incident-${incident.id}`,
      ts: incident.updatedAt ?? incident.createdAt,
      kind: "incident",
      title: incident.title,
      subtitle: `${incident.host?.name ?? "global"} · ${incident.workflowId}`,
      tone,
      chips: [
        `state:${incident.state}`,
        `severity:${incident.severity}`,
        incident.ackOverdue ? "ack-overdue" : "ack-ok",
        `escalations:${incident.escalationCount}`,
      ],
    });
  }

  for (const run of ops.remediation?.recentRuns ?? []) {
    const tone =
      run.state === "failed" || run.dlq
        ? "bad"
        : run.state === "running" || run.state === "queued" || run.approvalPending
        ? "warn"
        : "ok";
    entries.push({
      id: `remediation-${run.runId}`,
      ts: run.finishedAt ?? run.startedAt ?? run.requestedAt,
      kind: "remediation",
      title: run.actionTitle,
      subtitle: `${run.hostName} · ${run.actionKey}`,
      tone,
      chips: [
        `state:${run.state}`,
        `attempts:${run.attempts}/${run.maxAttempts}`,
        run.approvalPending ? "approval-pending" : "approval-clear",
        run.dlq ? "dlq" : "not-dlq",
      ],
    });
  }

  entries.sort((a, b) => toMs(b.ts) - toMs(a.ts));
  const visible = entries.slice(0, 18);

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>Incident + Remediation Command Center</h2>
        <NoobTip text="Unified operational timeline combining incident workflow events with remediation execution flow." />
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Timeline merges incident state and remediation runtime.
      </div>

      {visible.length === 0 ? (
        <Box>No active incident/remediation timeline entries yet.</Box>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {visible.map((entry) => (
            <Box key={entry.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 800 }}>
                  {entry.kind === "incident" ? "Incident" : "Remediation"} · {entry.title}
                </div>
                <span className={toneClass(entry.tone)}>
                  {entry.kind}
                </span>
              </div>
              <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                {entry.subtitle} · {fmt(entry.ts)}
              </div>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                {entry.chips.map((chip) => (
                  <span key={chip} className="dashboard-chip">
                    {chip}
                  </span>
                ))}
              </div>
            </Box>
          ))}
        </div>
      )}
    </section>
  );
}
