import React from "react";
import { fmt } from "@/lib/status";
import type { SloObjective } from "@/lib/slo";
import Box from "../Box";
import NoobTip from "../NoobTip";
import PanelStateBanner from "../PanelStateBanner";
import type { DashboardOpsSnapshot } from "../../_lib/types";

type ChipTone = "neutral" | "ok" | "warn" | "bad";

function chipToneClass(tone: ChipTone): string {
  if (tone === "ok") return "dashboard-chip dashboard-chip-ok";
  if (tone === "warn") return "dashboard-chip dashboard-chip-warn";
  if (tone === "bad") return "dashboard-chip dashboard-chip-bad";
  return "dashboard-chip";
}

function statusTone(status: string): ChipTone {
  if (status === "ok" || status === "succeeded" || status === "resolved") return "ok";
  if (status === "warn" || status === "acknowledged") return "warn";
  if (status === "critical" || status === "breach" || status === "open") return "bad";
  return "neutral";
}

function formatPct(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(2)}%`;
}

function formatMinutes(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(1)}m`;
}

function objectiveSummary(obj: SloObjective): string {
  if (obj.kind === "percent") {
    return `${formatPct(obj.currentPct)} / ${obj.targetPct}% target`;
  }
  return `${formatMinutes(obj.currentMinutes)} / ${obj.targetMinutes}m target`;
}

function formatUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function MissionControlSection(props: {
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { ops, snapshotTs } = props;
  const queue = ops.queue;
  const incidents = ops.incidents;
  const slo = ops.slo;
  const observability = ops.observability;
  const fleet = ops.fleet;
  const keyLifecycle = ops.keyLifecycle;
  const health = ops.panelHealth;

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <NoobTip text="Backend engine health: queue, incident workflow, SLO burn, observability, fleet safety, and key lifecycle.">
            Mission Control
          </NoobTip>
        </h2>
      </div>

      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · Data refresh: <b>{fmt(ops.generatedAtIso)}</b>
      </div>

      <div className="dashboard-mission-grid" style={{ marginTop: 10 }}>
        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Self-healing jobs waiting/running. DLQ means jobs that failed too many times or failed canary checks.">
                Remediation Queue
              </NoobTip>
            </div>
          </div>

          <PanelStateBanner health={health.queue} />
          {health.queue.status === "error" ||
          health.queue.status === "loading" ||
          health.queue.status === "forbidden" ||
          !queue ? null : (
            <>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className={chipToneClass(queue.counts.queued > 0 ? "warn" : "ok")}>
                  queued {queue.counts.queued}
                </span>
                <span className={chipToneClass(queue.counts.running > 0 ? "warn" : "ok")}>
                  running {queue.counts.running}
                </span>
                <span className={chipToneClass(queue.counts.approvalPending > 0 ? "warn" : "ok")}>
                  approvals {queue.counts.approvalPending}
                </span>
                <span className={chipToneClass(queue.counts.dlq > 0 ? "bad" : "ok")}>
                  dlq {queue.counts.dlq}
                </span>
              </div>
              <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
                retry scheduled: <b>{queue.counts.retryScheduled}</b> · succeeded:{" "}
                <b>{queue.counts.succeeded}</b> · failed: <b>{queue.counts.failed}</b>
              </div>
            </>
          )}
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Tracks ownership, acknowledgement deadlines, escalations, and postmortem flow.">
                Incident Workflow Engine
              </NoobTip>
            </div>
          </div>

          <PanelStateBanner health={health.incidents} />
          {health.incidents.status === "error" ||
          health.incidents.status === "loading" ||
          health.incidents.status === "forbidden" ||
          !incidents ? null : (
            <>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className={chipToneClass(incidents.counts.open > 0 ? "bad" : "ok")}>
                  open {incidents.counts.open}
                </span>
                <span
                  className={chipToneClass(
                    incidents.counts.acknowledged > 0 ? "warn" : "neutral"
                  )}
                >
                  ack {incidents.counts.acknowledged}
                </span>
                <span
                  className={chipToneClass(
                    incidents.counts.ackOverdue > 0 ? "bad" : "ok"
                  )}
                >
                  ack overdue {incidents.counts.ackOverdue}
                </span>
                <span
                  className={chipToneClass(
                    incidents.counts.escalationDue > 0 ? "warn" : "ok"
                  )}
                >
                  escalation due {incidents.counts.escalationDue}
                </span>
              </div>
              <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
                active incidents: <b>{incidents.incidents.length}</b> · workflow templates:{" "}
                <b>{ops.workflows?.length ?? 0}</b>
              </div>
            </>
          )}
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Checks if reliability/error-budget is being burned too fast. Burn tells when to escalate quickly.">
                SLO & Burn Rate
              </NoobTip>
            </div>
          </div>

          <PanelStateBanner health={health.slo} />
          {health.slo.status === "error" ||
          health.slo.status === "loading" ||
          health.slo.status === "forbidden" ||
          !slo ? null : (
            <>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className={chipToneClass(statusTone(slo.burn.severity))}>
                  burn {slo.burn.severity}
                </span>
                <span className={chipToneClass(slo.burn.shouldAlert ? "warn" : "ok")}>
                  alert {slo.burn.shouldAlert ? "on" : "off"}
                </span>
                <span className="dashboard-chip">route {slo.burn.route}</span>
              </div>
              <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
                {slo.burn.title}: {slo.burn.reason}
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {slo.objectives.slice(0, 5).map((objective) => (
                  <div key={objective.key} style={{ fontSize: 12 }}>
                    <span className={chipToneClass(statusTone(objective.status))}>
                      {objective.key}
                    </span>{" "}
                    <span style={{ marginLeft: 6 }}>{objectiveSummary(objective)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Runtime telemetry: logs, traces, counters, and alert metadata for deep debugging and performance.">
                Observability
              </NoobTip>
            </div>
          </div>

          <PanelStateBanner health={health.observability} />
          {health.observability.status === "error" ||
          health.observability.status === "loading" ||
          health.observability.status === "forbidden" ||
          !observability ? null : (
            <>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className="dashboard-chip">uptime {formatUptime(observability.uptimeMs)}</span>
                <span className="dashboard-chip">counters {observability.counters.length}</span>
                <span className="dashboard-chip">timings {observability.timings.length}</span>
              </div>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className="dashboard-chip">logs {observability.recentLogs.length}</span>
                <span className="dashboard-chip">traces {observability.recentTraces.length}</span>
                <span className="dashboard-chip">alerts {observability.recentAlerts.length}</span>
              </div>
              <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
                Top counter: <b>{observability.counters[0]?.name ?? "n/a"}</b>
              </div>
            </>
          )}
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Group/tag/scope controls for staged rollout and limiting impact when automating changes.">
                Fleet Policy & Blast Radius
              </NoobTip>
            </div>
          </div>

          <PanelStateBanner health={health.fleet} />
          {health.fleet.status === "error" ||
          health.fleet.status === "loading" ||
          health.fleet.status === "forbidden" ||
          !fleet ? null : (
            <>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className="dashboard-chip">hosts {fleet.totalHosts}</span>
                <span className="dashboard-chip">enabled {fleet.enabledHosts}</span>
                <span className={chipToneClass(fleet.pausedHosts > 0 ? "warn" : "ok")}>
                  paused {fleet.pausedHosts}
                </span>
                <span className="dashboard-chip">grouped {fleet.groupedHosts}</span>
              </div>

              <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
                top groups:{" "}
                {fleet.topGroups.length > 0
                  ? fleet.topGroups
                      .slice(0, 4)
                      .map((g) => `${g.key} (${g.count})`)
                      .join(" · ")
                  : "none"}
              </div>
              <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                top tags:{" "}
                {fleet.topTags.length > 0
                  ? fleet.topTags
                      .slice(0, 5)
                      .map((g) => `${g.key} (${g.count})`)
                      .join(" · ")
                  : "none"}
              </div>
            </>
          )}
        </Box>

        <Box>
          <div className="dashboard-card-title-row">
            <div style={{ fontWeight: 800 }}>
              <NoobTip text="Shows key rotation/revocation health so leaked or stale keys do not linger.">
                Key & Secret Lifecycle
              </NoobTip>
            </div>
          </div>

          <PanelStateBanner health={health.keyLifecycle} />
          {health.keyLifecycle.status === "error" ||
          health.keyLifecycle.status === "loading" ||
          health.keyLifecycle.status === "forbidden" ||
          !keyLifecycle ? null : (
            <>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span className={chipToneClass(keyLifecycle.activeKeys > 0 ? "ok" : "warn")}>
                  active {keyLifecycle.activeKeys}
                </span>
                <span className="dashboard-chip">revoked {keyLifecycle.revokedKeys}</span>
                <span className={chipToneClass(keyLifecycle.expiredKeys > 0 ? "warn" : "ok")}>
                  expired {keyLifecycle.expiredKeys}
                </span>
              </div>
              <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                <span
                  className={chipToneClass(
                    keyLifecycle.expiringSoonKeys > 0 ? "warn" : "ok"
                  )}
                >
                  expiring soon {keyLifecycle.expiringSoonKeys}
                </span>
                <span className={chipToneClass(keyLifecycle.staleKeys > 0 ? "warn" : "ok")}>
                  stale {keyLifecycle.staleKeys}
                </span>
                <span className="dashboard-chip">max version v{keyLifecycle.maxVersion}</span>
              </div>
            </>
          )}
        </Box>
      </div>
    </section>
  );
}
