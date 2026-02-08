export type IncidentSeverity = "critical" | "high" | "medium";

export type IncidentWorkflowStep = {
  id: string;
  title: string;
  description: string;
  kind: "api" | "manual";
  action?: "status-snapshot" | "drain-queue" | "notify-test";
  defaultPayload?: Record<string, unknown>;
};

export type IncidentWorkflow = {
  id: string;
  title: string;
  severity: IncidentSeverity;
  summary: string;
  triggerSignals: string[];
  playbookRefs: string[];
  steps: IncidentWorkflowStep[];
};

export const INCIDENT_WORKFLOWS: IncidentWorkflow[] = [
  {
    id: "critical-triage",
    title: "Critical Incident Triage",
    severity: "critical",
    summary:
      "Rapidly snapshot the incident, drain queued remediations, and verify operator notifications.",
    triggerSignals: ["config_tamper", "firewall_drift", "unexpected_public_ports"],
    playbookRefs: [
      "docs/operator-playbooks.md#critical-incident-triage",
      "docs/incident-workflows.md#critical-triage",
      "docs/remediation-queue-runbook.md",
    ],
    steps: [
      {
        id: "status-snapshot",
        title: "Capture Status Snapshot",
        description: "Read the latest status summary for forensic context before making changes.",
        kind: "api",
        action: "status-snapshot",
      },
      {
        id: "drain-queue",
        title: "Drain Remediation Queue",
        description: "Process queued execute runs so urgent remediation actions are not stuck.",
        kind: "api",
        action: "drain-queue",
        defaultPayload: { limit: 8 },
      },
      {
        id: "notify-test",
        title: "Confirm Operator Notification Path",
        description: "Send a notify test so operators confirm alert delivery path is healthy.",
        kind: "api",
        action: "notify-test",
        defaultPayload: {
          title: "Critical workflow notification test",
          detail: "Critical triage workflow executed; confirming notify path.",
        },
      },
      {
        id: "manual-validate",
        title: "Manual Validation",
        description:
          "Run make release-smoke and verify /, /login, /api/status remain healthy after triage.",
        kind: "manual",
      },
    ],
  },
  {
    id: "auth-abuse-response",
    title: "Auth Abuse Response",
    severity: "high",
    summary:
      "Used when auth anomaly signals spike and operators need to preserve service while hardening access.",
    triggerSignals: ["ssh_failed_password", "ssh_invalid_user"],
    playbookRefs: [
      "docs/operator-playbooks.md#auth-abuse-response",
      "docs/security-performance-runbook.md",
    ],
    steps: [
      {
        id: "status-snapshot",
        title: "Capture Auth Signal Snapshot",
        description: "Collect current auth counters and alert summary before containment changes.",
        kind: "api",
        action: "status-snapshot",
      },
      {
        id: "notify-test",
        title: "Verify Security Notification Channel",
        description:
          "Send a security notify test to ensure high-priority auth alerts can reach operators.",
        kind: "api",
        action: "notify-test",
        defaultPayload: {
          title: "Auth abuse workflow notification test",
          detail: "Auth abuse workflow started; validating escalation channel.",
        },
      },
      {
        id: "manual-harden",
        title: "Manual SSH Hardening",
        description:
          "Run the harden-ssh-auth response playbook from host page and validate key-only SSH login.",
        kind: "manual",
      },
    ],
  },
  {
    id: "degraded-performance",
    title: "Service Degradation Workflow",
    severity: "medium",
    summary:
      "Used for latency/load regressions and focuses on safe validation before restart or rollback.",
    triggerSignals: ["api_latency", "high_error_rate", "resource_pressure"],
    playbookRefs: [
      "docs/operator-playbooks.md#service-degradation-response",
      "docs/security-performance-runbook.md",
      "docs/production-ops-runbook.md",
    ],
    steps: [
      {
        id: "status-snapshot",
        title: "Capture Degradation Snapshot",
        description: "Snapshot current service status and alert counts before mitigation.",
        kind: "api",
        action: "status-snapshot",
      },
      {
        id: "drain-queue",
        title: "Drain Queue (Low Limit)",
        description: "Process a small remediation batch to avoid stale runs during degraded service.",
        kind: "api",
        action: "drain-queue",
        defaultPayload: { limit: 3 },
      },
      {
        id: "manual-load-smoke",
        title: "Manual Load Smoke",
        description:
          "Run make perf-load-smoke and compare throughput/failure patterns before and after mitigations.",
        kind: "manual",
      },
    ],
  },
];

export function getIncidentWorkflowById(id: string): IncidentWorkflow | null {
  const normalized = id.trim().toLowerCase();
  return INCIDENT_WORKFLOWS.find((w) => w.id === normalized) ?? null;
}

export function getIncidentWorkflowStepById(
  workflow: IncidentWorkflow,
  stepId: string
): IncidentWorkflowStep | null {
  const normalized = stepId.trim().toLowerCase();
  return workflow.steps.find((s) => s.id === normalized) ?? null;
}
