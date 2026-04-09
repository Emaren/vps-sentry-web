// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/logic.ts
import type { ActionSummary } from "../../_lib/explain";
import type { FixStep, FixStepStatus } from "./types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

type ExplainAlertPreview = {
  title: string;
  detail?: string;
  code?: string;
  severity?: "info" | "warn" | "critical";
};

function normalizeAlertSignal(alert: Pick<ExplainAlertPreview, "title" | "detail" | "code">): string {
  return `${alert.code ?? ""} ${alert.title ?? ""} ${alert.detail ?? ""}`.toLowerCase();
}

function isBaselineDriftSignal(alert: Pick<ExplainAlertPreview, "title" | "detail" | "code">): boolean {
  const signal = normalizeAlertSignal(alert);
  return (
    signal.includes("watched_files_changed") ||
    signal.includes("watched files changed") ||
    signal.includes("packages_changed") ||
    signal.includes("packages changed") ||
    signal.includes("user_list_changed") ||
    signal.includes("user list changed") ||
    signal.includes("cron_changed") ||
    signal.includes("cron changed") ||
    signal.includes("firewall_changed") ||
    signal.includes("firewall changed") ||
    signal.includes("ports_changed") ||
    signal.includes("ports changed") ||
    signal.includes("public_ports_changed") ||
    signal.includes("public ports changed")
  );
}

function hasBaselineDriftSignal(alertsPreview?: ExplainAlertPreview[]): boolean {
  if (!alertsPreview || alertsPreview.length === 0) return false;
  return alertsPreview.some((alert) => isBaselineDriftSignal(alert));
}

function hasRuntimeContainmentSignal(alertsPreview?: ExplainAlertPreview[]): boolean {
  if (!alertsPreview || alertsPreview.length === 0) return false;
  return alertsPreview.some((alert) => {
    const signal = normalizeAlertSignal(alert);
    return (
      signal.includes("suspicious_process_ioc") ||
      signal.includes("suspicious process ioc") ||
      signal.includes("outbound_scan_ioc") ||
      signal.includes("outbound scan ioc") ||
      signal.includes("cpu_hotspot") ||
      signal.includes("cpu hotspot")
    );
  });
}

function isDiskPressureSignal(alert: Pick<ExplainAlertPreview, "title" | "detail" | "code">): boolean {
  const signal = normalizeAlertSignal(alert);
  return (
    signal.includes("host_disk_critical") ||
    signal.includes("host disk critical") ||
    signal.includes("host disk pressure") ||
    signal.includes("disk pressure")
  );
}

function hasDiskPressureSignal(alertsPreview?: ExplainAlertPreview[]): boolean {
  if (!alertsPreview || alertsPreview.length === 0) return false;
  return alertsPreview.some((alert) => isDiskPressureSignal(alert));
}

function hasResidualManualAlertSignal(alertsPreview?: ExplainAlertPreview[]): boolean {
  if (!alertsPreview || alertsPreview.length === 0) return false;
  return alertsPreview.some(
    (alert) =>
      !isBaselineDriftSignal(alert) &&
      !isDiskPressureSignal(alert) &&
      !hasRuntimeContainmentSignal([alert])
  );
}

function compactAlertDetail(detail?: string): string {
  if (!detail) return "";
  const collapsed = detail.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= 180) return collapsed;
  return `${collapsed.slice(0, 177)}...`;
}

function explainAlertMeaning(alert: ExplainAlertPreview): string {
  const signal = normalizeAlertSignal(alert);
  if (signal.includes("watched_files_changed") || signal.includes("watched files changed")) {
    return "Protected system files changed since your accepted baseline. This can be expected maintenance, but verify it was intentional.";
  }
  if (signal.includes("packages_changed") || signal.includes("packages changed")) {
    return "Installed package versions changed. Usually normal updates, but confirm they were planned and from trusted sources.";
  }
  if (signal.includes("user_list_changed") || signal.includes("user list changed")) {
    return "The local user account list changed. Confirm new users or privilege changes are authorized.";
  }
  if (signal.includes("firewall_changed") || signal.includes("firewall changed")) {
    return "Firewall rules changed. Confirm internet exposure still matches your intended policy.";
  }
  if (signal.includes("ports_changed") || signal.includes("public ports changed")) {
    return "Listening ports changed from baseline. Check whether newly exposed services are expected.";
  }
  if (signal.includes("cpu_hotspot") || signal.includes("cpu hotspot")) {
    return "A single process is saturating CPU. Availability can stay up, but response times and stability can degrade until the hotspot is addressed.";
  }
  if (signal.includes("host_disk_critical") || signal.includes("host disk pressure")) {
    return "The root filesystem is above its fail threshold. The host stays out of green until enough space is reclaimed and a fresh snapshot confirms the new headroom.";
  }
  if (signal.includes("suspicious_process_ioc") || signal.includes("suspicious process ioc")) {
    return "A process matched runtime IOC heuristics (command/path/network behavior). Treat this as potentially hostile until confirmed safe.";
  }
  if (signal.includes("outbound_scan_ioc") || signal.includes("outbound scan ioc")) {
    return "A process showed outbound fanout behavior that can indicate scanning or abuse. Validate process ownership and intended behavior.";
  }
  if (signal.includes("ssh_failed_password")) {
    return "SSH password failures were detected. This is often scanner noise, but repeated spikes can indicate brute-force attempts.";
  }
  if (signal.includes("ssh_invalid_user")) {
    return "SSH login attempts used invalid usernames. This is common internet probing, but still worth monitoring.";
  }
  return "The agent detected a change that should be reviewed to confirm it is expected.";
}

