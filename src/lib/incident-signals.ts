export type SignalSeverity = "critical" | "high" | "medium" | "low" | "info";

export type IncidentSignal = {
  code: string;
  severity: SignalSeverity;
  title: string;
  detail?: string;
  ts: string;
  snapshotId?: string;
  source: "alert" | "auth" | "ports" | "ingest";
};

type SnapshotInput = {
  id: string;
  ts: Date | string;
  status: Record<string, unknown>;
};

type TimelineSummary = {
  total: number;
  bySeverity: Record<SignalSeverity, number>;
  byCode: Record<string, number>;
};

const SEVERITY_WEIGHT: Record<SignalSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function toIso(ts: Date | string): string {
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  }
  return ts.toISOString();
}

function textIncludes(text: string, pattern: RegExp): boolean {
  return pattern.test(text.toLowerCase());
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseAlerts(status: Record<string, unknown>, ts: string, snapshotId: string): IncidentSignal[] {
  const alerts = Array.isArray(status.alerts) ? status.alerts : [];
  const out: IncidentSignal[] = [];

  for (const raw of alerts) {
    const alert = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const title = asText(alert.title) || "Alert";
    const detail = asText(alert.detail) || undefined;
    const text = `${title}\n${detail ?? ""}`.toLowerCase();

    let code = "alert_generic";
    let severity: SignalSeverity = "medium";

    if (textIncludes(text, /(authorized_keys|\/etc\/sudoers|sshd_config|\/etc\/systemd\/system|\/etc\/ufw)/i)) {
      code = "config_tamper";
      severity = "critical";
    } else if (textIncludes(text, /(firewall changed|nft|ufw)/i)) {
      code = "firewall_drift";
      severity = "high";
    } else if (textIncludes(text, /(user list changed|added: .*uid|removed: .*uid)/i)) {
      code = "account_drift";
      severity = "high";
    } else if (textIncludes(text, /(packages changed)/i)) {
      code = "package_drift";
      severity = "medium";
    } else if (textIncludes(text, /(failed to find server action)/i)) {
      code = "app_release_mismatch";
      severity = "low";
    } else if ((alert.severity as string) === "critical") {
      severity = "critical";
    } else if ((alert.severity as string) === "warn") {
      severity = "medium";
    } else if ((alert.severity as string) === "info") {
      severity = "low";
    }

    out.push({
      code,
      severity,
      title,
      detail,
      ts,
      snapshotId,
      source: "alert",
    });
  }

  return out;
}

function parseAuth(status: Record<string, unknown>, ts: string, snapshotId: string): IncidentSignal[] {
  const auth = status.auth && typeof status.auth === "object" ? (status.auth as Record<string, unknown>) : null;
  if (!auth) return [];

  const out: IncidentSignal[] = [];
  const failed = asNumber(auth.ssh_failed_password);
  const invalid = asNumber(auth.ssh_invalid_user);
  const accepted = asNumber(auth.new_ssh_accepts_count);

  if (failed && failed > 0) {
    out.push({
      code: "ssh_failed_password",
      severity: failed >= 10 ? "high" : "medium",
      title: "Failed SSH passwords detected",
      detail: `Count: ${failed}`,
      ts,
      snapshotId,
      source: "auth",
    });
  }

  if (invalid && invalid > 0) {
    out.push({
      code: "ssh_invalid_user",
      severity: invalid >= 5 ? "high" : "medium",
      title: "Invalid SSH users attempted",
      detail: `Count: ${invalid}`,
      ts,
      snapshotId,
      source: "auth",
    });
  }

  if (accepted && accepted > 0) {
    out.push({
      code: "ssh_new_accepts",
      severity: "info",
      title: "New SSH accepts observed",
      detail: `Count: ${accepted}`,
      ts,
      snapshotId,
      source: "auth",
    });
  }

  return out;
}

function parsePorts(status: Record<string, unknown>, ts: string, snapshotId: string): IncidentSignal[] {
  const unexpected = asNumber(status.unexpected_public_ports_count);
  const total = asNumber(status.public_ports_count);
  const actionable = unexpected ?? total ?? 0;

  if (!actionable || actionable <= 0) return [];

  return [
    {
      code: "unexpected_public_ports",
      severity: actionable >= 3 ? "critical" : "high",
      title: "Unexpected public ports detected",
      detail: `Count: ${actionable}`,
      ts,
      snapshotId,
      source: "ports",
    },
  ];
}

function parseIngestWarnings(status: Record<string, unknown>, ts: string, snapshotId: string): IncidentSignal[] {
  const ingest =
    status._web_ingest && typeof status._web_ingest === "object"
      ? (status._web_ingest as Record<string, unknown>)
      : null;
  if (!ingest || !Array.isArray(ingest.warnings)) return [];

  const warnings = ingest.warnings.filter((x) => typeof x === "string") as string[];
  return warnings.map((w) => {
    const severity: SignalSeverity = w.startsWith("ingest_clock_skew_high:")
      ? "medium"
      : w.includes("mismatch")
      ? "medium"
      : "low";

    return {
      code: "ingest_integrity_warning",
      severity,
      title: "Ingest integrity warning",
      detail: w,
      ts,
      snapshotId,
      source: "ingest",
    };
  });
}

export function extractSignalsFromStatus(input: {
  status: Record<string, unknown>;
  snapshotId: string;
  ts: Date | string;
}): IncidentSignal[] {
  const ts = toIso(input.ts);

  return [
    ...parseAlerts(input.status, ts, input.snapshotId),
    ...parseAuth(input.status, ts, input.snapshotId),
    ...parsePorts(input.status, ts, input.snapshotId),
    ...parseIngestWarnings(input.status, ts, input.snapshotId),
  ];
}

function minutesBetweenIso(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.abs(Math.round((da - db) / 60000));
}

function correlationKey(s: IncidentSignal): string {
  return `${s.code}|${s.title}|${s.detail ?? ""}`;
}

export function buildIncidentTimeline(
  snapshots: SnapshotInput[],
  opts?: { dedupeWindowMinutes?: number }
): { timeline: IncidentSignal[]; summary: TimelineSummary } {
  const dedupeWindowMinutes = opts?.dedupeWindowMinutes ?? 30;
  const flattened: IncidentSignal[] = [];

  for (const snap of snapshots) {
    flattened.push(
      ...extractSignalsFromStatus({
        status: snap.status,
        snapshotId: snap.id,
        ts: snap.ts,
      })
    );
  }

  flattened.sort((a, b) => {
    const t = new Date(b.ts).getTime() - new Date(a.ts).getTime();
    if (t !== 0) return t;
    return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  });

  const deduped: IncidentSignal[] = [];
  const lastSeenByKey = new Map<string, string>();

  for (const s of flattened) {
    const key = correlationKey(s);
    const prevTs = lastSeenByKey.get(key);
    if (prevTs && minutesBetweenIso(prevTs, s.ts) <= dedupeWindowMinutes) {
      continue;
    }
    deduped.push(s);
    lastSeenByKey.set(key, s.ts);
  }

  const bySeverity: Record<SignalSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const byCode: Record<string, number> = {};
  for (const s of deduped) {
    bySeverity[s.severity] += 1;
    byCode[s.code] = (byCode[s.code] ?? 0) + 1;
  }

  return {
    timeline: deduped,
    summary: {
      total: deduped.length,
      bySeverity,
      byCode,
    },
  };
}
