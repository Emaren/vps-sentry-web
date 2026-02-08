"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AppRole } from "@/lib/rbac-policy";
import type {
  IncidentRunDetail,
  IncidentRunListSnapshot,
  IncidentSeverityValue,
  PostmortemStatusValue,
} from "@/lib/ops/incident-engine";
import type { IncidentWorkflow, IncidentWorkflowStep } from "@/lib/ops/workflows";

type IncidentAssignee = {
  id: string;
  email: string;
  name: string | null;
  role: AppRole;
};

type CurrentIdentity = {
  userId: string;
  email: string;
  role: AppRole;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  snapshot?: IncidentRunListSnapshot;
  incident?: IncidentRunDetail;
  summary?: {
    escalated: number;
    evaluated: number;
  };
  [k: string]: unknown;
};

function preview(v: unknown): string {
  try {
    const raw = JSON.stringify(v, null, 2);
    if (raw.length <= 2800) return raw;
    return `${raw.slice(0, 2800)}\n...[truncated]`;
  } catch {
    return String(v);
  }
}

function fmtTs(v: string | null | undefined): string {
  if (!v) return "-";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return v;
  return d.toLocaleString();
}

function workflowById(
  workflows: IncidentWorkflow[],
  workflowId: string | null | undefined
): IncidentWorkflow | null {
  if (!workflowId) return null;
  return workflows.find((w) => w.id === workflowId) ?? null;
}

function toActionItemLines(detail: IncidentRunDetail | null): string {
  if (!detail) return "";
  return detail.postmortemActionItems.map((item) => item.title).join("\n");
}

function toneBySeverity(severity: IncidentSeverityValue): "ok" | "warn" | "bad" {
  if (severity === "critical") return "bad";
  if (severity === "high") return "warn";
  return "ok";
}

function toneByState(
  state: IncidentRunDetail["state"] | IncidentRunListSnapshot["incidents"][number]["state"]
): "ok" | "warn" | "bad" | "neutral" {
  if (state === "open") return "bad";
  if (state === "acknowledged") return "warn";
  if (state === "resolved") return "ok";
  return "neutral";
}

