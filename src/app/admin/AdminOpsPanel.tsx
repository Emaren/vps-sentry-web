"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { IncidentWorkflow, IncidentWorkflowStep } from "@/lib/ops/workflows";

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
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resultPreview, setResultPreview] = useState<string | null>(null);
  const [notifyTarget, setNotifyTarget] = useState("");
  const [notifyKind, setNotifyKind] = useState<"" | "EMAIL" | "WEBHOOK">("");

  const workflowCount = props.workflows.length;
  const apiStepCount = useMemo(
    () => props.workflows.reduce((n, w) => n + w.steps.filter((s) => s.kind === "api").length, 0),
    [props.workflows]
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
            onClick={() => postJson("/api/ops/remediate-drain", { limit: 8 }, "quick:drain")}
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

function preview(v: unknown): string {
  try {
    const raw = JSON.stringify(v, null, 2);
    if (raw.length <= 2800) return raw;
    return `${raw.slice(0, 2800)}\n...[truncated]`;
  } catch {
    return String(v);
  }
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
