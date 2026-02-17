// /var/www/vps-sentry-web/src/app/dashboard/_lib/derive.ts
import React from "react";
import { minutesAgo, fmt, type Status, type Breach, type Port, type Shipping } from "@/lib/status";
import { buildActionSummary } from "./explain";
import {
  applyAlertPolicy,
  type AlertItem as RawAlertItem,
  type AlertSeverity,
  type ScoredAlert,
} from "./alert-policy";

// derive the exact type from the function itself (no fragile re-exports)
type ActionSummary = ReturnType<typeof buildActionSummary>;

export function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}

function pickStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t.length) out.push(t);
    }
  }
  return out.length ? out : null;
}

type AlertItem = RawAlertItem;
type DashboardPort = Pick<Port, "proto" | "host" | "port" | "proc" | "pid">;
export type DashboardVitalsProcess = {
  pid: number | null;
  name: string;
  cpuSharePercent: number | null;
  cpuCapacityPercent: number | null;
  memoryMb: number | null;
  memoryCapacityPercent: number | null;
  isOther: boolean;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function isPortsNoiseAlert(alert: AlertItem, expectedPortsLower: string[]): boolean {
  const t = `${alert.title ?? ""} ${alert.detail ?? ""}`.toLowerCase();

  // Generic "ports" alert language (varies by agent versions)
  if (
    t.includes("public port") ||
    t.includes("public ports") ||
    t.includes("listening port") ||
    t.includes("listening ports") ||
    t.includes("ports_public") ||
    t.includes("ports public") ||
    t.includes("ports-public") ||
    t.includes("public listening")
  ) {
    return true;
  }

  // Match any allowlisted token (e.g. "udp:68") if it appears in title/detail
  for (const p of expectedPortsLower) {
    if (!p) continue;

    if (t.includes(p)) return true;

    // Also match common textual variants, e.g. "udp 68", "udp/68", "udp: 68"
    const m = p.match(/^([a-z]+)\s*[:/]\s*(\d+)$/i);
    if (m) {
      const proto = (m[1] ?? "").toLowerCase();
      const port = m[2] ?? "";
      if (!proto || !port) continue;

      const hasProto = t.includes(proto);
      const hasPort =
        t.includes(`:${port}`) ||
        t.includes(`/${port}`) ||
        t.includes(` ${port}`) ||
        t.includes(`port ${port}`) ||
        t.includes(`port=${port}`);

      if (hasProto && hasPort) return true;
    }
  }

  return false;
}

function filterActionableAlerts(input: {
  alerts: AlertItem[];
  publicPortsCountActionable: number;
  publicPortsTotalCount: number;
  expectedPublicPorts: string[] | null;
}): AlertItem[] {
  const { alerts, publicPortsCountActionable, publicPortsTotalCount, expectedPublicPorts } = input;

  // Only suppress port-related alerts when:
  // - there ARE public ports
  // - there are ZERO unexpected (actionable) public ports
  // - an allowlist exists
  const shouldSuppressPortsNoise =
    publicPortsTotalCount > 0 &&
    publicPortsCountActionable === 0 &&
    Array.isArray(expectedPublicPorts) &&
    expectedPublicPorts.length > 0;

  if (!shouldSuppressPortsNoise) return alerts;

  const expectedLower = expectedPublicPorts.map((x) => x.toLowerCase().trim());

  const out: AlertItem[] = [];
  for (const a of alerts) {
    if (!isPortsNoiseAlert(a, expectedLower)) out.push(a);
  }
  return out;
}

export type DerivedDashboard = {
  snapshotTs: string;
  ageMin: number | null;
  stale: boolean;

  needsAction: boolean;
  headline: "ACTION NEEDED" | "OK";
  level: "ok" | "warn" | "bad";
  actionSummary: ActionSummary;
  scanLabel: string;

  // Alerts (normalized)
  alertsTotalCount: number; // raw total from status
  alertsCount: number; // actionable after noise filtering (best-effort)
  alertsForAction: ScoredAlert[]; // filtered actionable alerts
  alertsSuppressedCount: number;
  alertsSuppressed: ScoredAlert[];
  topAlertSeverity: AlertSeverity | "none";
  maintenanceActive: boolean;
  maintenanceUntil?: string;

  // Public ports (normalized)
  publicPortsTotalCount: number; // raw total (includes allowlisted)
  publicPortsCount: number; // actionable (unexpected if present, else total)
  unexpectedPublicPortsCount: number; // alias of actionable count (always numeric)
  expectedPublicPorts: string[] | null; // e.g. ["udp:68"]
  portsPublicForAction: DashboardPort[]; // unexpected list if present, else total list

  // Optional future signals (present = show)
  breachesOpen: number | null;
  breachesFixed: number | null;
  breaches: Breach[] | null;
  hasBreachSignals: boolean;

  shipping: Shipping | undefined;
  hasShippingSignals: boolean;

  // VPS resource vitals (optional, from host snapshot)
  hasVitals: boolean;
  cpuUsedPercent: number | null;
  cpuCapacityPercent: number;
  cpuCores: number | null;
  memoryUsedPercent: number | null;
  memoryCapacityPercent: number;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  memoryAvailableMb: number | null;
  vitalsSampledCount: number | null;
  vitalsCpuShareTotalPercent: number | null;
  vitalsProcesses: DashboardVitalsProcess[];

  // Debug extras (from /api/status envelope raw)
  canonicalStatus: unknown;
  rawWarnings: string[] | undefined;
  rawPaths: unknown;

  // Footer links (kept here so view stays clean)
  footerLinks: {
    discord: string;
    contact: string;
    facebook: string;
    x: string;
    tokentap: string;
    tmail: string;
  };
};

export function deriveDashboard(env: { raw: unknown; last: Status }) {
  const s = env.last;

  const snapshotTs = s.ts;
  const ageMin = minutesAgo(snapshotTs);
  const stale = typeof ageMin === "number" ? ageMin >= 15 : false;

  // Future fields (optional)
  const breachesOpen = pickNumber(s.breaches_open);
  const breachesFixed = pickNumber(s.breaches_fixed);
  const breaches = Array.isArray(s.breaches) ? s.breaches : null;
  const shipping = s.shipping;

  const hasBreachSignals =
    breachesOpen !== null || breachesFixed !== null || (Array.isArray(breaches) && breaches.length > 0);

  const hasShippingSignals =
    shipping?.last_ship_ok !== undefined ||
    Boolean(shipping?.last_ship_ts) ||
    Boolean(shipping?.last_ship_error);

  // ---- Resource vitals (optional) ----
  const vitalsRoot = asRecord(s.vitals);
  const vitalsCpu = asRecord(vitalsRoot?.cpu);
  const vitalsMemory = asRecord(vitalsRoot?.memory);
  const vitalsProcesses = asRecord(vitalsRoot?.processes);

  const cpuUsedPercent = pickNumber(vitalsCpu?.used_percent);
  const cpuCapacityPercent = pickNumber(vitalsCpu?.capacity_percent) ?? 100;
  const cpuCoresRaw = pickNumber(vitalsCpu?.cores);
  const cpuCores = cpuCoresRaw === null ? null : Math.max(1, Math.trunc(cpuCoresRaw));

  const memoryUsedPercent = pickNumber(vitalsMemory?.used_percent);
  const memoryCapacityPercent = pickNumber(vitalsMemory?.capacity_percent) ?? 100;
  const memoryUsedMb = pickNumber(vitalsMemory?.used_mb);
  const memoryTotalMb = pickNumber(vitalsMemory?.total_mb);
  const memoryAvailableMb = pickNumber(vitalsMemory?.available_mb);

  const topVitalsRaw = Array.isArray(vitalsProcesses?.top) ? vitalsProcesses.top : [];
  const vitalsProcessRows: DashboardVitalsProcess[] = [];

  for (const raw of topVitalsRaw) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const pidRaw = pickNumber(rec.pid);
    const pid = pidRaw === null ? null : Math.max(0, Math.trunc(pidRaw));
    const fallbackName = pid !== null && pid > 0 ? `pid ${pid}` : "unknown";

    vitalsProcessRows.push({
      pid,
      name: pickString(rec.name) ?? fallbackName,
      cpuSharePercent: pickNumber(rec.cpu_share_percent),
      cpuCapacityPercent: pickNumber(rec.cpu_capacity_percent),
      memoryMb: pickNumber(rec.memory_mb),
      memoryCapacityPercent: pickNumber(rec.memory_capacity_percent),
      isOther: false,
    });
  }

  const otherRaw = asRecord(vitalsProcesses?.other);
  if (otherRaw) {
    vitalsProcessRows.push({
      pid: null,
      name: pickString(otherRaw.name) ?? "other-processes",
      cpuSharePercent: pickNumber(otherRaw.cpu_share_percent),
      cpuCapacityPercent: pickNumber(otherRaw.cpu_capacity_percent),
      memoryMb: pickNumber(otherRaw.memory_mb),
      memoryCapacityPercent: pickNumber(otherRaw.memory_capacity_percent),
      isOther: true,
    });
  }

  const vitalsSampledRaw = pickNumber(vitalsProcesses?.sampled_count);
  const vitalsSampledCount = vitalsSampledRaw === null ? null : Math.max(0, Math.trunc(vitalsSampledRaw));
  const vitalsCpuShareTotalPercent =
    pickNumber(vitalsProcesses?.cpu_share_total_percent) ??
    (vitalsProcessRows.length
      ? vitalsProcessRows.reduce((acc, row) => acc + (row.cpuSharePercent ?? 0), 0)
      : null);

  const hasVitals =
    cpuUsedPercent !== null ||
    memoryUsedPercent !== null ||
    vitalsProcessRows.length > 0;

  // ---- Public ports: prefer "unexpected" (actionable) if present ----
  const publicPortsTotalCount = s.public_ports_count;

  const unexpectedMaybe = pickNumber(s.unexpected_public_ports_count);
  const publicPortsCount = unexpectedMaybe ?? publicPortsTotalCount;

  const unexpectedPublicPortsCount = publicPortsCount;

  const expectedPublicPorts = pickStringArray(s.expected_public_ports);

  const portsPublicUnexpected = Array.isArray(s.ports_public_unexpected)
    ? (s.ports_public_unexpected as unknown as DashboardPort[])
    : null;

  // What we feed into summary + action popup:
  // - if unexpected list exists, use it (only actionable ports)
  // - else fallback to raw list
  const portsPublicForAction = portsPublicUnexpected ?? (s.ports_public ?? []);

  // ---- Alerts: best-effort filter out allowlisted ports noise ----
  const alertsRaw: AlertItem[] = Array.isArray(s.alerts) ? s.alerts : [];
  const alertsTotalCount = s.alerts_count;

  let alertsForAction: ScoredAlert[] = [];
  let alertsCount = alertsTotalCount;
  let alertsSuppressed: ScoredAlert[] = [];
  let alertsSuppressedCount = 0;
  let topAlertSeverity: AlertSeverity | "none" = "none";
  let maintenanceActive = false;
  let maintenanceUntil: string | undefined;

  if (alertsRaw.length) {
    const portsFilteredAlerts = filterActionableAlerts({
      alerts: alertsRaw,
      publicPortsCountActionable: publicPortsCount,
      publicPortsTotalCount,
      expectedPublicPorts,
    });

    const policy = applyAlertPolicy(portsFilteredAlerts);
    alertsForAction = policy.actionable;
    alertsSuppressed = policy.suppressed;
    alertsCount = alertsForAction.length;
    alertsSuppressedCount = alertsSuppressed.length;
    topAlertSeverity = policy.topSeverity;
    maintenanceActive = policy.maintenanceActive;
    maintenanceUntil = policy.maintenanceUntil;
  }

  // “needs action” now uses actionable alerts + actionable ports only
  const needsAction = alertsCount > 0 || publicPortsCount > 0 || stale;

  const actionSummary = buildActionSummary({
    alertsCount,
    alerts: alertsForAction ?? [],
    topAlertSeverity,
    publicPortsCount,
    portsPublic: portsPublicForAction,
    stale,
  });

  const headline: "ACTION NEEDED" | "OK" = needsAction ? "ACTION NEEDED" : "OK";

  const level: "ok" | "warn" | "bad" =
    alertsCount > 0
      ? topAlertSeverity === "critical" || topAlertSeverity === "high"
        ? "bad"
        : "warn"
      : publicPortsCount > 0 || stale
        ? "warn"
        : "ok";

  const scanLabel =
    `${fmt(snapshotTs)}` + (typeof ageMin === "number" ? ` · Age: ${ageMin}m${stale ? " (stale)" : ""}` : "");

  // Extract canonical status object + warnings/paths from raw /api/status
  const rawObj = asRecord(env.raw);
  const canonicalStatus = rawObj?.status;

  const rawWarnings = Array.isArray(rawObj?.warnings)
    ? rawObj.warnings.filter((x): x is string => typeof x === "string")
    : undefined;

  const rawPaths = asRecord(rawObj?.paths) ?? undefined;

  const footerLinks = {
    discord: "https://discord.gg/REPLACE_ME",
    contact: "/contact",
    facebook: "https://facebook.com/REPLACE_ME",
    x: "https://x.com/REPLACE_ME",
    tokentap: "https://tokentap.ca",
    tmail: "https://tmail.tokentap.ca",
  };

  const out: DerivedDashboard = {
    snapshotTs,
    ageMin,
    stale,

    needsAction,
    headline,
    level,
    actionSummary,
    scanLabel,

    alertsTotalCount,
    alertsCount,
    alertsForAction,
    alertsSuppressedCount,
    alertsSuppressed,
    topAlertSeverity,
    maintenanceActive,
    maintenanceUntil,

    publicPortsTotalCount,
    publicPortsCount,
    unexpectedPublicPortsCount,
    expectedPublicPorts,
    portsPublicForAction,

    breachesOpen,
    breachesFixed,
    breaches,
    hasBreachSignals,

    shipping,
    hasShippingSignals,

    hasVitals,
    cpuUsedPercent,
    cpuCapacityPercent,
    cpuCores,
    memoryUsedPercent,
    memoryCapacityPercent,
    memoryUsedMb,
    memoryTotalMb,
    memoryAvailableMb,
    vitalsSampledCount,
    vitalsCpuShareTotalPercent,
    vitalsProcesses: vitalsProcessRows,

    canonicalStatus,
    rawWarnings,
    rawPaths,

    footerLinks,
  };

  return out;
}

