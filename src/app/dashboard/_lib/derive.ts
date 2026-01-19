// /var/www/vps-sentry-web/src/app/dashboard/_lib/derive.ts
import React from "react";
import { minutesAgo, fmt, type Status } from "@/lib/status";
import { buildActionSummary } from "./explain";

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

type AlertItem = { title?: string; detail?: string; [k: string]: any };

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
  alertsForAction: any[]; // filtered alerts array (or raw if filtering not possible)

  // Public ports (normalized)
  publicPortsTotalCount: number; // raw total (includes allowlisted)
  publicPortsCount: number; // actionable (unexpected if present, else total)
  unexpectedPublicPortsCount: number; // alias of actionable count (always numeric)
  expectedPublicPorts: string[] | null; // e.g. ["udp:68"]
  portsPublicForAction: any[]; // unexpected list if present, else total list

  // Optional future signals (present = show)
  breachesOpen: number | null;
  breachesFixed: number | null;
  breaches: any[] | null;
  hasBreachSignals: boolean;

  shipping:
    | {
        last_ship_ok?: boolean;
        last_ship_ts?: string;
        last_ship_error?: string;
      }
    | undefined;
  hasShippingSignals: boolean;

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
  const breachesOpen = pickNumber((s as any).breaches_open);
  const breachesFixed = pickNumber((s as any).breaches_fixed);
  const breaches = Array.isArray((s as any).breaches) ? ((s as any).breaches as any[]) : null;

  const shipping = (s as any).shipping as
    | {
        last_ship_ok?: boolean;
        last_ship_ts?: string;
        last_ship_error?: string;
      }
    | undefined;

  const hasBreachSignals =
    breachesOpen !== null || breachesFixed !== null || (Array.isArray(breaches) && breaches.length > 0);

  const hasShippingSignals =
    shipping?.last_ship_ok !== undefined ||
    Boolean(shipping?.last_ship_ts) ||
    Boolean(shipping?.last_ship_error);

  // ---- Public ports: prefer "unexpected" (actionable) if present ----
  const publicPortsTotalCount =
    typeof (s as any).public_ports_count === "number" ? (s as any).public_ports_count : 0;

  const unexpectedMaybe = pickNumber((s as any).unexpected_public_ports_count);
  const publicPortsCount = unexpectedMaybe ?? publicPortsTotalCount;

  const unexpectedPublicPortsCount = publicPortsCount;

  const expectedPublicPorts = pickStringArray((s as any).expected_public_ports);

  const portsPublicUnexpected = Array.isArray((s as any).ports_public_unexpected)
    ? ((s as any).ports_public_unexpected as any[])
    : null;

  // What we feed into summary + action popup:
  // - if unexpected list exists, use it (only actionable ports)
  // - else fallback to raw list
  const portsPublicForAction = portsPublicUnexpected ?? (s.ports_public ?? []);

  // ---- Alerts: best-effort filter out allowlisted ports noise ----
  const alertsRaw: AlertItem[] = Array.isArray((s as any).alerts) ? ((s as any).alerts as AlertItem[]) : [];
  const alertsTotalCount = typeof (s as any).alerts_count === "number" ? (s as any).alerts_count : alertsRaw.length;

  let alertsForAction: AlertItem[] = alertsRaw;
  let alertsCount = alertsTotalCount;

  if (alertsRaw.length) {
    alertsForAction = filterActionableAlerts({
      alerts: alertsRaw,
      publicPortsCountActionable: publicPortsCount,
      publicPortsTotalCount,
      expectedPublicPorts,
    });
    alertsCount = alertsForAction.length;
  }

  // “needs action” now uses actionable alerts + actionable ports only
  const needsAction = alertsCount > 0 || publicPortsCount > 0 || stale;

  const actionSummary = buildActionSummary({
    alertsCount,
    alerts: (alertsForAction as any[]) ?? [],
    publicPortsCount,
    portsPublic: portsPublicForAction,
    stale,
  });

  const headline: "ACTION NEEDED" | "OK" = needsAction ? "ACTION NEEDED" : "OK";

  const level: "ok" | "warn" | "bad" =
    alertsCount > 0 ? "bad" : publicPortsCount > 0 || stale ? "warn" : "ok";

  const scanLabel =
    `${fmt(snapshotTs)}` + (typeof ageMin === "number" ? ` · Age: ${ageMin}m${stale ? " (stale)" : ""}` : "");

  // Extract canonical status object + warnings/paths from raw /api/status
  const rawAny = env.raw as any;
  const canonicalStatus = rawAny && typeof rawAny === "object" ? (rawAny as any).status : undefined;

  const rawWarnings =
    rawAny && typeof rawAny === "object" && Array.isArray((rawAny as any).warnings)
      ? ((rawAny as any).warnings as string[])
      : undefined;

  const rawPaths =
    rawAny && typeof rawAny === "object" && (rawAny as any).paths && typeof (rawAny as any).paths === "object"
      ? (rawAny as any).paths
      : undefined;

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
