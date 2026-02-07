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
  const maybeArray =
    asArray(summaryObj.bullets) ||
    asArray(summaryObj.actions) ||
    asArray(summaryObj.items) ||
    null;

  lines.push("Here’s what this snapshot means:");
  lines.push("");

  if (input.alertsCount > 0) {
    lines.push(
      `• Alerts: ${input.alertsCount}. These are things the agent flagged (config, perms, integrity, etc.).`
    );
  } else {
    lines.push("• Alerts: 0.");
  }

  // Ports: actionable first, then optional raw context
  if (input.publicPortsCount > 0) {
    lines.push(
      `• Unexpected public ports: ${input.publicPortsCount}. These are public-listening ports that are NOT on your allowlist.`
    );
  } else {
    lines.push("• Unexpected public ports: 0.");
    if (input.allowlistedTotal !== null) {
      const allowTxt =
        input.expectedPublicPorts && input.expectedPublicPorts.length
          ? ` Allowlisted: ${input.expectedPublicPorts.join(", ")}.`
          : "";
      lines.push(
        `  (FYI: ${input.allowlistedTotal} public port(s) exist but are allowlisted.)${allowTxt}`
      );
    }
  }

  if (input.stale) {
    lines.push("• Stale: yes. The dashboard is showing an older scan, so you may be blind to new changes.");
  } else {
    lines.push("• Stale: no.");
  }

  lines.push("");
  lines.push("Recommended next moves:");
  lines.push(...input.actionsNeeded.map((a) => `• ${a}`));

  if (maybeArray && maybeArray.length) {
    lines.push("");
    lines.push("Extra detail:");
    for (let i = 0; i < Math.min(maybeArray.length, 6); i++) {
      const v = maybeArray[i];
      if (typeof v === "string") {
        lines.push(`• ${v}`);
        continue;
      }
      const obj = asRecord(v);
      const s =
        (typeof obj?.title === "string" && obj.title) ||
        (typeof obj?.label === "string" && obj.label) ||
        JSON.stringify(v);
      lines.push(`• ${s}`);
    }
  }

  lines.push("");
  lines.push("If you want, I can walk you through the exact commands for each step.");

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
      label: "Bring scans back online (agent/timer/service health check)",
      status: "idle",
    });
  }

  if (input.publicPortsCount > 0) {
    steps.push({
      id: "ports",
      label: "Review unexpected public ports and propose firewall/close actions",
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
      label: "Summarize alerts and propose the safest fix sequence",
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
