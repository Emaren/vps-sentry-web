// src/app/dashboard/_lib/explain.ts
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ActionItem = {
  id: string;
  severity: Severity;
  title: string;
  summary: string;
  evidence?: string;
  recommendedSteps: string[];
  copyCommands?: string[];
  safeActions?: Array<
    | { kind: "POST"; label: string; endpoint: string }
    | { kind: "REFRESH"; label: string }
    | { kind: "LINK"; label: string; href: string }
  >;
};

export type ActionSummary = {
  needsAction: boolean;
  headline: string;
  reasons: string[];
  items: ActionItem[];
};

function sevRank(s: Severity) {
  if (s === "CRITICAL") return 4;
  if (s === "HIGH") return 3;
  if (s === "MEDIUM") return 2;
  return 1;
}

function uniq(arr: string[]) {
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (!out.includes(arr[i])) out.push(arr[i]);
  }
  return out;
}

export function buildActionSummary(input: {
  alertsCount: number;
  alerts?: Array<{ title: string; detail?: string }>;
  publicPortsCount: number;
  portsPublic?: Array<{
    proto: string;
    host: string;
    port: number;
    proc: string;
    pid: number;
  }>;
  stale: boolean;
}): ActionSummary {
  const items: ActionItem[] = [];
  const reasons: string[] = [];

  // 1) stale
  if (input.stale) {
    reasons.push("Last scan is stale (older than expected).");
    items.push({
      id: "stale-scan",
      severity: "MEDIUM",
      title: "Scan is stale",
      summary:
        "The dashboard data may be outdated. Refresh or run a report so you’re viewing current information.",
      recommendedSteps: [
        "Tap Refresh.",
        "Tap “Send report now” to force an immediate scan + publish.",
        "If it stays stale, confirm the vps-sentry timer/service is running on the server.",
      ],
      copyCommands: [
        "sudo systemctl status vps-sentry.timer vps-sentry.service --no-pager -l",
        "sudo journalctl -u vps-sentry.service -n 200 --no-pager",
        "sudo systemctl restart vps-sentry.timer",
      ],
      safeActions: [
        { kind: "REFRESH", label: "Refresh dashboard" },
        { kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" },
      ],
    });
  }

  // 2) public ports
  if (input.publicPortsCount > 0) {
    reasons.push(`${input.publicPortsCount} public listening port(s) detected.`);
    const ports = input.portsPublic ?? [];
    const top = ports.slice(0, 6);

    const evidenceLines: string[] = [];
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      evidenceLines.push(`${p.proto} ${p.host}:${p.port} (${p.proc} pid=${p.pid})`);
    }

    items.push({
      id: "public-ports",
      severity: "HIGH",
      title: "Public ports exposed",
      summary:
        "A public listening port means something on your server is reachable from the internet. If it’s not intentional, it’s a risk.",
      evidence: evidenceLines.length ? evidenceLines.join("\n") : undefined,
      recommendedSteps: [
        "Decide if each port is expected (web server ports are usually fine; random ports are not).",
        "If unexpected: close the port (firewall) or stop the service that opened it.",
        "Harden SSH (if 22 is open): disable password auth and restrict by IP if possible.",
      ],
      copyCommands: [
        // firewall + process inspection (safe to copy, not auto-run)
        "sudo ss -ltnp",
        "sudo lsof -i -P -n | head -n 50",
        "sudo ufw status verbose",
        "sudo ufw deny <port>/tcp   # example: sudo ufw deny 1234/tcp",
        "sudo systemctl status <service> --no-pager -l",
      ],
      safeActions: [
        { kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" },
      ],
    });
  }

  // 3) alerts
  if (input.alertsCount > 0) {
    reasons.push(`${input.alertsCount} alert(s) detected.`);
    const alerts = input.alerts ?? [];
    const titles: string[] = [];
    for (let i = 0; i < Math.min(alerts.length, 4); i++) {
      titles.push(alerts[i]?.title ?? "Alert");
    }

    items.push({
      id: "alerts",
      severity: input.publicPortsCount > 0 ? "HIGH" : "MEDIUM",
      title: "Alerts reported by the agent",
      summary:
        "Alerts are the agent telling you something changed or looks risky. Start with the first alert, then verify whether it’s expected.",
      evidence: titles.length ? `Top alerts:\n- ${titles.join("\n- ")}` : undefined,
      recommendedSteps: [
        "Open the alert and read what changed.",
        "If it’s expected: accept baseline (later we’ll add a guided baseline flow).",
        "If it’s not expected: investigate the process/file/service mentioned.",
      ],
      copyCommands: [
        "sudo journalctl -u vps-sentry.service -n 200 --no-pager",
        "sudo tail -n 200 /var/log/auth.log 2>/dev/null || true",
        "sudo ss -ltnp",
      ],
      safeActions: [
        { kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" },
      ],
    });
  }

  const needsAction = input.stale || input.publicPortsCount > 0 || input.alertsCount > 0;

  // headline
  let headline = "OK";
  if (needsAction) {
    // pick highest severity item for headline vibe
    let max = 0;
    for (let i = 0; i < items.length; i++) max = Math.max(max, sevRank(items[i].severity));
    headline = max >= 3 ? "ACTION NEEDED" : "ATTENTION";
  }

  // sort items by severity desc
  items.sort((a, b) => sevRank(b.severity) - sevRank(a.severity));

  return {
    needsAction,
    headline,
    reasons: uniq(reasons),
    items,
  };
}
