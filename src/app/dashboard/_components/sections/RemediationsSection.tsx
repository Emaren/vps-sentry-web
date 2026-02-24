import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import PanelStateBanner from "../PanelStateBanner";
import RemediationQueueControls from "./RemediationQueueControls";
import type { DashboardOpsSnapshot } from "../../_lib/types";

export default function RemediationsSection(props: {
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { ops, snapshotTs } = props;
  const remediation = ops.remediation;
  const queue = ops.queue;
  const health = ops.panelHealth.remediation;
  const rows = remediation?.recentRuns ?? [];

  const queueCounts = queue?.counts ?? null;
  const queuedCount = queueCounts?.queued ?? remediation?.counts.queued ?? 0;
  const runningCount = queueCounts?.running ?? remediation?.counts.running ?? 0;
  const dlqCount = queueCounts?.dlq ?? remediation?.counts.dlq ?? 0;
  const approvalPendingCount =
    queueCounts?.approvalPending ?? remediation?.counts.approvalPending ?? 0;

  return (
    <section id="remediations" style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <NoobTip text="Live remediation execution ledger: queue/running/DLQ/approval states and latest outcomes.">
            Remediations
          </NoobTip>
        </h2>
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginBottom: 8, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Live source: remediation run history.
      </div>
      <PanelStateBanner health={health} />

      {health.status === "error" || health.status === "forbidden" || health.status === "loading" ? null : (
        <>
          <div className="dashboard-chip-row" style={{ marginBottom: 10 }}>
            <span className={queuedCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
              queued {queuedCount}
            </span>
            <span className={runningCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
              running {runningCount}
            </span>
            <span className={approvalPendingCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
              approvals {approvalPendingCount}
            </span>
            <span className={dlqCount > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
              dlq {dlqCount}
            </span>
            <span className="dashboard-chip">runs {remediation?.counts.total ?? 0}</span>
          </div>

          <RemediationQueueControls
            queuedCount={queuedCount}
            dlqCount={dlqCount}
            approvalPendingCount={approvalPendingCount}
          />

          {rows.length === 0 ? (
            <Box>No remediation runs recorded yet.</Box>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {rows.slice(0, 12).map((run) => (
                <Box key={run.runId}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800 }}>
                      {run.actionTitle}
                      <span style={{ marginLeft: 8, color: "var(--dash-meta)", fontWeight: 500 }}>
                        {run.hostName} · {run.actionKey}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span
                        className={
                          run.state === "succeeded"
                            ? "dashboard-chip dashboard-chip-ok"
                            : run.state === "failed"
                            ? "dashboard-chip dashboard-chip-bad"
                            : run.state === "running" || run.state === "queued"
                            ? "dashboard-chip dashboard-chip-warn"
                            : "dashboard-chip"
                        }
                      >
                        {run.state}
                      </span>
                      {run.approvalPending ? (
                        <span className="dashboard-chip dashboard-chip-warn">approval pending</span>
                      ) : null}
                      {run.dlq ? <span className="dashboard-chip dashboard-chip-bad">dlq</span> : null}
                      {run.retryScheduled ? (
                        <span className="dashboard-chip dashboard-chip-warn">retry scheduled</span>
                      ) : null}
                      {run.autoQueued ? (
                        <span className="dashboard-chip">auto:{run.autoTier ?? "true"}</span>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                    Requested: <b>{fmt(run.requestedAt)}</b> · Started: <b>{fmt(run.startedAt ?? undefined)}</b> ·
                    Finished: <b>{fmt(run.finishedAt ?? undefined)}</b>
                  </div>
                  <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
                    Requested by: <b>{run.requestedByEmail ?? "system"}</b> · Attempts: <b>{run.attempts}</b> /{" "}
                    <b>{run.maxAttempts}</b> · Canary:{" "}
                    <b>{run.canaryPassed === null ? "n/a" : run.canaryPassed ? "pass" : "fail"}</b> · Rollback:{" "}
                    <b>
                      {run.rollbackAttempted
                        ? run.rollbackSucceeded === null
                          ? "attempted"
                          : run.rollbackSucceeded
                          ? "success"
                          : "failed"
                        : "not-run"}
                    </b>
                  </div>
                  {run.error ? (
                    <pre
                      style={{
                        marginTop: 8,
                        whiteSpace: "pre-wrap",
                        color: "var(--dash-sev-critical-text, #fecaca)",
                      }}
                    >
                      {run.error}
                    </pre>
                  ) : null}
                </Box>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