export function buildActionsNeeded(input: {
  alertsCount: number;
  publicPortsCount: number; // actionable (unexpected)
  stale: boolean;
  allowlistedTotal: number | null;
  expectedPublicPorts?: string[] | null;
  alertsPreview?: ExplainAlertPreview[];
  queueQueuedCount?: number;
  queueDlqCount?: number;
}): string[] {
  const out: string[] = [];
  const queueQueued = Math.max(0, Math.trunc(input.queueQueuedCount ?? 0));
  const queueDlq = Math.max(0, Math.trunc(input.queueDlqCount ?? 0));
  const runtimeContainmentNeeded = hasRuntimeContainmentSignal(input.alertsPreview);
  const diskPressureNeeded = hasDiskPressureSignal(input.alertsPreview);
  const baselineDriftNeeded = hasBaselineDriftSignal(input.alertsPreview);

  if (input.alertsCount > 0) {
    out.push(`Review ${input.alertsCount} alert${input.alertsCount === 1 ? "" : "s"} below.`);
  }

  if (input.publicPortsCount > 0) {
    out.push(
      `Unexpected public listening ports detected (${input.publicPortsCount}). Confirm they’re expected; if not, close/firewall them.`
    );
  } else if (input.allowlistedTotal !== null) {
    const allowTxt =
      input.expectedPublicPorts && input.expectedPublicPorts.length
        ? ` (${input.expectedPublicPorts.join(", ")})`
        : "";
    out.push(`Public ports are present but allowlisted (${input.allowlistedTotal} total${allowTxt}).`);
  }

  if (input.stale) {
    out.push("Status is stale (last scan is 15m+ old). Check the agent/timer/service and logs.");
  }

  if (diskPressureNeeded) {
    out.push(
      "Disk pressure: run safe reclaim now, then wait for a fresh snapshot. The host stays red until root usage drops back under the fail line."
    );
  }

  if (baselineDriftNeeded) {
    out.push(
      "Baseline drift: if the file, firewall, or package changes were intentional, accept the new baseline so they stop counting as active alerts."
    );
  }

  if (queueQueued > 0 || queueDlq > 0) {
    out.push(
      `Queue follow-up: ${queueQueued} queued, ${queueDlq} in DLQ. Clear remediation backlog so auto-healing stays reliable.`
    );
  }

  if (runtimeContainmentNeeded) {
    out.push(
      "Runtime threat follow-up: run Counterstrike first, then confirm the next snapshot comes back clean. The host stays red until that threat signal clears."
    );
  }

  if (out.length === 0) out.push("No immediate action detected.");

  return out;
}

export function buildExplainText(input: {
  summary: ActionSummary;
  alertsCount: number;
  publicPortsCount: number; // actionable (unexpected)
  stale: boolean;
  actionsNeeded: string[];
  allowlistedTotal: number | null;
  expectedPublicPorts?: string[] | null;
  alertsPreview?: ExplainAlertPreview[];
}): string {
  const lines: string[] = [];

  // Try to pull something structured if it exists (best-effort).
  const summaryObj = asRecord(input.summary) ?? {};
  const reasonsRaw = asArray(summaryObj.reasons) ?? [];
  const reasonLines = reasonsRaw
    .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    .map((r) => r.trim());

  type ExplainItem = { severity: string; title: string; summary?: string };
  const itemsRaw = asArray(summaryObj.items) ?? [];
  const itemLines: ExplainItem[] = [];
  for (const entry of itemsRaw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    if (!title) continue;
    itemLines.push({
      severity: typeof rec.severity === "string" ? rec.severity.trim() : "INFO",
      title,
      summary: typeof rec.summary === "string" ? rec.summary.trim() : undefined,
    });
  }

  lines.push(
    `Status: ${input.summary.headline}. ${
      input.summary.needsAction
        ? "A few things need attention, but this still looks recoverable."
        : "No urgent action is required."
    }`
  );
  lines.push("");

  if (input.alertsCount > 0) {
    lines.push(
      `• Alerts: ${input.alertsCount}. VPSSentry saw changes that deserve a human check.`
    );
  } else {
    lines.push("• Alerts: 0. Nothing risky was flagged in this snapshot.");
  }

  // Ports: actionable first, then optional raw context
  if (input.publicPortsCount > 0) {
    lines.push(
      `• Unexpected public ports: ${input.publicPortsCount}. Something is reachable from the internet that is not on your allowlist.`
    );
  } else {
    lines.push("• Unexpected public ports: 0.");
    if (input.allowlistedTotal !== null) {
      const allowTxt =
        input.expectedPublicPorts && input.expectedPublicPorts.length
          ? ` Allowlisted ports: ${input.expectedPublicPorts.join(", ")}.`
          : "";
      lines.push(
        `  (${input.allowlistedTotal} public port(s) are open, and they match your allowlist.)${allowTxt}`
      );
    }
  }

  if (input.stale) {
    lines.push("• Snapshot freshness: stale. Data is older than expected, so newer changes might not be visible yet.");
  } else {
    lines.push("• Snapshot freshness: current.");
  }

  if (input.alertsPreview && input.alertsPreview.length > 0) {
    lines.push("");
    lines.push("Top alert details:");
    for (const alert of input.alertsPreview.slice(0, 3)) {
      const severity = alert.severity ? alert.severity.toUpperCase() : "WARN";
      lines.push(`• [${severity}] ${alert.title}`);
      lines.push(`  Why it matters: ${explainAlertMeaning(alert)}`);
      const detail = compactAlertDetail(alert.detail);
      if (detail) lines.push(`  Evidence: ${detail}`);
    }
  }

  if (reasonLines.length) {
    lines.push("");
    lines.push("Why it landed in this state:");
    for (const reason of reasonLines.slice(0, 4)) {
      lines.push(`• ${reason}`);
    }
  }

  if (itemLines.length) {
    lines.push("");
    lines.push("What matters most first:");
    for (const item of itemLines.slice(0, 3)) {
      lines.push(`• [${item.severity}] ${item.title}`);
      if (item.summary) lines.push(`  ${item.summary}`);
    }
  }

  lines.push("");
  lines.push("Recommended next moves:");
  lines.push(...input.actionsNeeded.map((a) => `• ${a}`));

  lines.push("");
  lines.push(
    "Fix Now starts with the safest automation available. It can launch Counterstrike for runtime IOC signals, run safe disk reclaim for root pressure, reconcile planned baseline drift, and then wait for a fresh snapshot. The host intentionally stays out of green if the latest scan still shows unresolved drift, exposure, runtime threat, or root disk pressure above the fail line."
  );

  return lines.join("\n");
}

