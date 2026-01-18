// /var/www/vps-sentry-web/src/lib/status.ts
export type Alert = {
  title: string;
  detail?: string;
  // optional future metadata
  severity?: "info" | "warn" | "critical";
  code?: string;
  ts?: string;
};

export type Port = {
  proto: string;
  host: string;
  port: number;
  proc: string;
  pid: number;
  public: boolean;
  sig: string;
};

export type Breach = {
  id?: string;
  title: string;
  detail?: string;
  severity?: "info" | "warn" | "critical";
  code?: string;
  opened_ts?: string;
  fixed_ts?: string;
  state?: "open" | "fixed" | "ignored";
  // evidence is intentionally loose; collector can evolve without breaking UI
  evidence?: Record<string, unknown>;
};

export type Shipping = {
  last_ship_ok?: boolean;
  last_ship_ts?: string;
  last_ship_error?: string;
};

export type Status = {
  host: string;
  version: string;
  ts: string;

  baseline_last_accepted_ts?: string;

  alerts_count: number;
  alerts: Alert[];

  public_ports_count: number;
  ports_public: Port[];

  auth?: {
    new_ssh_accepts_count: number;
    ssh_failed_password: number;
    ssh_invalid_user: number;
  };

  // Optional future fields (render if present)
  threat?: {
    suspicious_processes?: unknown[];
    top_cpu?: unknown[];
    outbound_suspicious?: unknown[];
    persistence_hits?: unknown[];
  };

  // Optional: "breach feed" (future)
  breaches_open?: number;
  breaches_fixed?: number;
  breaches?: Breach[];

  // Optional: shipping / email status (future)
  shipping?: Shipping;

  // Allow forward-compatible extra fields without TypeScript fights
  [k: string]: unknown;
};

// /api/status returns an envelope; older version: { ok: true, last: {...}, diff: {...}, ts: "..." }
// newer version: { ok: true, status: {...}, last: {...}, diff: {...}, warnings?: [...], paths?: {...}, ts: "..." }
export type StatusEnvelope = {
  ok?: boolean;
  ts?: string;

  // NEW: canonical payload (published status.json)
  status?: Partial<Status> & Record<string, unknown>;

  // OLD: back-compat payloads
  last?: Partial<Status> & Record<string, unknown>;
  diff?: unknown;

  // NEW: helpful debug
  warnings?: string[];
  paths?: {
    status?: string;
    last?: string;
    diff?: string;
  };

  // anything else
  [k: string]: unknown;
};

export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) => (typeof val === "bigint" ? val.toString() : val),
      2
    );
  } catch {
    try {
      return String(v);
    } catch {
      return "[unprintable]";
    }
  }
}

export function fmt(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export function fmtAny(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return fmt(v);
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === "bigint") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Date(n).toLocaleString();
  }
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toLocaleString();
  }
  return String(v);
}

export function minutesAgo(ts?: string): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  return Math.round(diffMs / 60000);
}

function pickArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}

/**
 * Normalize ANY of:
 * - raw Status (direct published object)
 * - old envelope: { last, diff, ts }
 * - new envelope: { status, last, diff, warnings, paths, ts }
 *
 * into a single consistent shape the UI can rely on.
 */
export function normalizeStatusEnvelope(data: Status | StatusEnvelope) {
  const env = (data ?? {}) as StatusEnvelope;

  // Priority order:
  // 1) env.status (new canonical)
  // 2) env.last (old back-compat)
  // 3) raw Status object
  const source =
    (env.status ?? env.last ?? (data as Status)) as Partial<Status> &
      Record<string, unknown>;

  const alerts = pickArray<Alert>(source.alerts);
  const portsPublic = pickArray<Port>(source.ports_public);
  const breaches = pickArray<Breach>(source.breaches);

  const alertsCount = pickNumber(source.alerts_count) ?? alerts.length;
  const publicPortsCount =
    pickNumber(source.public_ports_count) ?? portsPublic.length;

  const breachesOpen =
    pickNumber(source.breaches_open) ??
    breaches.filter((b) => (b?.state ?? "open") === "open").length;

  const breachesFixed =
    pickNumber(source.breaches_fixed) ??
    breaches.filter((b) => (b?.state ?? "") === "fixed").length;

  const ts = pickString(source.ts) ?? pickString(env.ts) ?? new Date().toISOString();

  const last: Status = {
    host: pickString(source.host) ?? "—",
    version: pickString(source.version) ?? "—",
    ts,

    baseline_last_accepted_ts:
      pickString(source.baseline_last_accepted_ts) ?? undefined,

    alerts_count: alertsCount,
    alerts,

    public_ports_count: publicPortsCount,
    ports_public: portsPublic,

    auth: (source.auth as Status["auth"]) ?? undefined,
    threat: (source.threat as Status["threat"]) ?? undefined,

    breaches_open:
      breaches.length || source.breaches_open !== undefined ? breachesOpen : undefined,
    breaches_fixed:
      breaches.length || source.breaches_fixed !== undefined ? breachesFixed : undefined,
    breaches: breaches.length ? breaches : undefined,

    shipping: (source.shipping as Status["shipping"]) ?? undefined,

    // preserve additional unknown fields for DebugPanel
    ...source,
  };

  return {
    ok: Boolean(env.ok ?? true),
    ts: env.ts ?? ts,
    last,
    diff: env.diff,
    warnings: Array.isArray(env.warnings) ? env.warnings : undefined,
    paths: env.paths,
    raw: data,
  };
}