// Shared table styles (so sections don’t duplicate)
export const thStyle: React.CSSProperties = { padding: "8px 6px" };
export const tdStyle: React.CSSProperties = { padding: "10px 6px", verticalAlign: "top" };

export type ThreatIndicator = {
  id: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail?: string;
};

function hasAlertMatch(alerts: AlertItem[], pattern: RegExp): boolean {
  for (const a of alerts) {
    const text = `${a.title ?? ""}\n${a.detail ?? ""}`;
    if (pattern.test(text)) return true;
  }
  return false;
}

export function deriveThreatIndicators(s: Status): ThreatIndicator[] {
  const alerts: AlertItem[] = Array.isArray(s.alerts) ? s.alerts : [];
  const indicators: ThreatIndicator[] = [];

  const threat = asRecord(s.threat);
  const hasRuntimeSignals =
    Boolean(threat?.suspicious_processes) ||
    Boolean(threat?.outbound_suspicious) ||
    Boolean(threat?.persistence_hits);

  if (!hasRuntimeSignals) {
    indicators.push({
      id: "runtime-coverage-gap",
      severity: "warn",
      title: "Runtime threat telemetry not reported",
      detail:
        "Process and outbound-connection threat signals were missing in this snapshot. Compromise activity can be missed even when config/package alerts exist.",
    });
  }

  const watchedFilesChanged = hasAlertMatch(alerts, /watched files changed/i);
  const firewallChanged = hasAlertMatch(alerts, /firewall changed/i);
  const userListChanged = hasAlertMatch(alerts, /user list changed/i);
  const packagesChanged = hasAlertMatch(alerts, /packages changed/i);

  if (watchedFilesChanged && (firewallChanged || userListChanged)) {
    indicators.push({
      id: "stacked-hardening-surface-changes",
      severity: "critical",
      title: "Stacked security-surface changes",
      detail:
        "Changes to watched security paths plus firewall/user drift in one window can indicate tampering and should be treated as possible compromise until proven benign.",
    });
  }

  if (packagesChanged && alerts.length >= 3) {
    indicators.push({
      id: "high-noise-change-window",
      severity: "info",
      title: "High-noise update window",
      detail:
        "Large package churn can mask malicious activity. During update windows, prioritize runtime process/outbound checks in addition to baseline diffs.",
    });
  }

  return indicators;
}
