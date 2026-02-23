// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/logic.ts
import type { ActionSummary } from "../../_lib/explain";
import type { FixStep, FixStepStatus } from "./types";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

export function buildActionsNeeded(input: {
  alertsCount: number;
  publicPortsCount: number; // actionable (unexpected)
  stale: boolean;
  allowlistedTotal: number | null;
  expectedPublicPorts?: string[] | null;
}): string[] {
  const out: string[] = [];

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

  lines.push("Here is the plain-English readout of this snapshot:");
  lines.push("");
  lines.push(
    `Status: ${input.summary.headline}. ${
      input.summary.needsAction
        ? "You should review a few things now, but this is still manageable."
        : "No urgent action is required."
    }`
  );
  lines.push("");

  if (input.alertsCount > 0) {
    lines.push(
      `• Alerts: ${input.alertsCount}. The agent noticed changes that could be risky and should be verified.`
    );
  } else {
    lines.push("• Alerts: 0 (nothing risky flagged by the agent in this snapshot).");
  }

  // Ports: actionable first, then optional raw context
  if (input.publicPortsCount > 0) {
    lines.push(
      `• Unexpected public ports: ${input.publicPortsCount}. Something is listening on the internet that is not on your allowlist.`
    );
  } else {
    lines.push("• Unexpected public ports: 0.");
    if (input.allowlistedTotal !== null) {
      const allowTxt =
        input.expectedPublicPorts && input.expectedPublicPorts.length
          ? ` Allowlisted ports: ${input.expectedPublicPorts.join(", ")}.`
          : "";
      lines.push(
        `  (FYI: ${input.allowlistedTotal} public port(s) are open, but they match your allowlist.)${allowTxt}`
      );
    }
  }

  if (input.stale) {
    lines.push("• Snapshot freshness: stale. Data is older than expected, so newer changes might not be visible yet.");
  } else {
    lines.push("• Snapshot freshness: current.");
  }

  if (reasonLines.length) {
    lines.push("");
    lines.push("Why this was marked:");
    for (const reason of reasonLines.slice(0, 4)) {
      lines.push(`• ${reason}`);
    }
  }

  if (itemLines.length) {
    lines.push("");
    lines.push("Top things to understand first:");
    for (const item of itemLines.slice(0, 3)) {
      lines.push(`• [${item.severity}] ${item.title}`);
      if (item.summary) lines.push(`  ${item.summary}`);
    }
  }

  lines.push("");
  lines.push("Recommended next moves (safest order):");
  lines.push(...input.actionsNeeded.map((a) => `• ${a}`));

  lines.push("");
  lines.push(
    "Fix Now can run the safe automations (queue drain + fresh report). Any risky change, like closing ports, stays manual by design."
  );

  return lines.join("\n");
}

export function buildFixSteps(input: {
  alertsCount: number;
  publicPortsCount: number; // actionable (unexpected)
  stale: boolean;
  allowlistedTotal: number | null;
}): FixStep[] {
  const steps: FixStep[] = [];

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
      label: "Prepare safe containment plan for unexpected public ports",
      status: "idle",
    });
  } else if (input.allowlistedTotal !== null) {
    steps.push({
      id: "ports-allowlisted",
      label: "Ports are allowlisted (FYI) — review allowlist if you want this quieter/noisier",
      status: "idle",
    });
  }

  if (input.alertsCount > 0) {
    steps.push({
      id: "alerts",
      label: "Run queued safe remediations for active alerts",
      status: "idle",
    });
  }

  // Always include a “report” step so the user sees “something happening”
  steps.push({
    id: "report",
    label: "Generate a fresh report (and notify you, if configured)",
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
