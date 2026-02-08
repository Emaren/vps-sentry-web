type Primitive = string | number | boolean | null;
type JsonLike = Primitive | JsonLike[] | { [k: string]: JsonLike };

export type ObservabilityLevel = "debug" | "info" | "warn" | "error";

export type ObservabilityLabels = Record<string, Primitive | undefined>;

export type ObservabilityContext = {
  correlationId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  route: string | null;
  method: string | null;
  userId: string | null;
  hostId: string | null;
  source: string | null;
};

type ObservabilityContextInput = {
  correlationId?: string | null;
  traceId?: string | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  route?: string | null;
  method?: string | null;
  userId?: string | null;
  hostId?: string | null;
  source?: string | null;
};

export type ObservabilityLogEntry = {
  ts: string;
  level: ObservabilityLevel;
  message: string;
  correlationId: string | null;
  traceId: string | null;
  spanId: string | null;
  route: string | null;
  method: string | null;
  userId: string | null;
  hostId: string | null;
  fields: Record<string, JsonLike> | null;
};

export type ObservabilityTraceEntry = {
  ts: string;
  name: string;
  status: "ok" | "error";
  durationMs: number;
  correlationId: string | null;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  route: string | null;
  method: string | null;
  userId: string | null;
  hostId: string | null;
  attributes: Record<string, JsonLike> | null;
};

export type AlertMetadata = {
  ts: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  title: string;
  correlationId: string | null;
  traceId: string | null;
  route: string | null;
  method: string | null;
  target: string | null;
  deliveredOk: boolean | null;
  status: number | null;
  detail: string | null;
};

type CounterMetric = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

type TimingMetric = {
  name: string;
  labels: Record<string, string>;
  count: number;
  sumMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  samples: number[];
};

type ObservabilityState = {
  startedAtIso: string;
  counters: Map<string, CounterMetric>;
  timings: Map<string, TimingMetric>;
  logs: ObservabilityLogEntry[];
  traces: ObservabilityTraceEntry[];
  alerts: AlertMetadata[];
  maxLogs: number;
  maxTraces: number;
  maxAlerts: number;
};

export type ObservabilitySnapshot = {
  generatedAtIso: string;
  startedAtIso: string;
  uptimeMs: number;
  counters: Array<CounterMetric>;
  timings: Array<{
    name: string;
    labels: Record<string, string>;
    count: number;
    sumMs: number;
    minMs: number;
    maxMs: number;
    lastMs: number;
    p50Ms: number;
    p95Ms: number;
  }>;
  recentLogs: ObservabilityLogEntry[];
  recentTraces: ObservabilityTraceEntry[];
  recentAlerts: AlertMetadata[];
};

export const OBS_HEADER_CORRELATION_ID = "x-correlation-id";
export const OBS_HEADER_TRACE_ID = "x-trace-id";
export const OBS_HEADER_SPAN_ID = "x-span-id";
export const OBS_HEADER_REQUEST_ID = "x-request-id";
export const OBS_HEADER_RESPONSE_TIME_MS = "x-response-time-ms";

type EnsureHeadersInput = Partial<
  Pick<ObservabilityContext, "route" | "method" | "userId" | "hostId" | "source">
>;

type SnapshotInput = {
  logsLimit?: number;
  tracesLimit?: number;
  alertsLimit?: number;
  countersLimit?: number;
  timingsLimit?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toPositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.trunc(n), min, max);
}

function envValue(key: string): string | undefined {
  const g = globalThis as unknown as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };
  return g.process?.env?.[key];
}