export function buildFixSteps(input: {
  alertsCount: number;
  publicPortsCount: number; // actionable (unexpected)
  stale: boolean;
  allowlistedTotal: number | null;
  alertsPreview?: ExplainAlertPreview[];
  queueQueuedCount?: number;
  queueDlqCount?: number;
}): FixStep[] {
  const steps: FixStep[] = [];
  const queueQueued = Math.max(0, Math.trunc(input.queueQueuedCount ?? 0));
  const queueDlq = Math.max(0, Math.trunc(input.queueDlqCount ?? 0));
  const runtimeContainmentNeeded = hasRuntimeContainmentSignal(input.alertsPreview);
  const diskPressureNeeded = hasDiskPressureSignal(input.alertsPreview);
  const baselineDriftNeeded = hasBaselineDriftSignal(input.alertsPreview);
  const previewCount = input.alertsPreview?.length ?? 0;
  const previewIncomplete =
    input.alertsCount > 0 && (previewCount === 0 || input.alertsCount > previewCount);
  const genericAlertFollowupNeeded =
    input.alertsCount > 0 && (previewIncomplete || hasResidualManualAlertSignal(input.alertsPreview));

  if (input.stale) {
    steps.push({
      id: "stale",
      label: "Trigger an immediate fresh scan/report",
      status: "idle",
    });
  }

  if (input.publicPortsCount > 0) {
    steps.push({
      id: "ports",
      label: "Flag unexpected public ports for operator review",
      status: "idle",
    });
  } else if (input.allowlistedTotal !== null) {
    steps.push({
      id: "ports-allowlisted",
      label: "Public ports are allowlisted; no port action needed right now",
      status: "idle",
    });
  }

  if (diskPressureNeeded) {
    steps.push({
      id: "disk-pressure",
      label: "Run safe disk reclaim for root pressure, then refresh host headroom",
      status: "idle",
    });
  }

  if (runtimeContainmentNeeded) {
    steps.push({
      id: "contain-runtime-ioc",
      label: "Run Counterstrike on runtime threat signals, then wait for a fresh scan",
      status: "idle",
    });
  }

  if (baselineDriftNeeded) {
    steps.push({
      id: "baseline-drift",
      label: "Accept planned drift into the baseline so expected changes stop counting as alerts",
      status: "idle",
    });
  }

  if (genericAlertFollowupNeeded) {
    steps.push({
      id: "alerts",
      label: "Run safe remediation actions for alerts that are still active",
      status: "idle",
    });
  }

  if (queueQueued > 0 || queueDlq > 0) {
    steps.push({
      id: "queue-followup",
      label: `Stabilize remediation queue debt (queued ${queueQueued} · dlq ${queueDlq})`,
      status: "idle",
    });
  }

  // Always include a “report” step so the user sees “something happening”
  steps.push({
    id: "report",
    label: "Pull a fresh snapshot and refresh the report",
    status: "idle",
  });

  return steps;
}

export function stepIcon(status: FixStepStatus) {
  if (status === "idle") return "•";
  if (status === "running") return "⏳";
  if (status === "success") return "✅";
  return "❌";
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
