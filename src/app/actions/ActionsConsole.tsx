"use client";

import React from "react";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";
import { boxStyle, subtleText, tinyText } from "@/app/dashboard/_styles";

type Ability = {
  id: string;
  title: string;
  summary: string;
  method: "GET" | "POST";
  path: string;
  requiredRole: AppRole;
  body?: Record<string, unknown>;
};

type AbilityResult = {
  ranAt: string;
  ok: boolean;
  status: number;
  bodyPreview: string;
};

const abilities: Ability[] = [
  {
    id: "send-test-email",
    title: "Send test email",
    summary: "Validates SMTP wiring by sending a test message to your signed-in account.",
    method: "POST",
    path: "/api/ops/test-email",
    requiredRole: "ops",
  },
  {
    id: "send-report-now",
    title: "Send report now",
    summary: "Triggers immediate report generation and delivery.",
    method: "POST",
    path: "/api/ops/report-now",
    requiredRole: "ops",
  },
  {
    id: "queue-drain",
    title: "Drain remediation queue",
    summary: "Processes pending remediation jobs right now (safe capped drain).",
    method: "POST",
    path: "/api/ops/remediate-drain",
    requiredRole: "ops",
    body: { limit: 25 },
  },
  {
    id: "replay-dlq-batch",
    title: "Replay DLQ batch",
    summary: "Retries a small batch of dead-letter remediation runs.",
    method: "POST",
    path: "/api/ops/remediate-replay",
    requiredRole: "ops",
    body: { mode: "dlq-batch", limit: 3 },
  },
  {
    id: "view-remediation-queue",
    title: "View remediation queue",
    summary: "Shows queued/processing/done/failed/DLQ counts.",
    method: "GET",
    path: "/api/ops/remediate-queue?limit=25",
    requiredRole: "ops",
  },
  {
    id: "list-incidents",
    title: "List incidents",
    summary: "Returns current incidents for incident workflow tracking.",
    method: "GET",
    path: "/api/ops/incidents?limit=20",
    requiredRole: "ops",
  },
  {
    id: "list-workflows",
    title: "List incident workflows",
    summary: "Shows available workflow playbooks and API-executable steps.",
    method: "GET",
    path: "/api/ops/incident-workflow",
    requiredRole: "ops",
  },
  {
    id: "slo-snapshot",
    title: "SLO burn snapshot",
    summary: "Calculates burn-rate posture and summarizes objective risk.",
    method: "GET",
    path: "/api/ops/slo",
    requiredRole: "ops",
  },
  {
    id: "metrics-snapshot",
    title: "Prometheus metrics",
    summary: "Returns runtime metrics in Prometheus text format.",
    method: "GET",
    path: "/api/ops/metrics",
    requiredRole: "ops",
  },
  {
    id: "fleet-policy-summary",
    title: "Fleet policy summary",
    summary: "Shows current fleet policy/tags/groups and policy scope metadata.",
    method: "GET",
    path: "/api/ops/fleet-policy",
    requiredRole: "admin",
  },
  {
    id: "observability-snapshot",
    title: "Observability snapshot",
    summary: "Returns counters, timings, traces, logs, and alert event streams.",
    method: "GET",
    path: "/api/ops/observability",
    requiredRole: "admin",
  },
];

const buttonStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
  color: "inherit",
  fontWeight: 800,
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.55,
  cursor: "not-allowed",
};

async function parseResponseBody(res: Response): Promise<string> {
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    if (!data) return "(empty JSON body)";
    return JSON.stringify(data, null, 2);
  }
  return (await res.text().catch(() => "")) || "(empty body)";
}

function previewBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= 2400) return trimmed || "(empty)";
  return `${trimmed.slice(0, 2400)}\n... [truncated]`;
}

export default function ActionsConsole(props: { userRole: AppRole; signedInAs: string }) {
  const { userRole, signedInAs } = props;
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, AbilityResult>>({});

  async function runAbility(ability: Ability) {
    if (!hasRequiredRole(userRole, ability.requiredRole)) return;

    setBusyId(ability.id);
    try {
      const res = await fetch(ability.path, {
        method: ability.method,
        headers:
          ability.method === "POST"
            ? {
                "content-type": "application/json",
              }
            : undefined,
        body: ability.method === "POST" ? JSON.stringify(ability.body ?? {}) : undefined,
      });
      const rawBody = await parseResponseBody(res);
      setResults((prev) => ({
        ...prev,
        [ability.id]: {
          ranAt: new Date().toLocaleString(),
          ok: res.ok,
          status: res.status,
          bodyPreview: previewBody(rawBody),
        },
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setResults((prev) => ({
        ...prev,
        [ability.id]: {
          ranAt: new Date().toLocaleString(),
          ok: false,
          status: 0,
          bodyPreview: message || "Unknown client error",
        },
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section style={{ marginTop: 10 }}>
      <div style={{ ...boxStyle, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Action Deck</div>
        <div style={subtleText}>
          Signed in as <strong>{signedInAs}</strong>. Each action runs a guarded VPS Sentry API ability; this page
          does not execute arbitrary shell commands.
        </div>
      </div>

      <div
        style={{
          ...boxStyle,
          padding: 0,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))" }}>
              <th style={{ textAlign: "left", padding: 12 }}>Ability</th>
              <th style={{ textAlign: "left", padding: 12 }}>Command</th>
              <th style={{ textAlign: "left", padding: 12 }}>Role</th>
              <th style={{ textAlign: "left", padding: 12 }}>Run</th>
            </tr>
          </thead>
          <tbody>
            {abilities.map((ability) => {
              const allowed = hasRequiredRole(userRole, ability.requiredRole);
              const isBusy = busyId === ability.id;
              const result = results[ability.id];
              return (
                <tr
                  key={ability.id}
                  style={{
                    borderTop: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
                    verticalAlign: "top",
                  }}
                >
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 800 }}>{ability.title}</div>
                    <div style={{ ...tinyText, marginTop: 5 }}>{ability.summary}</div>
                    {result ? (
                      <div style={{ marginTop: 10 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: result.ok ? "var(--site-sev-ok-text)" : "var(--site-sev-critical-text)",
                          }}
                        >
                          {result.ok ? "Last run OK" : "Last run failed"} ({result.status}) at {result.ranAt}
                        </div>
                        <pre
                          style={{
                            marginTop: 6,
                            marginBottom: 0,
                            fontSize: 12,
                            maxHeight: 180,
                            overflow: "auto",
                            background: "var(--site-input-bg, rgba(255,255,255,0.03))",
                            border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
                            borderRadius: 8,
                            padding: 8,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {result.bodyPreview}
                        </pre>
                      </div>
                    ) : null}
                  </td>
                  <td style={{ padding: 12 }}>
                    <code>{ability.method}</code>
                    <div style={{ marginTop: 4 }}>
                      <code>{ability.path}</code>
                    </div>
                    {ability.body ? (
                      <pre
                        style={{
                          marginTop: 8,
                          marginBottom: 0,
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {JSON.stringify(ability.body)}
                      </pre>
                    ) : null}
                  </td>
                  <td style={{ padding: 12 }}>
                    <code>{ability.requiredRole}</code>
                  </td>
                  <td style={{ padding: 12 }}>
                    <button
                      type="button"
                      onClick={() => void runAbility(ability)}
                      disabled={!allowed || busyId !== null}
                      style={!allowed || busyId !== null ? disabledButtonStyle : buttonStyle}
                    >
                      {isBusy ? "Running..." : "Run"}
                    </button>
                    {!allowed ? (
                      <div style={{ ...tinyText, marginTop: 6 }}>Needs {ability.requiredRole} role.</div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
