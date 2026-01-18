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

export type DerivedDashboard = {
  snapshotTs: string;
  ageMin: number | null;
  stale: boolean;

  needsAction: boolean;
  headline: "ACTION NEEDED" | "OK";
  level: "ok" | "warn" | "bad";
  actionSummary: ActionSummary;
  scanLabel: string;

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
    breachesOpen !== null ||
    breachesFixed !== null ||
    (Array.isArray(breaches) && breaches.length > 0);

  const hasShippingSignals =
    shipping?.last_ship_ok !== undefined ||
    Boolean(shipping?.last_ship_ts) ||
    Boolean(shipping?.last_ship_error);

  // “needs action” stays identical logic for now (we’ll wire breaches later)
  const needsAction = s.alerts_count > 0 || s.public_ports_count > 0 || stale;

  const actionSummary = buildActionSummary({
    alertsCount: s.alerts_count,
    alerts: s.alerts ?? [],
    publicPortsCount: s.public_ports_count,
    portsPublic: s.ports_public ?? [],
    stale,
  });

  const headline: "ACTION NEEDED" | "OK" = needsAction ? "ACTION NEEDED" : "OK";

  const level: "ok" | "warn" | "bad" =
    s.alerts_count > 0 ? "bad" : s.public_ports_count > 0 || stale ? "warn" : "ok";

  const scanLabel =
    `${fmt(snapshotTs)}` +
    (typeof ageMin === "number" ? ` · Age: ${ageMin}m${stale ? " (stale)" : ""}` : "");

  // Extract canonical status object + warnings/paths from raw /api/status
  const rawAny = env.raw as any;
  const canonicalStatus =
    rawAny && typeof rawAny === "object" ? (rawAny as any).status : undefined;

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
