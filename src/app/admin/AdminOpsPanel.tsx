"use client";

import { useMemo, useState, type CSSProperties } from "react";
import IncidentEnginePanel from "@/app/admin/IncidentEnginePanel";
import type {
  IncidentRunDetail,
  IncidentRunListSnapshot,
} from "@/lib/ops/incident-engine";
import type { IncidentWorkflow, IncidentWorkflowStep } from "@/lib/ops/workflows";
import type {
  AlertMetadata,
  ObservabilityLogEntry,
  ObservabilitySnapshot,
  ObservabilityTraceEntry,
} from "@/lib/observability";
import type { AppRole } from "@/lib/rbac-policy";
import type {
  RemediationQueueSnapshot,
  RemediationQueueSnapshotItem,
} from "@/lib/remediate/queue";
import type { SloObjective, SloSnapshot } from "@/lib/slo";

type RecentOp = {
  id: string;
  action: string;
  detail: string | null;
  createdAtIso: string;
  userEmail: string | null;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  [k: string]: unknown;
};

export default function AdminOpsPanel(props: {
  workflows: IncidentWorkflow[];
  recentOps: RecentOp[];
  queueSnapshot: RemediationQueueSnapshot;
  observabilitySnapshot: ObservabilitySnapshot;
  sloSnapshot: SloSnapshot;
  incidentSnapshot: IncidentRunListSnapshot;
  initialIncidentDetail: IncidentRunDetail | null;
  incidentAssignees: Array<{
    id: string;
    email: string;
    name: string | null;
    role: AppRole;
  }>;
  currentIdentity: {
    userId: string;
    email: string;
    role: AppRole;
  };
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultPreview, setResultPreview] = useState<string | null>(null);
  const [notifyTarget, setNotifyTarget] = useState("");
  const [notifyKind, setNotifyKind] = useState<"" | "EMAIL" | "WEBHOOK">("");
  const [replayRunId, setReplayRunId] = useState("");
  const [queueSnapshot, setQueueSnapshot] = useState<RemediationQueueSnapshot>(
    props.queueSnapshot
  );
  const [observability, setObservability] = useState<ObservabilitySnapshot>(
    props.observabilitySnapshot
  );
  const [slo, setSlo] = useState<SloSnapshot>(props.sloSnapshot);

  const workflowCount = props.workflows.length;
  const apiStepCount = useMemo(
    () => props.workflows.reduce((n, w) => n + w.steps.filter((s) => s.kind === "api").length, 0),
    [props.workflows]
  );
  const topCounters = useMemo(
    () => observability.counters.slice(0, 12),
    [observability.counters]
  );
  const topTimings = useMemo(
    () => observability.timings.slice(0, 12),
    [observability.timings]
  );

  const requestsTotal = useMemo(
    () => sumCounterByName(observability.counters, "api.requests.total"),
    [observability.counters]
  );
  const requests5xx = useMemo(
    () =>
      sumCounterByName(observability.counters, "api.requests.by_status.total", {
        statusPrefix: "5",
      }),
    [observability.counters]
  );
  const rateLimited = useMemo(
    () =>
      sumCounterByName(observability.counters, "middleware.ratelimit.total", {
        limited: "true",
      }),
    [observability.counters]
  );

  async function postJson(path: string, body: Record<string, unknown>, key: string) {
    setBusyKey(key);
    setMessage(null);
    setResultPreview(null);

    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok) {
        setMessage(`${key} failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }

      setMessage(`${key} completed.`);
      setResultPreview(preview(data));
    } catch (err: unknown) {
      setMessage(`${key} failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshQueueSnapshot(limit?: number, dlqOnly = false) {
    const key = "queue:refresh";
    setBusyKey(key);
    try {
      const q = new URLSearchParams();
      q.set("limit", String(limit ?? queueSnapshot.limit ?? 30));
      if (dlqOnly) q.set("dlq", "1");
      const res = await fetch(`/api/ops/remediate-queue?${q.toString()}`, {
        method: "GET",
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok || !data.snapshot) {
        setMessage(`queue:refresh failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }
      setQueueSnapshot(data.snapshot as RemediationQueueSnapshot);
      setMessage("queue:refresh completed.");
      setResultPreview(preview(data));
    } catch (err: unknown) {
      setMessage(`queue:refresh failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  function buildStepPayload(step: IncidentWorkflowStep): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      ...(step.defaultPayload ?? {}),
    };

    if (step.action === "notify-test") {
      if (notifyTarget.trim()) payload.target = notifyTarget.trim();
      if (notifyKind) payload.kind = notifyKind;
    }

    return payload;
  }

  async function runWorkflowStep(workflow: IncidentWorkflow, step: IncidentWorkflowStep) {
    if (step.kind !== "api" || !step.action) {
      setMessage(`Step ${workflow.id}/${step.id} is manual-only.`);
      return;
    }

    await postJson(
      "/api/ops/incident-workflow",
      {
        workflowId: workflow.id,
        stepId: step.id,
        payload: buildStepPayload(step),
      },
      `workflow:${workflow.id}/${step.id}`
    );
    await refreshQueueSnapshot();
  }

  async function replaySingleRun(runId: string) {
    const id = runId.trim();
    if (!id) {
      setMessage("replay runId is required.");
      return;
    }
    await postJson("/api/ops/remediate-replay", { mode: "single", runId: id }, `replay:${id}`);
    await refreshQueueSnapshot();
  }

  async function replayDlqBatch(limit = 3) {
    await postJson(
      "/api/ops/remediate-replay",
      { mode: "dlq-batch", limit },
      `replay:dlq:${limit}`
    );
    await refreshQueueSnapshot();
  }

  async function setQueueApproval(runId: string, mode: "approve" | "reject") {
    const id = runId.trim();
    if (!id) {
      setMessage("approval runId is required.");
      return;
    }
    const key = `approval:${mode}:${id}`;
    await postJson(
      "/api/ops/remediate-queue",
      {
        runId: id,
        mode,
      },
      key
    );
    await refreshQueueSnapshot();
  }

  async function refreshObservability() {
    const key = "obs:refresh";
    setBusyKey(key);
    try {
      const params = new URLSearchParams({
        logs: "80",
        traces: "80",
        alerts: "80",
        counters: "350",
        timings: "350",
      });
      const res = await fetch(`/api/ops/observability?${params.toString()}`, {
        method: "GET",
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok || !data.snapshot) {
        setMessage(`observability:refresh failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }
      setObservability(data.snapshot as ObservabilitySnapshot);
      setMessage("observability:refresh completed.");
      setResultPreview(preview(data));
    } catch (err: unknown) {
      setMessage(`observability:refresh failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshSlo() {
    const key = "slo:refresh";
    setBusyKey(key);
    try {
      const res = await fetch("/api/ops/slo", { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok || !data.snapshot) {
        setMessage(`slo:refresh failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }
      setSlo(data.snapshot as SloSnapshot);
      setMessage("slo:refresh completed.");
      setResultPreview(preview(data));
    } catch (err: unknown) {
      setMessage(`slo:refresh failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section
      style={{
        marginTop: 18,
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        background: "rgba(255,255,255,0.02)",
        padding: 14,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 20 }}>Operator Console</h2>
      <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.78 }}>
        Workflow-driven incident operations with one-click execution for API-safe steps.
      </p>

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
        <Pill text={`Workflows: ${workflowCount}`} />
        <Pill text={`API steps: ${apiStepCount}`} tone="ok" />
        <Pill text={`Recent ops logs: ${props.recentOps.length}`} tone="warn" />
      </div>

      <section style={blockStyle()}>
        <h3 style={h3Style()}>Quick Actions</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton
            text="Drain Queue"
            busy={busyKey === "quick:drain"}
            onClick={async () => {
              await postJson("/api/ops/remediate-drain", { limit: 8 }, "quick:drain");
              await refreshQueueSnapshot();
            }}
          />
          <ActionButton
            text="Trigger Report Email"
            busy={busyKey === "quick:report"}
            onClick={() => postJson("/api/ops/report-now", {}, "quick:report")}
          />
          <ActionButton
            text="Test Admin Email"
            busy={busyKey === "quick:test-email"}
            onClick={() => postJson("/api/ops/test-email", {}, "quick:test-email")}
          />
          <ActionButton
            text="Status Snapshot"
            busy={busyKey === "quick:status"}
            onClick={() =>
              postJson(
                "/api/ops/incident-workflow",
                { workflowId: "critical-triage", stepId: "status-snapshot" },
                "quick:status"
              )
            }
          />
          <ActionButton
            text="Refresh Queue"
            busy={busyKey === "queue:refresh"}
            onClick={() => refreshQueueSnapshot()}
          />
          <ActionButton
            text="Replay DLQ (3)"
            busy={busyKey === "replay:dlq:3"}
            onClick={() => replayDlqBatch(3)}
          />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={notifyTarget}
            onChange={(e) => setNotifyTarget(e.currentTarget.value)}
            placeholder="optional notify target (email or webhook URL)"
            style={inputStyle()}
          />
          <select
            value={notifyKind}
            onChange={(e) => setNotifyKind(e.currentTarget.value as "" | "EMAIL" | "WEBHOOK")}
            style={inputStyle()}
          >
            <option value="">kind:auto</option>
            <option value="EMAIL">EMAIL</option>
            <option value="WEBHOOK">WEBHOOK</option>
          </select>
          <ActionButton
            text="Run Notify Test"
            busy={busyKey === "quick:notify"}
            onClick={() =>
              postJson(
                "/api/ops/incident-workflow",
                {
                  workflowId: "critical-triage",
                  stepId: "notify-test",
                  payload: {
                    target: notifyTarget.trim() || undefined,
                    kind: notifyKind || undefined,
                  },
                },
                "quick:notify"
              )
            }
          />
        </div>
      </section>

      <section style={blockStyle()}>
        <h3 style={h3Style()}>Queue / DLQ Visibility</h3>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          <Pill text={`queued ${queueSnapshot.counts.queued}`} tone="warn" />
          <Pill text={`running ${queueSnapshot.counts.running}`} tone="ok" />
          <Pill text={`retry-scheduled ${queueSnapshot.counts.retryScheduled}`} tone="warn" />
          <Pill
            text={`approval-pending ${queueSnapshot.counts.approvalPending}`}
            tone={queueSnapshot.counts.approvalPending > 0 ? "warn" : "ok"}
          />
          <Pill text={`dlq ${queueSnapshot.counts.dlq}`} tone={queueSnapshot.counts.dlq > 0 ? "bad" : "ok"} />
          <Pill text={`failed ${queueSnapshot.counts.failed}`} tone={queueSnapshot.counts.failed > 0 ? "warn" : "ok"} />
          <Pill text={`canceled ${queueSnapshot.counts.canceled}`} tone="neutral" />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={replayRunId}
            onChange={(e) => setReplayRunId(e.currentTarget.value)}
            placeholder="run id to replay"
            style={inputStyle()}
          />
          <ActionButton
            text="Replay Run"
            busy={Boolean(busyKey && busyKey.startsWith("replay:"))}
            onClick={() => replaySingleRun(replayRunId)}
          />
          <ActionButton
            text="Show DLQ only"
            busy={busyKey === "queue:refresh"}
            onClick={() => refreshQueueSnapshot(30, true)}
          />
          <ActionButton
            text="Show All"
            busy={busyKey === "queue:refresh"}
            onClick={() => refreshQueueSnapshot(30, false)}
          />
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {queueSnapshot.items.length === 0 ? (
            <div style={{ opacity: 0.72 }}>No queue items for selected filter.</div>
          ) : (
            queueSnapshot.items.map((item) => (
              <QueueItemRow
                key={item.runId}
                item={item}
                busyReplay={busyKey === `replay:${item.runId}`}
                busyApprove={busyKey === `approval:approve:${item.runId}`}
                busyReject={busyKey === `approval:reject:${item.runId}`}
                onReplay={() => replaySingleRun(item.runId)}
                onApprove={() => setQueueApproval(item.runId, "approve")}
                onReject={() => setQueueApproval(item.runId, "reject")}
              />
            ))
          )}
        </div>
      </section>

      <section style={blockStyle()}>
        <h3 style={h3Style()}>Observability</h3>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          <Pill text={`uptime ${fmtMs(observability.uptimeMs)}`} tone="neutral" />
          <Pill text={`api requests ${requestsTotal}`} tone="ok" />
          <Pill text={`api 5xx ${requests5xx}`} tone={requests5xx > 0 ? "bad" : "ok"} />
          <Pill text={`rate limited ${rateLimited}`} tone={rateLimited > 0 ? "warn" : "ok"} />
          <Pill text={`alerts meta ${observability.recentAlerts.length}`} tone="warn" />
          <Pill text={`traces ${observability.recentTraces.length}`} tone="ok" />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton
            text="Refresh Observability"
            busy={busyKey === "obs:refresh"}
            onClick={() => refreshObservability()}
          />
          <ActionButton
            text="Open /api/ops/metrics"
            onClick={() => {
              window.open("/api/ops/metrics", "_blank", "noopener,noreferrer");
            }}
          />
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Top Counters ({topCounters.length})</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {topCounters.map((c, idx) => (
              <div key={`${c.name}-${idx}`} style={entryRowStyle()}>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  value={c.value} · {renderLabels(c.labels)}
                </div>
              </div>
            ))}
          </div>
        </details>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Top Timings ({topTimings.length})</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {topTimings.map((t, idx) => (
              <div key={`${t.name}-${idx}`} style={entryRowStyle()}>
                <div style={{ fontWeight: 700 }}>{t.name}</div>
                <div style={{ fontSize: 12, opacity: 0.82 }}>
                  count={t.count} · p50={fmtMs(t.p50Ms)} · p95={fmtMs(t.p95Ms)} · max={fmtMs(t.maxMs)} ·{" "}
                  {renderLabels(t.labels)}
                </div>
              </div>
            ))}
          </div>
        </details>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Alert Metadata ({observability.recentAlerts.length})
          </summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {observability.recentAlerts.map((item, idx) => (
              <AlertRow key={`${item.ts}-${idx}`} item={item} />
            ))}
          </div>
        </details>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Recent Traces ({observability.recentTraces.length})
          </summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {observability.recentTraces.map((item, idx) => (
              <TraceRow key={`${item.ts}-${idx}`} item={item} />
            ))}
          </div>
        </details>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Structured Logs ({observability.recentLogs.length})
          </summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {observability.recentLogs.map((item, idx) => (
              <LogRow key={`${item.ts}-${idx}`} item={item} />
            ))}
          </div>
        </details>
      </section>

      <section style={blockStyle()}>
        <h3 style={h3Style()}>SLO / Burn-Rate</h3>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          <Pill text={`severity ${slo.burn.severity}`} tone={toneBySloSeverity(slo.burn.severity)} />
          <Pill text={`route ${slo.burn.route}`} tone="neutral" />
          <Pill text={`max burn ${slo.burn.maxBurnRate}`} tone={slo.burn.maxBurnRate >= 1 ? "warn" : "ok"} />
          <Pill
            text={`open breaches > MTTD ${slo.openBreachesOlderThanMttdTarget}`}
            tone={slo.openBreachesOlderThanMttdTarget > 0 ? "warn" : "ok"}
          />
          <Pill text={`window ${slo.windowHours}h`} tone="neutral" />
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton
            text="Refresh SLO"
            busy={busyKey === "slo:refresh"}
            onClick={() => refreshSlo()}
          />
          <ActionButton
            text="Open /api/ops/slo"
            onClick={() => {
              window.open("/api/ops/slo", "_blank", "noopener,noreferrer");
            }}
          />
        </div>

        <div style={{ marginTop: 8, opacity: 0.8 }}>
          {slo.burn.title}: {slo.burn.reason}
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Objectives ({slo.objectives.length})
          </summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {slo.objectives.map((objective) => (
              <SloObjectiveRow key={objective.key} objective={objective} />
            ))}
          </div>
        </details>
      </section>

      <section style={blockStyle()}>
        <h3 style={h3Style()}>Incident Workflows</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {props.workflows.map((workflow) => (
            <article key={workflow.id} style={workflowCardStyle()}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800 }}>{workflow.title}</div>
                  <div style={{ opacity: 0.8, marginTop: 4 }}>{workflow.summary}</div>
                </div>
                <Pill text={workflow.severity.toUpperCase()} tone={toneBySeverity(workflow.severity)} />
              </div>

              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                Trigger signals: {workflow.triggerSignals.join(", ")}
              </div>

              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                Playbooks: {workflow.playbookRefs.join(" | ")}
              </div>

              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {workflow.steps.map((step) => {
                  const key = `workflow:${workflow.id}/${step.id}`;
                  const busy = busyKey === key;

                  return (
                    <div key={step.id} style={stepRowStyle()}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{step.title}</div>
                        <div style={{ fontSize: 12, opacity: 0.78 }}>{step.description}</div>
                      </div>

                      {step.kind === "api" ? (
                        <ActionButton text={busy ? "Running..." : "Run Step"} busy={busy} onClick={() => runWorkflowStep(workflow, step)} />
                      ) : (
                        <Pill text="manual" tone="neutral" />
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      </section>

      <IncidentEnginePanel
        workflows={props.workflows}
        initialSnapshot={props.incidentSnapshot}
        initialIncidentDetail={props.initialIncidentDetail}
        incidentAssignees={props.incidentAssignees}
        currentIdentity={props.currentIdentity}
      />

      <section style={blockStyle()}>
        <h3 style={h3Style()}>Recent Ops Timeline</h3>
        {props.recentOps.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No recent ops entries.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {props.recentOps.map((entry) => (
              <div key={entry.id} style={entryRowStyle()}>
                <div style={{ fontWeight: 700 }}>{entry.action}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{entry.createdAtIso}</div>
                <div style={{ marginTop: 4 }}>{entry.detail ?? "-"}</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  actor: {entry.userEmail ?? "system"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {message ? (
        <div style={messageStyle()}>{message}</div>
      ) : null}

      {resultPreview ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Last action result</summary>
          <pre style={preStyle()}>{resultPreview}</pre>
        </details>
      ) : null}
    </section>
  );
}

function renderLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (!entries.length) return "labels:none";
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return "0ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function sumCounterByName(
  counters: ObservabilitySnapshot["counters"],
  name: string,
  filters?: { statusPrefix?: string; limited?: string }
): number {
  return counters
    .filter((c) => c.name === name)
    .filter((c) => {
      if (filters?.statusPrefix && !String(c.labels.status ?? "").startsWith(filters.statusPrefix)) {
        return false;
      }
      if (filters?.limited && String(c.labels.limited ?? "") !== filters.limited) {
        return false;
      }
      return true;
    })
    .reduce((sum, c) => sum + c.value, 0);
}

function toneBySloSeverity(severity: SloSnapshot["burn"]["severity"]): "ok" | "warn" | "bad" | "neutral" {
  if (severity === "critical") return "bad";
  if (severity === "warn") return "warn";
  return "ok";
}

function toneBySloStatus(status: SloObjective["status"]): "ok" | "warn" | "bad" | "neutral" {
  if (status === "breach") return "bad";
  if (status === "insufficient_data") return "warn";
  return "ok";
}

function SloObjectiveRow(props: { objective: SloObjective }) {
  const { objective } = props;
  return (
    <div style={entryRowStyle()}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Pill text={objective.key} tone="neutral" />
        <Pill text={objective.status} tone={toneBySloStatus(objective.status)} />
      </div>
      <div style={{ marginTop: 4, fontWeight: 700 }}>{objective.title}</div>
      {objective.kind === "percent" ? (
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
          current={objective.currentPct === null ? "n/a" : `${objective.currentPct.toFixed(2)}%`} · target=
          {objective.targetPct}% · budget={objective.errorBudgetRemainingPct === null
            ? "n/a"
            : `${objective.errorBudgetRemainingPct.toFixed(2)}%`}
          {" "}· burn(short/long)={objective.burnRateShort ?? "n/a"}/{objective.burnRateLong ?? "n/a"}
        </div>
      ) : (
        <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
          current={objective.currentMinutes === null ? "n/a" : `${objective.currentMinutes.toFixed(2)}m`} · target=
          {objective.targetMinutes}m · samples={objective.sampleCount}
        </div>
      )}
    </div>
  );
}

function LogRow(props: { item: ObservabilityLogEntry }) {
  const { item } = props;
  const tone = item.level === "error" ? "bad" : item.level === "warn" ? "warn" : "neutral";
  return (
    <div style={entryRowStyle()}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Pill text={item.level} tone={tone} />
        <span style={{ fontSize: 12, opacity: 0.75 }}>{item.ts}</span>
        {item.route ? <Pill text={item.route} tone="neutral" /> : null}
      </div>
      <div style={{ marginTop: 5, fontWeight: 700 }}>{item.message}</div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.76 }}>
        correlation={item.correlationId ?? "na"} trace={item.traceId ?? "na"} span={item.spanId ?? "na"}
      </div>
      {item.fields ? (
        <pre style={{ ...preStyle(), marginTop: 6, fontSize: 11 }}>{preview(item.fields)}</pre>
      ) : null}
    </div>
  );
}

function TraceRow(props: { item: ObservabilityTraceEntry }) {
  const { item } = props;
  return (
    <div style={entryRowStyle()}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Pill text={item.status} tone={item.status === "ok" ? "ok" : "bad"} />
        <span style={{ fontWeight: 700 }}>{item.name}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.76 }}>
        {item.ts} · duration={fmtMs(item.durationMs)} · route={item.route ?? "-"} · correlation=
        {item.correlationId ?? "na"} · trace={item.traceId ?? "na"}
      </div>
      {item.attributes ? (
        <pre style={{ ...preStyle(), marginTop: 6, fontSize: 11 }}>{preview(item.attributes)}</pre>
      ) : null}
    </div>
  );
}

function AlertRow(props: { item: AlertMetadata }) {
  const { item } = props;
  const tone = item.severity === "critical" ? "bad" : item.severity === "warn" ? "warn" : "ok";
  return (
    <div style={entryRowStyle()}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Pill text={item.severity} tone={tone} />
        <Pill text={item.kind} tone="neutral" />
        {typeof item.status === "number" ? <Pill text={`status ${item.status}`} tone="neutral" /> : null}
        <span style={{ fontSize: 12, opacity: 0.75 }}>{item.ts}</span>
      </div>
      <div style={{ marginTop: 5, fontWeight: 700 }}>{item.title}</div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.76 }}>
        delivered={item.deliveredOk === null ? "unknown" : item.deliveredOk ? "true" : "false"} · target=
        {item.target ?? "-"} · correlation={item.correlationId ?? "na"} · trace={item.traceId ?? "na"}
      </div>
      {item.detail ? <div style={{ marginTop: 4, opacity: 0.84 }}>{item.detail}</div> : null}
    </div>
  );
}

function preview(v: unknown): string {
  try {
    const raw = JSON.stringify(v, null, 2);
    if (raw.length <= 2800) return raw;
    return `${raw.slice(0, 2800)}\n...[truncated]`;
  } catch {
    return String(v);
  }
}

function queueStateTone(item: RemediationQueueSnapshotItem): "ok" | "warn" | "bad" | "neutral" {
  if (item.dlq) return "bad";
  if (item.state === "succeeded") return "ok";
  if (item.state === "running") return "ok";
  if (item.state === "queued" && item.approvalRequired && item.approvalStatus === "pending") {
    return "warn";
  }
  if (item.state === "queued" && item.delayed) return "warn";
  if (item.state === "failed" || item.state === "canceled") return "warn";
  return "neutral";
}

function QueueItemRow(props: {
  item: RemediationQueueSnapshotItem;
  busyReplay: boolean;
  busyApprove: boolean;
  busyReject: boolean;
  onReplay: () => void | Promise<void>;
  onApprove: () => void | Promise<void>;
  onReject: () => void | Promise<void>;
}) {
  const { item } = props;
  const attemptText = `${item.attempts}/${item.maxAttempts}`;
  const approvalPending =
    item.approvalRequired && item.approvalStatus === "pending" && item.state === "queued";

  return (
    <div style={entryRowStyle()}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill text={item.state} tone={queueStateTone(item)} />
          <Pill text={`attempts ${attemptText}`} tone={item.dlq ? "bad" : "neutral"} />
          {item.dlq ? <Pill text="DLQ" tone="bad" /> : null}
          {item.delayed ? <Pill text="delayed retry" tone="warn" /> : null}
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>{item.requestedAt}</div>
      </div>

      <div style={{ marginTop: 6, fontWeight: 700 }}>
        {item.hostName} · {item.actionKey}
      </div>
      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
        run {item.runId}
        {item.replayOfRunId ? ` (replay of ${item.replayOfRunId})` : ""}
      </div>

      {item.nextAttemptAt ? (
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
          next attempt: {item.nextAttemptAt}
        </div>
      ) : null}
      {item.lastError || item.error ? (
        <div style={{ marginTop: 4, opacity: 0.86 }}>
          error: {item.lastError ?? item.error}
        </div>
      ) : null}

      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {item.approvalRequired ? (
          <Pill
            text={`approval ${item.approvalStatus}`}
            tone={
              item.approvalStatus === "approved"
                ? "ok"
                : item.approvalStatus === "pending"
                ? "warn"
                : item.approvalStatus === "rejected"
                ? "bad"
                : "neutral"
            }
          />
        ) : null}
        {item.autoQueued ? <Pill text="auto" tone="warn" /> : null}
        {item.autoTier ? <Pill text={`tier ${item.autoTier}`} tone="neutral" /> : null}
        {item.canaryEnabled ? (
          <Pill
            text={`canary ${item.canaryPassed === null ? "pending" : item.canaryPassed ? "pass" : "fail"}`}
            tone={
              item.canaryPassed === null ? "warn" : item.canaryPassed ? "ok" : "bad"
            }
          />
        ) : null}
        {item.rollbackEnabled ? (
          <Pill
            text={
              item.rollbackAttempted
                ? `rollback ${item.rollbackSucceeded ? "ok" : "failed"}`
                : "rollback armed"
            }
            tone={
              !item.rollbackAttempted
                ? "neutral"
                : item.rollbackSucceeded
                ? "ok"
                : "bad"
            }
          />
        ) : null}
      </div>

      {item.canaryEnabled ? (
        <div style={{ marginTop: 4, opacity: 0.76, fontSize: 12 }}>
          canary rollout={item.canaryRolloutPercent ?? "-"}% bucket=
          {item.canaryBucket ?? "-"} selected={item.canarySelected ? "true" : "false"} checks=
          {item.canaryChecks}
        </div>
      ) : null}

      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          text={props.busyReplay ? "Replaying..." : "Replay"}
          busy={props.busyReplay}
          onClick={props.onReplay}
        />
        {approvalPending ? (
          <ActionButton
            text={props.busyApprove ? "Approving..." : "Approve"}
            busy={props.busyApprove}
            onClick={props.onApprove}
          />
        ) : null}
        {approvalPending ? (
          <ActionButton
            text={props.busyReject ? "Rejecting..." : "Reject"}
            busy={props.busyReject}
            onClick={props.onReject}
          />
        ) : null}
      </div>
    </div>
  );
}

function toneBySeverity(severity: IncidentWorkflow["severity"]): "ok" | "warn" | "bad" {
  if (severity === "critical") return "bad";
  if (severity === "high") return "warn";
  return "ok";
}

function blockStyle(): CSSProperties {
  return {
    marginTop: 14,
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
  };
}

function h3Style(): CSSProperties {
  return { margin: 0, fontSize: 16 };
}

function workflowCardStyle(): CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.03)",
  };
}

function stepRowStyle(): CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "rgba(0,0,0,0.14)",
  };
}

function entryRowStyle(): CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "rgba(0,0,0,0.16)",
  };
}

function messageStyle(): CSSProperties {
  return {
    marginTop: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.05)",
  };
}

function preStyle(): CSSProperties {
  return {
    marginTop: 8,
    marginBottom: 0,
    whiteSpace: "pre-wrap",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(0,0,0,0.25)",
  };
}

function inputStyle(): CSSProperties {
  return {
    minWidth: 260,
    maxWidth: 420,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.2)",
    color: "inherit",
  };
}

function Pill(props: {
  text: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const tone = props.tone ?? "neutral";

  const bg =
    tone === "ok"
      ? "rgba(34,197,94,0.14)"
      : tone === "warn"
      ? "rgba(245,158,11,0.14)"
      : tone === "bad"
      ? "rgba(239,68,68,0.14)"
      : "rgba(255,255,255,0.06)";

  const border =
    tone === "ok"
      ? "rgba(34,197,94,0.35)"
      : tone === "warn"
      ? "rgba(245,158,11,0.35)"
      : tone === "bad"
      ? "rgba(239,68,68,0.35)"
      : "rgba(255,255,255,0.16)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 12,
        border: `1px solid ${border}`,
        background: bg,
      }}
    >
      {props.text}
    </span>
  );
}

function ActionButton(props: {
  text: string;
  busy?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={Boolean(props.busy)}
      onClick={props.onClick}
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.18)",
        background: props.busy ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
        color: "inherit",
        fontWeight: 700,
        cursor: props.busy ? "default" : "pointer",
      }}
    >
      {props.text}
    </button>
  );
}
