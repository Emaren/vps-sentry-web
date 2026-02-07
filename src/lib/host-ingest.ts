import crypto from "node:crypto";

export type ParsedIngestPayload =
  | {
      ok: true;
      payloadHash: string;
      payloadBytes: number;
      status: Record<string, unknown>;
      last: unknown | null;
      diff: unknown | null;
      okFlag: boolean;
      ts: Date;
      alertsCount: number;
      publicPortsTotalCount: number;
      publicPortsCount: number;
      unexpectedPublicPortsCount: number;
      expectedPublicPorts: string[] | null;
      warnings: string[];
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

type EnvLike = Record<string, string | undefined>;

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function maxPayloadBytesFromEnv(env: EnvLike): number {
  return parsePositiveInt(env.VPS_INGEST_MAX_PAYLOAD_BYTES, 1_000_000);
}

function maxClockSkewMinutesFromEnv(env: EnvLike): number {
  return parsePositiveInt(env.VPS_INGEST_MAX_CLOCK_SKEW_MINUTES, 30);
}

function parseIsoDateOrNow(raw: unknown, now: Date): { date: Date; parsed: boolean } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { date: now, parsed: false };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return { date: now, parsed: false };
  }
  return { date: d, parsed: true };
}

function derivePublicPortsTotalCount(base: Record<string, unknown>): number {
  if (typeof base.public_ports_count === "number" && Number.isFinite(base.public_ports_count)) {
    return base.public_ports_count;
  }
  if (Array.isArray(base.ports_public)) return base.ports_public.length;
  return 0;
}

function deriveUnexpectedPublicPortsCount(base: Record<string, unknown>): number | null {
  if (
    typeof base.unexpected_public_ports_count === "number" &&
    Number.isFinite(base.unexpected_public_ports_count)
  ) {
    return base.unexpected_public_ports_count;
  }
  if (Array.isArray(base.ports_public_unexpected)) {
    return base.ports_public_unexpected.length;
  }
  return null;
}

function deriveExpectedPublicPorts(base: Record<string, unknown>): string[] | null {
  if (!Array.isArray(base.expected_public_ports)) return null;
  const out = base.expected_public_ports.filter((x) => typeof x === "string") as string[];
  return out.length ? out : null;
}

export function extractIngestMeta(status: unknown): {
  payloadHash?: string;
  payloadBytes?: number;
  receivedTs?: string;
  warnings?: string[];
} | null {
  if (!isPlainObject(status)) return null;
  const meta = (status as Record<string, unknown>)._web_ingest;
  if (!isPlainObject(meta)) return null;

  const warnings = Array.isArray(meta.warnings)
    ? (meta.warnings.filter((x) => typeof x === "string") as string[])
    : undefined;

  return {
    payloadHash: typeof meta.payloadHash === "string" ? meta.payloadHash : undefined,
    payloadBytes: typeof meta.payloadBytes === "number" ? meta.payloadBytes : undefined,
    receivedTs: typeof meta.receivedTs === "string" ? meta.receivedTs : undefined,
    warnings,
  };
}

export function parseIngestPayload(
  rawBody: string,
  opts?: {
    now?: Date;
    env?: EnvLike;
  }
): ParsedIngestPayload {
  const now = opts?.now ?? new Date();
  const env = opts?.env ?? process.env;
  const payloadBytes = Buffer.byteLength(rawBody, "utf8");
  const maxPayloadBytes = maxPayloadBytesFromEnv(env);

  if (payloadBytes <= 0) {
    return { ok: false, status: 400, error: "Empty request body" };
  }
  if (payloadBytes > maxPayloadBytes) {
    return {
      ok: false,
      status: 413,
      error: `Payload too large (${payloadBytes} bytes > ${maxPayloadBytes} bytes)`,
    };
  }

  let payloadUnknown: unknown;
  try {
    payloadUnknown = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
  if (!isPlainObject(payloadUnknown)) {
    return { ok: false, status: 400, error: "JSON body must be an object" };
  }

  const payload = payloadUnknown;
  const statusObj = isPlainObject(payload.status) ? payload.status : null;
  const base = statusObj ?? payload;
  const warnings: string[] = [];

  const tsRaw = base.ts ?? payload.ts;
  const tsParsed = parseIsoDateOrNow(tsRaw, now);
  if (!tsParsed.parsed) warnings.push("ingest_ts_invalid_or_missing");

  const skewMins = Math.abs(now.getTime() - tsParsed.date.getTime()) / 60000;
  const maxSkewMins = maxClockSkewMinutesFromEnv(env);
  if (skewMins > maxSkewMins) {
    warnings.push(`ingest_clock_skew_high:${Math.round(skewMins)}m`);
  }

  const alerts = Array.isArray(base.alerts) ? base.alerts : [];
  const alertsCount =
    typeof base.alerts_count === "number" && Number.isFinite(base.alerts_count)
      ? base.alerts_count
      : alerts.length;
  if (Array.isArray(base.alerts) && typeof base.alerts_count === "number" && alertsCount !== alerts.length) {
    warnings.push("ingest_alerts_count_mismatch");
  }

  const publicPortsTotalCount = derivePublicPortsTotalCount(base);
  const unexpectedMaybe = deriveUnexpectedPublicPortsCount(base);
  const publicPortsCount = unexpectedMaybe ?? publicPortsTotalCount;
  const unexpectedPublicPortsCount = publicPortsCount;
  const expectedPublicPorts = deriveExpectedPublicPorts(base);

  const payloadHash = sha256(rawBody);
  const statusWithMeta: Record<string, unknown> = {
    ...base,
    _web_ingest: {
      payloadHash,
      payloadBytes,
      receivedTs: now.toISOString(),
      warnings,
    },
  };

  return {
    ok: true,
    payloadHash,
    payloadBytes,
    status: statusWithMeta,
    last: payload.last ?? null,
    diff: payload.diff ?? null,
    okFlag: typeof payload.ok === "boolean" ? payload.ok : true,
    ts: tsParsed.date,
    alertsCount,
    publicPortsTotalCount,
    publicPortsCount,
    unexpectedPublicPortsCount,
    expectedPublicPorts,
    warnings,
  };
}
