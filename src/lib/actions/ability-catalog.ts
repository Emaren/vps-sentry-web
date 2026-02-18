import type { AppRole } from "@/lib/rbac-policy";
import { SCRIPT_ACTIONS } from "./script-catalog";

export type DeckAbility = {
  id: string;
  title: string;
  summary: string;
  method: "GET" | "POST";
  path: string;
  requiredRole: AppRole;
  body?: Record<string, unknown>;
};

const API_ABILITIES: DeckAbility[] = [
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

const SCRIPT_ABILITIES: DeckAbility[] = SCRIPT_ACTIONS.map((entry) => ({
  id: `script-${entry.script}`,
  title: entry.title,
  summary: entry.summary,
  method: "POST",
  path: "/api/ops/actions/run-script",
  requiredRole: entry.requiredRole,
  body: { script: entry.script },
}));

export const ACTION_DECK: DeckAbility[] = [...API_ABILITIES, ...SCRIPT_ABILITIES];

export const ACTION_DECK_BY_ID = new Map(ACTION_DECK.map((ability) => [ability.id, ability] as const));