export default function IncidentEnginePanel(props: {
  workflows: IncidentWorkflow[];
  initialSnapshot: IncidentRunListSnapshot;
  initialIncidentDetail: IncidentRunDetail | null;
  incidentAssignees: IncidentAssignee[];
  currentIdentity: CurrentIdentity;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultPreview, setResultPreview] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<IncidentRunListSnapshot>(
    props.initialSnapshot
  );
  const [detail, setDetail] = useState<IncidentRunDetail | null>(
    props.initialIncidentDetail
  );
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    props.initialIncidentDetail?.id ??
      props.initialSnapshot.incidents[0]?.id ??
      null
  );

  const [createWorkflowId, setCreateWorkflowId] = useState<string>(
    props.workflows[0]?.id ?? "critical-triage"
  );
  const [createTitle, setCreateTitle] = useState("");
  const [createSummary, setCreateSummary] = useState("");
  const [createSeverity, setCreateSeverity] = useState<"" | IncidentSeverityValue>(
    ""
  );
  const [createHostId, setCreateHostId] = useState("");
  const [createTriggerSignal, setCreateTriggerSignal] = useState("");
  const [createAssigneeEmail, setCreateAssigneeEmail] = useState("");
  const [createInitialNote, setCreateInitialNote] = useState("");

  const [assignEmail, setAssignEmail] = useState("");
  const [note, setNote] = useState("");

  const [postmortemStatus, setPostmortemStatus] =
    useState<PostmortemStatusValue>("not_started");
  const [postmortemSummary, setPostmortemSummary] = useState("");
  const [postmortemImpact, setPostmortemImpact] = useState("");
  const [postmortemRootCause, setPostmortemRootCause] = useState("");
  const [postmortemActionItems, setPostmortemActionItems] = useState("");

  const selectedWorkflow = useMemo(
    () => workflowById(props.workflows, detail?.workflowId ?? null),
    [props.workflows, detail?.workflowId]
  );

  useEffect(() => {
    if (!detail) return;
    setPostmortemStatus(detail.postmortemStatus);
    setPostmortemSummary(detail.postmortemSummary ?? "");
    setPostmortemImpact(detail.postmortemImpact ?? "");
    setPostmortemRootCause(detail.postmortemRootCause ?? "");
    setPostmortemActionItems(toActionItemLines(detail));
    setAssignEmail(detail.assigneeEmail ?? "");
  }, [detail]);

  async function loadIncidentDetail(incidentId: string) {
    setBusyKey(`detail:${incidentId}`);
    try {
      const res = await fetch(
        `/api/ops/incidents/${encodeURIComponent(incidentId)}?timelineLimit=160`,
        { method: "GET" }
      );
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok || !data.incident) {
        setMessage(`incident detail failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }
      setDetail(data.incident);
      setSelectedIncidentId(data.incident.id);
      setMessage(`Loaded incident ${data.incident.id}.`);
      setResultPreview(preview(data));
    } catch (err: unknown) {
      setMessage(`incident detail failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function refreshSnapshot(preferIncidentId?: string | null) {
    const key = "incident:refresh";
    setBusyKey(key);
    try {
      const res = await fetch("/api/ops/incidents?limit=30&state=active", {
        method: "GET",
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok || !data.snapshot) {
        setMessage(`incident refresh failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }
      const nextSnapshot = data.snapshot as IncidentRunListSnapshot;
      setSnapshot(nextSnapshot);

      const nextId =
        preferIncidentId ??
        selectedIncidentId ??
        nextSnapshot.incidents[0]?.id ??
        null;
      if (nextId) {
        const stillExists = nextSnapshot.incidents.some((i) => i.id === nextId);
        if (stillExists) {
          await loadIncidentDetail(nextId);
        } else if (nextSnapshot.incidents[0]?.id) {
          await loadIncidentDetail(nextSnapshot.incidents[0].id);
        } else {
          setDetail(null);
          setSelectedIncidentId(null);
        }
      }
      setMessage("Incident snapshot refreshed.");
      setResultPreview(preview(data));
    } catch (err: unknown) {
      setMessage(`incident refresh failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function createIncident() {
    const key = "incident:create";
    setBusyKey(key);
    setMessage(null);
    setResultPreview(null);

    try {
      const body: Record<string, unknown> = {
        action: "create",
        workflowId: createWorkflowId,
      };
      if (createTitle.trim()) body.title = createTitle.trim();
      if (createSummary.trim()) body.summary = createSummary.trim();
      if (createSeverity) body.severity = createSeverity;
      if (createHostId.trim()) body.hostId = createHostId.trim();
      if (createTriggerSignal.trim()) body.triggerSignal = createTriggerSignal.trim();
      if (createAssigneeEmail.trim()) body.assigneeEmail = createAssigneeEmail.trim();
      if (createInitialNote.trim()) body.initialNote = createInitialNote.trim();

      const res = await fetch("/api/ops/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok || !data.incident) {
        setMessage(`incident create failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }

      setDetail(data.incident);
      setSelectedIncidentId(data.incident.id);
      setMessage(`Incident ${data.incident.id} created.`);
      setResultPreview(preview(data));

      setCreateTitle("");
      setCreateSummary("");
      setCreateHostId("");
      setCreateTriggerSignal("");
      setCreateAssigneeEmail("");
      setCreateInitialNote("");
      await refreshSnapshot(data.incident.id);
    } catch (err: unknown) {
      setMessage(`incident create failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function runEscalationSweep() {
    const key = "incident:escalate-sweep";
    setBusyKey(key);
    setMessage(null);
    setResultPreview(null);
    try {
      const res = await fetch("/api/ops/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "escalation-sweep", limit: 40 }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok) {
        setMessage(`escalation sweep failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        return;
      }

      const escalated = data.summary?.escalated ?? 0;
      setMessage(`Escalation sweep completed (escalated=${escalated}).`);
      setResultPreview(preview(data));
      await refreshSnapshot(selectedIncidentId);
    } catch (err: unknown) {
      setMessage(`escalation sweep failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function incidentAction(
    action: string,
    body: Record<string, unknown> = {},
    keySuffix?: string
  ) {
    if (!selectedIncidentId) {
      setMessage("Select an incident first.");
      return;
    }
    const key = `incident:${action}${keySuffix ? `:${keySuffix}` : ""}`;
    setBusyKey(key);
    setMessage(null);
    setResultPreview(null);

    try {
      const res = await fetch(
        `/api/ops/incidents/${encodeURIComponent(selectedIncidentId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...body }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.ok) {
        setMessage(`${action} failed: ${data.error ?? `HTTP ${res.status}`}`);
        setResultPreview(preview(data));
        if (data.incident) {
          setDetail(data.incident);
        }
        return;
      }

      if (data.incident) {
        setDetail(data.incident);
        setSelectedIncidentId(data.incident.id);
      }
      setMessage(`${action} completed.`);
      setResultPreview(preview(data));
      await refreshSnapshot(data.incident?.id ?? selectedIncidentId);
    } catch (err: unknown) {
      setMessage(`${action} failed: ${String(err)}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function runWorkflowStep(step: IncidentWorkflowStep) {
    if (step.kind !== "api" || !step.action) {
      setMessage(`Step ${step.id} is manual-only.`);
      return;
    }
    await incidentAction("step", {
      stepId: step.id,
      payload: { ...(step.defaultPayload ?? {}) },
    }, step.id);
  }

  return (
    <section style={blockStyle()}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Incident Workflow Engine v2</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill text={`open ${snapshot.counts.open}`} tone="bad" />
          <Pill text={`ack ${snapshot.counts.acknowledged}`} tone="warn" />
          <Pill text={`resolved ${snapshot.counts.resolved}`} tone="ok" />
          <Pill text={`ack overdue ${snapshot.counts.ackOverdue}`} tone={snapshot.counts.ackOverdue > 0 ? "bad" : "ok"} />
          <Pill text={`escalation due ${snapshot.counts.escalationDue}`} tone={snapshot.counts.escalationDue > 0 ? "warn" : "ok"} />
          <ActionButton
            text="Refresh Incidents"
            busy={busyKey === "incident:refresh"}
            onClick={() => refreshSnapshot(selectedIncidentId)}
          />
          <ActionButton
            text="Run Escalation Sweep"
            busy={busyKey === "incident:escalate-sweep"}
            onClick={runEscalationSweep}
          />
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        <div style={{ fontSize: 13, opacity: 0.82 }}>
          Assignment, acknowledgement, escalation timers, incident timeline, and postmortem scaffolding.
        </div>
      </div>

      <section style={nestedBlockStyle()}>
        <div style={{ fontWeight: 700 }}>Create Incident</div>
        <div style={grid2Style()}>
          <label style={fieldStyle()}>
            <span style={labelStyle()}>Workflow</span>
            <select
              value={createWorkflowId}
              onChange={(e) => setCreateWorkflowId(e.currentTarget.value)}
              style={inputStyle()}
            >
              {props.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.title} ({workflow.severity})
                </option>
              ))}
            </select>
          </label>
          <label style={fieldStyle()}>
            <span style={labelStyle()}>Severity override (optional)</span>
            <select
              value={createSeverity}
              onChange={(e) => setCreateSeverity(e.currentTarget.value as "" | IncidentSeverityValue)}
              style={inputStyle()}
            >
              <option value="">workflow default</option>
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
            </select>
          </label>
          <label style={fieldStyle()}>
            <span style={labelStyle()}>Title override</span>
            <input
              value={createTitle}
              onChange={(e) => setCreateTitle(e.currentTarget.value)}
              placeholder="optional title"
              style={inputStyle()}
            />
          </label>
          <label style={fieldStyle()}>
            <span style={labelStyle()}>Host ID (optional)</span>
            <input
              value={createHostId}
              onChange={(e) => setCreateHostId(e.currentTarget.value)}
              placeholder="cmk..."
              style={inputStyle()}
            />
          </label>
          <label style={fieldStyle()}>
            <span style={labelStyle()}>Trigger signal (optional)</span>
            <input
              value={createTriggerSignal}
              onChange={(e) => setCreateTriggerSignal(e.currentTarget.value)}
              placeholder="config_tamper"
              style={inputStyle()}
            />
          </label>
          <label style={fieldStyle()}>
            <span style={labelStyle()}>Assignee email (optional)</span>
            <input
              value={createAssigneeEmail}
              onChange={(e) => setCreateAssigneeEmail(e.currentTarget.value)}
              placeholder="ops@example.com"
              style={inputStyle()}
            />
          </label>
        </div>
        <label style={{ ...fieldStyle(), marginTop: 8 }}>
          <span style={labelStyle()}>Summary / context</span>
          <textarea
            value={createSummary}
            onChange={(e) => setCreateSummary(e.currentTarget.value)}
            rows={2}
            style={textAreaStyle()}
            placeholder="optional summary"
          />
        </label>
        <label style={{ ...fieldStyle(), marginTop: 8 }}>
          <span style={labelStyle()}>Initial note</span>
          <textarea
            value={createInitialNote}
            onChange={(e) => setCreateInitialNote(e.currentTarget.value)}
            rows={2}
            style={textAreaStyle()}
            placeholder="optional timeline note"
          />
        </label>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ActionButton
            text="Create Incident"
            busy={busyKey === "incident:create"}
            onClick={createIncident}
          />
        </div>
      </section>

      <section style={nestedBlockStyle()}>
        <div style={{ fontWeight: 700 }}>Active Incidents</div>
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {snapshot.incidents.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No active incidents.</div>
          ) : (
            snapshot.incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => loadIncidentDetail(incident.id)}
                style={{
                  ...incidentRowStyle(),
                  borderColor:
                    selectedIncidentId === incident.id
                      ? "rgba(255,255,255,0.30)"
                      : "rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700 }}>{incident.title}</div>
                    <div style={{ marginTop: 2, fontSize: 12, opacity: 0.78 }}>
                      {incident.id} · workflow {incident.workflowId}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Pill text={incident.severity} tone={toneBySeverity(incident.severity)} />
                    <Pill text={incident.state} tone={toneByState(incident.state)} />
                    <Pill text={`escalations ${incident.escalationCount}`} tone={incident.escalationCount > 0 ? "warn" : "neutral"} />
                    {incident.ackOverdue ? <Pill text="ack overdue" tone="bad" /> : null}
                  </div>
                </div>
                <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, opacity: 0.8 }}>
                  <span>host: {incident.host?.name ?? "-"}</span>
                  <span>assignee: {incident.assigneeEmail ?? "-"}</span>
                  <span>ack due: {fmtTs(incident.ackDueAt)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {detail ? (
        <section style={nestedBlockStyle()}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{detail.title}</div>
              <div style={{ marginTop: 4, opacity: 0.82 }}>
                {detail.id} · {detail.workflowId} · {detail.host?.name ?? "no host"} · created {fmtTs(detail.createdAt)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Pill text={detail.severity} tone={toneBySeverity(detail.severity)} />
              <Pill text={detail.state} tone={toneByState(detail.state)} />
              <Pill text={`postmortem ${detail.postmortemStatus}`} tone="neutral" />
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={assignEmail}
              onChange={(e) => setAssignEmail(e.currentTarget.value)}
              placeholder="assign email"
              style={inputStyle()}
            />
            <select
              value=""
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value) setAssignEmail(value);
              }}
              style={inputStyle()}
            >
              <option value="">assign from roster...</option>
              {props.incidentAssignees.map((assignee) => (
                <option key={assignee.id} value={assignee.email}>
                  {assignee.email} ({assignee.role})
                </option>
              ))}
            </select>
            <ActionButton
              text="Assign Email"
              busy={busyKey === "incident:assign"}
              onClick={() =>
                incidentAction("assign", { assigneeEmail: assignEmail.trim() }, "assign")
              }
            />
            <ActionButton
              text="Assign to Me"
              busy={busyKey === "incident:assign:self"}
              onClick={() =>
                incidentAction(
                  "assign",
                  { assigneeUserId: props.currentIdentity.userId },
                  "self"
                )
              }
            />
            <ActionButton
              text="Acknowledge"
              busy={busyKey === "incident:acknowledge"}
              onClick={() => incidentAction("acknowledge")}
            />
            <ActionButton
              text="Resolve"
              busy={busyKey === "incident:resolve"}
              onClick={() => incidentAction("resolve")}
            />
            <ActionButton
              text="Close"
              busy={busyKey === "incident:close"}
              onClick={() => incidentAction("close")}
            />
            <ActionButton
              text="Reopen"
              busy={busyKey === "incident:reopen"}
              onClick={() => incidentAction("reopen")}
            />
          </div>

          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              placeholder="timeline note"
              style={inputStyle()}
            />
            <ActionButton
              text="Add Note"
              busy={busyKey === "incident:note"}
              onClick={() => {
                incidentAction("note", { message: note }, "note");
                setNote("");
              }}
            />
          </div>

          {selectedWorkflow ? (
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Workflow Steps ({selectedWorkflow.title})</div>
              {selectedWorkflow.steps.map((step) => (
                <div key={step.id} style={stepRowStyle()}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{step.title}</div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>{step.description}</div>
                  </div>
                  {step.kind === "api" ? (
                    <ActionButton
                      text={busyKey === `incident:step:${step.id}` ? "Running..." : "Run Step"}
                      busy={busyKey === `incident:step:${step.id}`}
                      onClick={() => runWorkflowStep(step)}
                    />
                  ) : (
                    <Pill text="manual" tone="neutral" />
                  )}
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Postmortem Scaffold</div>
            <div style={grid2Style()}>
              <label style={fieldStyle()}>
                <span style={labelStyle()}>Status</span>
                <select
                  value={postmortemStatus}
                  onChange={(e) =>
                    setPostmortemStatus(e.currentTarget.value as PostmortemStatusValue)
                  }
                  style={inputStyle()}
                >
                  <option value="not_started">not_started</option>
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="waived">waived</option>
                </select>
              </label>
              <label style={fieldStyle()}>
                <span style={labelStyle()}>Action items (one per line)</span>
                <textarea
                  rows={3}
                  value={postmortemActionItems}
                  onChange={(e) => setPostmortemActionItems(e.currentTarget.value)}
                  style={textAreaStyle()}
                />
              </label>
            </div>
            <label style={fieldStyle()}>
              <span style={labelStyle()}>Summary</span>
              <textarea
                rows={2}
                value={postmortemSummary}
                onChange={(e) => setPostmortemSummary(e.currentTarget.value)}
                style={textAreaStyle()}
              />
            </label>
            <label style={fieldStyle()}>
              <span style={labelStyle()}>Impact</span>
              <textarea
                rows={2}
                value={postmortemImpact}
                onChange={(e) => setPostmortemImpact(e.currentTarget.value)}
                style={textAreaStyle()}
              />
            </label>
            <label style={fieldStyle()}>
              <span style={labelStyle()}>Root cause</span>
              <textarea
                rows={2}
                value={postmortemRootCause}
                onChange={(e) => setPostmortemRootCause(e.currentTarget.value)}
                style={textAreaStyle()}
              />
            </label>
            <ActionButton
              text="Save Postmortem"
              busy={busyKey === "incident:postmortem"}
              onClick={() =>
                incidentAction(
                  "postmortem",
                  {
                    status: postmortemStatus,
                    summary: postmortemSummary,
                    impact: postmortemImpact,
                    rootCause: postmortemRootCause,
                    actionItems: postmortemActionItems,
                  },
                  "postmortem"
                )
              }
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>
              Timeline ({detail.timeline.length})
            </div>
            {detail.timeline.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No timeline events yet.</div>
            ) : (
              detail.timeline.map((event) => (
                <div key={event.id} style={timelineRowStyle()}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <Pill text={event.type} tone="neutral" />
                      {event.stepId ? <Pill text={event.stepId} tone="warn" /> : null}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{fmtTs(event.eventTs)}</div>
                  </div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>{event.message}</div>
                  <div style={{ marginTop: 2, fontSize: 12, opacity: 0.75 }}>
                    actor: {event.actor?.email ?? event.actor?.id ?? "system"}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {message ? <div style={messageStyle()}>{message}</div> : null}
      {resultPreview ? (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Incident action result</summary>
          <pre style={preStyle()}>{resultPreview}</pre>
        </details>
      ) : null}
    </section>
  );
}

function blockStyle(): CSSProperties {
  return {
    marginTop: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
  };
}

function nestedBlockStyle(): CSSProperties {
  return {
    marginTop: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(0,0,0,0.14)",
  };
}

function grid2Style(): CSSProperties {
  return {
    marginTop: 8,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 8,
  };
}

function fieldStyle(): CSSProperties {
  return {
    display: "grid",
    gap: 4,
  };
}

function labelStyle(): CSSProperties {
  return {
    fontSize: 12,
    opacity: 0.78,
  };
}

function incidentRowStyle(): CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "rgba(0,0,0,0.18)",
    color: "inherit",
    cursor: "pointer",
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
    background: "rgba(0,0,0,0.16)",
  };
}

function timelineRowStyle(): CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 10px",
    background: "rgba(0,0,0,0.18)",
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
    minWidth: 220,
    maxWidth: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.2)",
    color: "inherit",
  };
}

function textAreaStyle(): CSSProperties {
  return {
    width: "100%",
    minHeight: 62,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.2)",
    color: "inherit",
    resize: "vertical",
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
