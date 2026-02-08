export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

export type AlertItem = {
  title?: string;
  detail?: string;
  code?: string;
  severity?: "critical" | "warn" | "info";
  [k: string]: unknown;
};

export type ScoredAlert = AlertItem & {
  title: string;
  detail?: string;
  severityLevel: AlertSeverity;
  score: number;
  suppressed: boolean;
  suppressReason?: string;
};

export type AlertPolicyResult = {
  actionable: ScoredAlert[];
  suppressed: ScoredAlert[];
  topSeverity: AlertSeverity | "none";
  maintenanceActive: boolean;
  maintenanceUntil?: string;
};

function asText(alert: AlertItem): string {
  return `${alert.title ?? ""}\n${alert.detail ?? ""}`.toLowerCase();
}

function boolEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function compileSuppressionRegexFromEnv(): RegExp[] {
  const raw = process.env.VPS_ALERT_SUPPRESS_REGEX?.trim();
  if (!raw) return [];

  const chunks = raw
    .split(/\n|\|\|/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out: RegExp[] = [];
  for (const c of chunks) {
    try {
      out.push(new RegExp(c, "i"));
    } catch {
      // ignore invalid pattern
    }
  }
  return out;
}

function parseMaintenanceUntil(): string | undefined {
  const raw = process.env.VPS_MAINTENANCE_UNTIL?.trim();
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function isMaintenanceActive(): { active: boolean; until?: string } {
  if (boolEnv("VPS_MAINTENANCE_MODE")) {
    const until = parseMaintenanceUntil();
    return { active: true, until };
  }
  const until = parseMaintenanceUntil();
  if (!until) return { active: false };
  return { active: new Date(until).getTime() > Date.now(), until };
}

function severityFromScore(score: number): AlertSeverity {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  if (score >= 25) return "low";
  return "info";
}

function scoreAlert(alert: AlertItem): number {
  let score = 45; // medium default
  const text = asText(alert);

  // Respect explicit severity from the payload first.
  if (alert.severity === "critical") score = Math.max(score, 95);
  if (alert.severity === "warn") score = Math.max(score, 65);
  if (alert.severity === "info") score = Math.max(score, 20);

  // High-confidence compromise-ish signals.
  if (
    /authorized_keys|\/etc\/sudoers|sshd_config|firewall changed|user list changed|root login|privilege/i.test(
      text
    )
  ) {
    score = Math.max(score, 95);
  }

  // Important but less conclusive drift.
  if (/watched files changed|packages changed|invalid user|failed password|nft|ufw/i.test(text)) {
    score = Math.max(score, 70);
  }

  // Lower signal operational noise.
  if (/telemetry|healthcheck|debug/i.test(text)) {
    score = Math.min(score, 30);
  }

  return score;
}

export function applyAlertPolicy(alerts: AlertItem[]): AlertPolicyResult {
  const regex = compileSuppressionRegexFromEnv();
  const suppressPackages = boolEnv("VPS_SUPPRESS_PACKAGES_CHANGED");
  const maintenance = isMaintenanceActive();

  const actionable: ScoredAlert[] = [];
  const suppressed: ScoredAlert[] = [];

  for (const raw of alerts) {
    const title = (raw.title ?? "Alert").toString();
    const detail = typeof raw.detail === "string" ? raw.detail : undefined;
    const score = scoreAlert(raw);
    const severityLevel = severityFromScore(score);
    const text = `${title}\n${detail ?? ""}`;

    let suppressReason: string | undefined;

    if (!suppressReason && suppressPackages && /packages changed/i.test(title)) {
      suppressReason = "suppressed_by_packages_toggle";
    }

    if (!suppressReason) {
      for (const r of regex) {
        if (r.test(title) || (detail ? r.test(detail) : false) || r.test(text)) {
          suppressReason = `suppressed_by_pattern:${r.source}`;
          break;
        }
      }
    }

    if (!suppressReason && maintenance.active && severityLevel !== "critical") {
      suppressReason = "suppressed_by_maintenance_window";
    }

    const item: ScoredAlert = {
      ...raw,
      title,
      detail,
      score,
      severityLevel,
      suppressed: Boolean(suppressReason),
      suppressReason,
    };

    if (item.suppressed) suppressed.push(item);
    else actionable.push(item);
  }

  actionable.sort((a, b) => b.score - a.score);

  const topSeverity: AlertSeverity | "none" = actionable.length
    ? actionable[0].severityLevel
    : "none";

  return {
    actionable,
    suppressed,
    topSeverity,
    maintenanceActive: maintenance.active,
    maintenanceUntil: maintenance.until,
  };
}
