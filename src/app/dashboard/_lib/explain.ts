// /var/www/vps-sentry-web/src/app/dashboard/_lib/explain.ts
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

function fmtExpected(expected?: string[] | null) {
  if (!expected || expected.length === 0) return "";
  const top = expected.slice(0, 6);
  const suffix = expected.length > top.length ? ` (+${expected.length - top.length} more)` : "";
  return `${top.join(", ")}${suffix}`;
}

function headLines(lines: string[], max: number) {
  return lines.slice(0, max).join("\n");
}

function toLine(x: any): string {
  if (x === null || x === undefined) return "—";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  try {
    // Prefer compact single-line JSON for evidence
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function containsAny(hay: string, needles: string[]) {
  const t = hay.toLowerCase();
  for (const n of needles) {
    if (!n) continue;
    if (t.includes(n.toLowerCase())) return true;
  }
  return false;
}

/**
 * IMPORTANT:
 * - publicPortsCount is the *actionable* count (unexpected ports if available, else total as fallback).
 * - publicPortsTotalCount is optional raw total count, used only for nicer messaging (never triggers action by itself).
 */
export function buildActionSummary(input: {
  alertsCount: number;
  alerts?: Array<{ title: string; detail?: string }>;

  // actionable ports (unexpected if present, else raw total)
  publicPortsCount: number;

  // list corresponding to actionable ports (unexpected list if present, else raw list)
  portsPublic?: Array<{
    proto: string;
    host: string;
    port: number;
    proc: string;
    pid: number;
  }>;

  // optional raw context (for display only)
  publicPortsTotalCount?: number;
  expectedPublicPorts?: string[] | null;

  stale: boolean;

  // NEW: “today-proof” signals (optional)
  sshd?: {
    checked_ts?: string;
    config_ok?: boolean;
    error?: string;
    file?: string;
    bad_line?: string;
    [k: string]: unknown;
  };

  services?: {
    checked_ts?: string;
    summary?: string;
    failed_units?: Array<{
      name: string;
      active_state?: string;
      sub_state?: string;
      since_ts?: string;
      restart_count?: number;
      last_error?: string;
      [k: string]: unknown;
    }>;
    degraded_units?: Array<{
      name: string;
      active_state?: string;
      sub_state?: string;
      since_ts?: string;
      restart_count?: number;
      last_error?: string;
      [k: string]: unknown;
    }>;
    [k: string]: unknown;
  };

  journal?: {
    since_ts?: string;
    checked_ts?: string;
    summary?: string;
    errors?: Array<{ ts?: string; unit?: string; prio?: string; code?: string; message?: string }>;
    warnings?: Array<{ ts?: string; unit?: string; prio?: string; code?: string; message?: string }>;
    [k: string]: unknown;
  };

  threat?: {
    suspicious_processes?: unknown[];
    top_cpu?: unknown[];
    outbound_suspicious?: unknown[];
    persistence_hits?: unknown[];
    [k: string]: unknown;
  };
}): ActionSummary {
  const items: ActionItem[] = [];
  const reasons: string[] = [];

  const sshdBad = Boolean(input.sshd && input.sshd.config_ok === false);

  const failedUnits = Array.isArray(input.services?.failed_units) ? input.services!.failed_units! : [];
  const degradedUnits = Array.isArray(input.services?.degraded_units) ? input.services!.degraded_units! : [];

  const journalErrors = Array.isArray(input.journal?.errors) ? input.journal!.errors! : [];
  const journalWarnings = Array.isArray(input.journal?.warnings) ? input.journal!.warnings! : [];

  const suspiciousProcs = Array.isArray(input.threat?.suspicious_processes)
    ? (input.threat!.suspicious_processes as unknown[])
    : [];

  const outboundSuspicious = Array.isArray(input.threat?.outbound_suspicious)
    ? (input.threat!.outbound_suspicious as unknown[])
    : [];

  const persistenceHits = Array.isArray(input.threat?.persistence_hits)
    ? (input.threat!.persistence_hits as unknown[])
    : [];

  // 0) sshd config invalid (this is the exact “today” failure class)
  if (sshdBad) {
    const file = input.sshd?.file ?? "sshd_config";
    const err = input.sshd?.error ?? "sshd config validation failed";
    const bad = input.sshd?.bad_line ? `Bad: ${input.sshd.bad_line}` : "";

    reasons.push("SSH config validation failed (sshd would fail to start).");

    items.push({
      id: "sshd-config-bad",
      severity: "CRITICAL",
      title: "SSHD config is invalid",
      summary:
        "This can brick SSH on restart/reload (exactly what happened today). Fix the bad directive, validate with sshd -t, then restart SSH cleanly.",
      evidence: headLines(
        [
          `File: ${file}`,
          `Error: ${err}`,
          bad ? bad : "",
          input.sshd?.checked_ts ? `Checked: ${input.sshd.checked_ts}` : "",
        ].filter(Boolean) as string[],
        12
      ),
      recommendedSteps: [
        "Open the referenced sshd_config(.d) file and fix/remove the invalid line.",
        "Validate config before restarting: `sudo sshd -t`.",
        "Restart SSH and confirm it’s active/running.",
        "Then run a fresh VPS-Sentry report so the dashboard updates.",
      ],
      copyCommands: [
        "sudo sshd -t",
        "sudo systemctl status ssh.service --no-pager -l",
        "sudo journalctl -u ssh -n 120 --no-pager",
        "sudo systemctl restart ssh.service",
        "sudo systemctl is-active ssh.service && echo OK",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  }

  // 1) systemd failures / degraded units
  if (failedUnits.length > 0 || degradedUnits.length > 0) {
    const criticalNames = ["ssh.service", "sshd.service", "nginx.service", "ufw.service", "fail2ban.service"];
    const failedEvidence = failedUnits.slice(0, 8).map((u) => {
      const meta = [
        u.active_state ? `active=${u.active_state}` : "",
        u.sub_state ? `sub=${u.sub_state}` : "",
        typeof u.restart_count === "number" ? `restarts=${u.restart_count}` : "",
      ].filter(Boolean);
      return `${u.name}${meta.length ? ` (${meta.join(", ")})` : ""}${u.last_error ? ` — ${u.last_error}` : ""}`;
    });

    const degradedEvidence = degradedUnits.slice(0, 6).map((u) => `${u.name}${u.last_error ? ` — ${u.last_error}` : ""}`);

    const anyCriticalFailed = failedUnits.some((u) => criticalNames.includes((u.name ?? "").toLowerCase()));
    const sev: Severity = anyCriticalFailed ? "CRITICAL" : failedUnits.length ? "HIGH" : "MEDIUM";

    reasons.push(
      failedUnits.length
        ? `${failedUnits.length} critical service(s) are failing.`
        : `${degradedUnits.length} service(s) are degraded.`
    );

    items.push({
      id: "systemd-health",
      severity: sev,
      title: failedUnits.length ? "Service failures detected" : "Service degradation detected",
      summary:
        "If a key service is failing (like SSH), you can have outages even when everything else looks fine. This is the missing sensor that makes short outages visible.",
      evidence: headLines(
        [
          input.services?.summary ? `Summary: ${input.services.summary}` : "",
          failedEvidence.length ? `Failed:\n- ${failedEvidence.join("\n- ")}` : "",
          degradedEvidence.length ? `Degraded:\n- ${degradedEvidence.join("\n- ")}` : "",
          input.services?.checked_ts ? `Checked: ${input.services.checked_ts}` : "",
        ].filter(Boolean) as string[],
        30
      ),
      recommendedSteps: [
        "Inspect the failing unit’s logs (journalctl -u).",
        "Fix the root cause (bad config, missing permission, disk full, etc.).",
        "Restart the unit and confirm it’s active/running.",
        "Then run a fresh VPS-Sentry report.",
      ],
      copyCommands: [
        "systemctl --failed --no-pager",
        "sudo systemctl status ssh.service nginx.service ufw.service fail2ban.service --no-pager -l || true",
        "sudo journalctl -u ssh -n 200 --no-pager || true",
        "sudo journalctl -u nginx -n 200 --no-pager || true",
        "sudo journalctl -u fail2ban -n 200 --no-pager || true",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  }

  // 2) journal errors/warnings since last check
  if (journalErrors.length > 0) {
    reasons.push(`${journalErrors.length} error(s) found in recent system logs.`);

    const evidence = journalErrors.slice(0, 8).map((e) => {
      const bits = [
        e.ts ? e.ts : "",
        e.unit ? `[${e.unit}]` : "",
        e.code ? `(${e.code})` : "",
        e.message ? e.message : "",
      ].filter(Boolean);
      return bits.join(" ");
    });

    // escalate to CRITICAL if it looks like SSH/service startup failures
    const joined = evidence.join("\n");
    const sev: Severity = containsAny(joined, [
      "failed to start ssh",
      "start request repeated too quickly",
      "permitopen",
      "sshd",
      "authentication failure",
    ])
      ? "CRITICAL"
      : "HIGH";

    items.push({
      id: "journal-errors",
      severity: sev,
      title: "Recent journal errors detected",
      summary:
        "Short-lived outages and config mistakes often only appear in the journal. This is how we catch them even if they recover between 5-minute scans.",
      evidence: evidence.length ? evidence.join("\n") : undefined,
      recommendedSteps: [
        "Open the matching unit logs and find the first error in the sequence.",
        "Fix the underlying issue (config/permissions/service dependency).",
        "Confirm service is healthy, then run a fresh report.",
      ],
      copyCommands: [
        "sudo journalctl -p err..alert -S -2h --no-pager | tail -200",
        "sudo journalctl -u ssh -n 200 --no-pager",
        "sudo systemctl status ssh.service --no-pager -l",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  } else if (journalWarnings.length > 0) {
    reasons.push(`${journalWarnings.length} warning(s) found in recent system logs.`);
  }

  // 3) runtime threat signals (miners/bots/persistence)
  if (suspiciousProcs.length > 0) {
    reasons.push(`${suspiciousProcs.length} suspicious process signal(s) reported.`);
    const evidence = suspiciousProcs.slice(0, 10).map((p) => `- ${toLine(p)}`);
    const sev: Severity = containsAny(evidence.join("\n"), ["xmrig", "miner", "kdevtmpfsi", "kinsing"])
      ? "CRITICAL"
      : "HIGH";

    items.push({
      id: "suspicious-procs",
      severity: sev,
      title: "Suspicious processes detected",
      summary:
        "This is the classic crypto-miner / bot foothold signal. Treat unknown high-CPU or weird-named processes as hostile until proven otherwise.",
      evidence: evidence.join("\n"),
      recommendedSteps: [
        "Identify the PID/command and parent process (who launched it).",
        "Stop/kill the process, then remove the dropped binary/script.",
        "Hunt for persistence (systemd timers, cron, shell startup hooks).",
        "Run a fresh report and ensure it doesn’t reappear.",
      ],
      copyCommands: [
        "ps aux --sort=-%cpu | head -n 25",
        "ps -eo pid,ppid,user,%cpu,%mem,etime,cmd --sort=-%cpu | head -n 30",
        "sudo lsof -p <PID> | head -n 80",
        "sudo systemctl list-timers --all --no-pager | head -n 80",
        "sudo crontab -l || true",
        "sudo ls -la /etc/cron.* /etc/crontab 2>/dev/null || true",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  }

  if (outboundSuspicious.length > 0) {
    reasons.push(`${outboundSuspicious.length} suspicious outbound connection signal(s) reported.`);
    const evidence = outboundSuspicious.slice(0, 10).map((x) => `- ${toLine(x)}`);

    items.push({
      id: "outbound-suspicious",
      severity: "HIGH",
      title: "Suspicious outbound connections detected",
      summary:
        "Miners and bots often ‘phone home’ or connect to pools/command servers. Unexpected outbound connections are a strong compromise indicator.",
      evidence: evidence.join("\n"),
      recommendedSteps: [
        "Map outbound connections back to the owning PID/process.",
        "Block outbound traffic if needed, then kill the owning process.",
        "Remove the dropped payload and persistence hooks.",
        "Run a fresh report to confirm it’s gone.",
      ],
      copyCommands: [
        "sudo ss -tunp | head -n 120",
        "sudo lsof -i -P -n | head -n 140",
        "sudo iptables -S | head -n 120 || true",
        "sudo ufw status verbose",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  }

  if (persistenceHits.length > 0) {
    reasons.push(`${persistenceHits.length} persistence hook(s) reported.`);
    const evidence = persistenceHits.slice(0, 12).map((x) => `- ${toLine(x)}`);

    items.push({
      id: "persistence-hits",
      severity: "HIGH",
      title: "Persistence mechanisms detected",
      summary:
        "This means something is configured to come back after reboot or after you kill it. Persistence is the real fight against miners.",
      evidence: evidence.join("\n"),
      recommendedSteps: [
        "Inspect each persistence entry and remove the malicious unit/timer/cron/job.",
        "Check both root and user crons, systemd user services, and timers.",
        "Run a fresh report to confirm it stays clean after a restart window.",
      ],
      copyCommands: [
        "sudo systemctl list-timers --all --no-pager",
        "sudo systemctl list-unit-files --type=service --no-pager | grep enabled | head -n 80",
        "sudo crontab -l || true",
        "sudo ls -la /var/spool/cron /etc/cron.* /etc/crontab 2>/dev/null || true",
        "systemctl --user list-timers --all --no-pager 2>/dev/null || true",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  }

  // 4) stale scan
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

  // 5) public ports (ACTIONABLE only)
  if (input.publicPortsCount > 0) {
    const total = typeof input.publicPortsTotalCount === "number" ? input.publicPortsTotalCount : null;

    if (total !== null && total !== input.publicPortsCount) {
      const allowlisted = Math.max(0, total - input.publicPortsCount);
      const allowTxt = input.expectedPublicPorts?.length
        ? ` allowlisted (${fmtExpected(input.expectedPublicPorts)})`
        : " allowlisted";
      reasons.push(
        `${input.publicPortsCount} unexpected public listening port(s) detected (${total} total, ${allowlisted}${allowTxt}).`
      );
    } else {
      reasons.push(`${input.publicPortsCount} unexpected public listening port(s) detected.`);
    }

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
      title: "Unexpected public ports exposed",
      summary:
        "An unexpected public listening port means something is reachable from the internet that you didn’t explicitly allowlist. If it’s not intentional, it’s a risk.",
      evidence: evidenceLines.length ? evidenceLines.join("\n") : undefined,
      recommendedSteps: [
        "Confirm whether each listed port is expected. If it’s expected, add it to the allowlist so it stops paging you.",
        "If unexpected: close the port (firewall) or stop/disable the service that opened it.",
        "Harden SSH (if 22 is open): disable password auth and restrict by IP if possible.",
      ],
      copyCommands: [
        "sudo ss -ltnp",
        "sudo ss -lunp",
        "sudo lsof -i -P -n | head -n 80",
        "sudo ufw status verbose",
        "sudo ufw deny <port>/tcp   # example: sudo ufw deny 1234/tcp",
        "sudo ufw deny <port>/udp   # example: sudo ufw deny 1234/udp",
        "sudo systemctl status <service> --no-pager -l",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  } else {
    // Optional “FYI” reason when total exists but everything is allowlisted
    const total = typeof input.publicPortsTotalCount === "number" ? input.publicPortsTotalCount : null;
    if (total !== null && total > 0 && input.publicPortsCount === 0) {
      if (input.expectedPublicPorts?.length) {
        reasons.push(
          `Public ports detected but allowlisted (${total} total: ${fmtExpected(input.expectedPublicPorts)}).`
        );
      } else {
        reasons.push(`Public ports detected but allowlisted (${total} total).`);
      }
    }
  }

  // 6) alerts
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
        "sudo ss -lunp",
      ],
      safeActions: [{ kind: "POST", label: "Send report now", endpoint: "/api/ops/report-now" }],
    });
  }

  const needsAction =
    input.stale ||
    input.publicPortsCount > 0 ||
    input.alertsCount > 0 ||
    sshdBad ||
    failedUnits.length > 0 ||
    journalErrors.length > 0 ||
    suspiciousProcs.length > 0 ||
    outboundSuspicious.length > 0 ||
    persistenceHits.length > 0;

  // headline
  let headline = "OK";
  if (needsAction) {
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