function truncate(input: string, max = 240): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...[truncated ${input.length - max} chars]`;
}

function normalizeHeaderToken(raw: string | null | undefined, maxLen = 64): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const cleaned = t.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, maxLen);
  return cleaned.length ? cleaned : null;
}

function randomHex(length = 24): string {
  const bytes = Math.max(8, Math.ceil(length / 2));
  const g = globalThis as unknown as { crypto?: Crypto };
  if (g.crypto?.getRandomValues) {
    const arr = new Uint8Array(bytes);
    g.crypto.getRandomValues(arr);
    return Array.from(arr, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, length);
  }
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return out.slice(0, length);
}

function normalizeContextLabels(
  labels?: ObservabilityLabels
): Record<string, string> {
  if (!labels) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (value === undefined) continue;
    const k = key.trim();
    if (!k) continue;
    out[k] = typeof value === "string" ? truncate(value, 120) : String(value);
  }
  return out;
}

function labelsKey(labels: Record<string, string>): string {
  const pairs = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return pairs.map(([k, v]) => `${k}=${v}`).join(",");
}

function metricKey(name: string, labels: Record<string, string>): string {
  return `${name}|${labelsKey(labels)}`;
}

function pushRing<T>(arr: T[], value: T, max: number) {
  arr.push(value);
  if (arr.length > max) {
    arr.splice(0, arr.length - max);
  }
}

function sanitizeUnknown(value: unknown, depth = 0): JsonLike {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncate(value, 1200);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (depth >= 4) return "[depth-truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeUnknown(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, JsonLike> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.trim().slice(0, 64);
      if (!normalizedKey) continue;
      if (/pass(word)?|secret|token|authorization|cookie/i.test(normalizedKey)) {
        out[normalizedKey] = "[redacted]";
        continue;
      }
      out[normalizedKey] = sanitizeUnknown(v, depth + 1);
    }
    return out;
  }
  return String(value) as JsonLike;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function getState(): ObservabilityState {
  const g = globalThis as unknown as { __vpsObservability?: ObservabilityState };
  if (!g.__vpsObservability) {
    g.__vpsObservability = {
      startedAtIso: nowIso(),
      counters: new Map(),
      timings: new Map(),
      logs: [],
      traces: [],
      alerts: [],
      maxLogs: toPositiveInt(envValue("VPS_OBS_MAX_LOGS"), 500, 50, 5000),
      maxTraces: toPositiveInt(envValue("VPS_OBS_MAX_TRACES"), 500, 50, 5000),
      maxAlerts: toPositiveInt(envValue("VPS_OBS_MAX_ALERTS"), 300, 20, 2000),
    };
  }
  return g.__vpsObservability;
}

export function createObservabilityContext(
  headers: Headers,
  input?: EnsureHeadersInput
): ObservabilityContext {
  const correlationId =
    normalizeHeaderToken(headers.get(OBS_HEADER_CORRELATION_ID)) ?? randomHex(24);
  const traceId = normalizeHeaderToken(headers.get(OBS_HEADER_TRACE_ID)) ?? randomHex(24);
  const spanId = normalizeHeaderToken(headers.get(OBS_HEADER_SPAN_ID)) ?? randomHex(16);
  const route = input?.route?.trim() || null;
  const method = (input?.method ?? "").trim().toUpperCase() || null;
  return {
    correlationId,
    traceId,
    spanId,
    parentSpanId: null,
    route,
    method,
    userId: input?.userId?.trim() || null,
    hostId: input?.hostId?.trim() || null,
    source: input?.source?.trim() || null,
  };
}

export function ensureObservabilityHeaders(
  incoming: Headers,
  input?: EnsureHeadersInput
): { headers: Headers; context: ObservabilityContext } {
  const headers = new Headers(incoming);
  const context = createObservabilityContext(headers, input);
  headers.set(OBS_HEADER_CORRELATION_ID, context.correlationId);
  headers.set(OBS_HEADER_TRACE_ID, context.traceId);
  headers.set(OBS_HEADER_SPAN_ID, context.spanId);
  if (!headers.get(OBS_HEADER_REQUEST_ID)) {
    headers.set(OBS_HEADER_REQUEST_ID, context.correlationId);
  }
  return { headers, context };
}

export function contextFromRequest(
  req: Request,
  input?: EnsureHeadersInput
): ObservabilityContext {
  return createObservabilityContext(req.headers, {
    route: input?.route,
    method: input?.method ?? req.method,
    userId: input?.userId,
    hostId: input?.hostId,
    source: input?.source ?? "api",
  });
}

export function applyObservabilityHeaders(
  res: Response,
  context: ObservabilityContext,
  input?: { durationMs?: number }
) {
  res.headers.set(OBS_HEADER_CORRELATION_ID, context.correlationId);
  res.headers.set(OBS_HEADER_TRACE_ID, context.traceId);
  res.headers.set(OBS_HEADER_SPAN_ID, context.spanId);
  res.headers.set(OBS_HEADER_REQUEST_ID, context.correlationId);

  if (typeof input?.durationMs === "number" && Number.isFinite(input.durationMs)) {
    const durationMs = Math.max(0, input.durationMs);
    res.headers.set(OBS_HEADER_RESPONSE_TIME_MS, String(Math.round(durationMs)));
    const timingValue = `app;dur=${durationMs.toFixed(1)}`;
    const existing = res.headers.get("Server-Timing");
    res.headers.set("Server-Timing", existing ? `${existing}, ${timingValue}` : timingValue);
  }
}

export function incrementCounter(
  name: string,
  by = 1,
  labels?: ObservabilityLabels
) {
  const metricName = name.trim();
  if (!metricName) return;
  const state = getState();
  const normalized = normalizeContextLabels(labels);
  const key = metricKey(metricName, normalized);
  const current = state.counters.get(key);
  if (current) {
    current.value += by;
    return;
  }
  state.counters.set(key, {
    name: metricName,
    labels: normalized,
    value: by,
  });
}

export function observeTiming(
  name: string,
  durationMs: number,
  labels?: ObservabilityLabels
) {
  const metricName = name.trim();
  if (!metricName) return;
  const value = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const state = getState();
  const normalized = normalizeContextLabels(labels);
  const key = metricKey(metricName, normalized);
  const current = state.timings.get(key);
  if (current) {
    current.count += 1;
    current.sumMs += value;
    current.lastMs = value;
    current.minMs = Math.min(current.minMs, value);
    current.maxMs = Math.max(current.maxMs, value);
    pushRing(current.samples, value, 400);
    return;
  }
  state.timings.set(key, {
    name: metricName,
    labels: normalized,
    count: 1,
    sumMs: value,
    minMs: value,
    maxMs: value,
    lastMs: value,
    samples: [value],
  });
}

export function logEvent(
  level: ObservabilityLevel,
  message: string,
  context?: ObservabilityContextInput | null,
  fields?: Record<string, unknown>
) {
  const state = getState();
  const entry: ObservabilityLogEntry = {
    ts: nowIso(),
    level,
    message: truncate(message, 220),
    correlationId: context?.correlationId ?? null,
    traceId: context?.traceId ?? null,
    spanId: context?.spanId ?? null,
    route: context?.route ?? null,
    method: context?.method ?? null,
    userId: context?.userId ?? null,
    hostId: context?.hostId ?? null,
    fields: fields ? (sanitizeUnknown(fields) as Record<string, JsonLike>) : null,
  };
  pushRing(state.logs, entry, state.maxLogs);

  const out = JSON.stringify({
    type: "obs.log",
    ...entry,
  });
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export function recordAlertMetadata(input: {
  kind: string;
  severity: "info" | "warn" | "critical";
  title: string;
  correlationId?: string | null;
  traceId?: string | null;
  route?: string | null;
  method?: string | null;
  target?: string | null;
  deliveredOk?: boolean | null;
  status?: number | null;
  detail?: string | null;
}) {
  const state = getState();
  const entry: AlertMetadata = {
    ts: nowIso(),
    kind: truncate(input.kind || "unknown", 48),
    severity: input.severity,
    title: truncate(input.title || "Alert", 220),
    correlationId: input.correlationId ?? null,
    traceId: input.traceId ?? null,
    route: input.route ?? null,
    method: input.method ?? null,
    target: input.target ? truncate(input.target, 180) : null,
    deliveredOk: input.deliveredOk ?? null,
    status: typeof input.status === "number" ? input.status : null,
    detail: input.detail ? truncate(input.detail, 800) : null,
  };
  pushRing(state.alerts, entry, state.maxAlerts);
  incrementCounter("alert.events.total", 1, {
    kind: entry.kind,
    severity: entry.severity,
    deliveredOk:
      entry.deliveredOk === null ? "unknown" : entry.deliveredOk ? "true" : "false",
  });
}

export type StartedTraceSpan = {
  context: ObservabilityContext;
  finish: (
    status?: "ok" | "error",
    attributes?: Record<string, unknown>
  ) => ObservabilityTraceEntry;
};

export function startTraceSpan(
  name: string,
  parent: ObservabilityContext,
  attributes?: Record<string, unknown>
): StartedTraceSpan {
  const started = Date.now();
  const spanContext: ObservabilityContext = {
    ...parent,
    parentSpanId: parent.spanId || null,
    spanId: randomHex(16),
  };
  incrementCounter("trace.spans.started_total", 1, { name });

  return {
    context: spanContext,
    finish: (status = "ok", finalAttributes?: Record<string, unknown>) => {
      const durationMs = Math.max(0, Date.now() - started);
      observeTiming("trace.span.duration_ms", durationMs, {
        name,
        status,
        route: spanContext.route ?? "unknown",
      });
      incrementCounter("trace.spans.finished_total", 1, {
        name,
        status,
      });
      const mergedAttributes = {
        ...(attributes ?? {}),
        ...(finalAttributes ?? {}),
      };
      const entry: ObservabilityTraceEntry = {
        ts: nowIso(),
        name: truncate(name, 120),
        status,
        durationMs,
        correlationId: spanContext.correlationId,
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        parentSpanId: spanContext.parentSpanId,
        route: spanContext.route,
        method: spanContext.method,
        userId: spanContext.userId,
        hostId: spanContext.hostId,
        attributes: Object.keys(mergedAttributes).length
          ? (sanitizeUnknown(mergedAttributes) as Record<string, JsonLike>)
          : null,
      };
      const state = getState();
      pushRing(state.traces, entry, state.maxTraces);
      return entry;
    },
  };
}

export async function runObservedRoute(
  req: Request,
  input: {
    route: string;
    source?: string;
    userId?: string | null;
    hostId?: string | null;
  },
  handler: (context: ObservabilityContext) => Promise<Response>
): Promise<Response> {
  const started = Date.now();
  const baseContext = contextFromRequest(req, {
    route: input.route,
    method: req.method,
    userId: input.userId ?? null,
    hostId: input.hostId ?? null,
    source: input.source ?? "api",
  });

  const span = startTraceSpan(`${req.method.toUpperCase()} ${input.route}`, baseContext, {
    source: input.source ?? "api",
  });

  incrementCounter("api.requests.total", 1, {
    route: input.route,
    method: req.method.toUpperCase(),
  });
  logEvent("info", "api.request.start", span.context, {
    route: input.route,
    method: req.method.toUpperCase(),
  });

  try {
    const res = await handler(span.context);
    const status = res.status;
    const durationMs = Math.max(0, Date.now() - started);
    observeTiming("api.request.duration_ms", durationMs, {
      route: input.route,
      method: req.method.toUpperCase(),
      status,
    });
    incrementCounter("api.requests.by_status.total", 1, {
      route: input.route,
      method: req.method.toUpperCase(),
      status,
    });
    span.finish(status >= 500 ? "error" : "ok", {
      status,
      durationMs,
      route: input.route,
    });
    logEvent(status >= 500 ? "error" : "info", "api.request.complete", span.context, {
      route: input.route,
      method: req.method.toUpperCase(),
      status,
      durationMs,
    });
    applyObservabilityHeaders(res, span.context, { durationMs });
    return res;
  } catch (err: unknown) {
    const durationMs = Math.max(0, Date.now() - started);
    observeTiming("api.request.duration_ms", durationMs, {
      route: input.route,
      method: req.method.toUpperCase(),
      status: 500,
    });
    incrementCounter("api.requests.by_status.total", 1, {
      route: input.route,
      method: req.method.toUpperCase(),
      status: 500,
    });
    const error = err instanceof Error ? err.message : String(err);
    span.finish("error", {
      status: 500,
      durationMs,
      error,
      route: input.route,
    });
    logEvent("error", "api.request.failed", span.context, {
      route: input.route,
      method: req.method.toUpperCase(),
      status: 500,
      durationMs,
      error,
    });
    throw err;
  }
}

export function getObservabilitySnapshot(input?: SnapshotInput): ObservabilitySnapshot {
  const state = getState();
  const countersLimit = clamp(input?.countersLimit ?? 300, 10, 5000);
  const timingsLimit = clamp(input?.timingsLimit ?? 300, 10, 5000);
  const logsLimit = clamp(input?.logsLimit ?? 60, 5, 5000);
  const tracesLimit = clamp(input?.tracesLimit ?? 60, 5, 5000);
  const alertsLimit = clamp(input?.alertsLimit ?? 60, 5, 5000);

  const counters = Array.from(state.counters.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, countersLimit)
    .map((item) => ({
      name: item.name,
      labels: { ...item.labels },
      value: item.value,
    }));

  const timings = Array.from(state.timings.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, timingsLimit)
    .map((item) => ({
      name: item.name,
      labels: { ...item.labels },
      count: item.count,
      sumMs: Number(item.sumMs.toFixed(3)),
      minMs: Number(item.minMs.toFixed(3)),
      maxMs: Number(item.maxMs.toFixed(3)),
      lastMs: Number(item.lastMs.toFixed(3)),
      p50Ms: Number(quantile(item.samples, 0.5).toFixed(3)),
      p95Ms: Number(quantile(item.samples, 0.95).toFixed(3)),
    }));

  const recentLogs = state.logs.slice(-logsLimit);
  const recentTraces = state.traces.slice(-tracesLimit);
  const recentAlerts = state.alerts.slice(-alertsLimit);

  const startedMs = Date.parse(state.startedAtIso);
  const uptimeMs = Number.isFinite(startedMs) ? Math.max(0, Date.now() - startedMs) : 0;

  return {
    generatedAtIso: nowIso(),
    startedAtIso: state.startedAtIso,
    uptimeMs,
    counters,
    timings,
    recentLogs,
    recentTraces,
    recentAlerts,
  };
}

function escapePromLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function promLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  const raw = entries
    .map(([key, value]) => `${key}="${escapePromLabelValue(value)}"`)
    .join(",");
  return `{${raw}}`;
}

export function renderPrometheusMetrics(): string {
  const snapshot = getObservabilitySnapshot({
    countersLimit: 5000,
    timingsLimit: 5000,
    logsLimit: 1,
    tracesLimit: 1,
    alertsLimit: 1,
  });
  const lines: string[] = [];

  lines.push("# HELP vps_obs_counter Generic observability counters.");
  lines.push("# TYPE vps_obs_counter gauge");
  for (const counter of snapshot.counters) {
    const labels = promLabels({
      name: counter.name,
      ...counter.labels,
    });
    lines.push(`vps_obs_counter${labels} ${counter.value}`);
  }

  lines.push("# HELP vps_obs_timing_count Observability timing count.");
  lines.push("# TYPE vps_obs_timing_count gauge");
  lines.push("# HELP vps_obs_timing_sum_ms Observability timing sum milliseconds.");
  lines.push("# TYPE vps_obs_timing_sum_ms gauge");
  lines.push("# HELP vps_obs_timing_min_ms Observability timing minimum milliseconds.");
  lines.push("# TYPE vps_obs_timing_min_ms gauge");
  lines.push("# HELP vps_obs_timing_max_ms Observability timing maximum milliseconds.");
  lines.push("# TYPE vps_obs_timing_max_ms gauge");
  lines.push("# HELP vps_obs_timing_last_ms Observability timing last milliseconds.");
  lines.push("# TYPE vps_obs_timing_last_ms gauge");
  lines.push("# HELP vps_obs_timing_p50_ms Observability timing p50 milliseconds.");
  lines.push("# TYPE vps_obs_timing_p50_ms gauge");
  lines.push("# HELP vps_obs_timing_p95_ms Observability timing p95 milliseconds.");
  lines.push("# TYPE vps_obs_timing_p95_ms gauge");

  for (const timing of snapshot.timings) {
    const labels = promLabels({
      name: timing.name,
      ...timing.labels,
    });
    lines.push(`vps_obs_timing_count${labels} ${timing.count}`);
    lines.push(`vps_obs_timing_sum_ms${labels} ${timing.sumMs}`);
    lines.push(`vps_obs_timing_min_ms${labels} ${timing.minMs}`);
    lines.push(`vps_obs_timing_max_ms${labels} ${timing.maxMs}`);
    lines.push(`vps_obs_timing_last_ms${labels} ${timing.lastMs}`);
    lines.push(`vps_obs_timing_p50_ms${labels} ${timing.p50Ms}`);
    lines.push(`vps_obs_timing_p95_ms${labels} ${timing.p95Ms}`);
  }

  return `${lines.join("\n")}\n`;
}
