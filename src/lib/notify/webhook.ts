import { incrementCounter, logEvent, observeTiming } from "@/lib/observability";

const DEFAULT_WEBHOOK_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_DETAIL = 1_000;

type SendWebhookInput = {
  url: string;
  payload: unknown;
  headers?: Record<string, string>;
  metadata?: {
    correlationId?: string | null;
    traceId?: string | null;
    route?: string | null;
    method?: string | null;
  };
};

export type SendWebhookResult =
  | { ok: true; status: number; detail?: string }
  | { ok: false; status?: number; error: string; detail?: string };

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...[truncated ${s.length - max} chars]`;
}

function parseTimeoutMs(raw: string | undefined): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WEBHOOK_TIMEOUT_MS;
  return Math.max(1000, Math.min(60_000, Math.trunc(n)));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeHeaders(raw: Record<string, string> | undefined): HeadersInit {
  const out: Record<string, string> = {
    "content-type": "application/json",
  };
  if (!raw) return out;

  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim();
    const value = v.trim();
    if (!key || !value) continue;
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) continue;
    out[key] = value.slice(0, 800);
  }
  return out;
}

export async function sendWebhookNotification(input: SendWebhookInput): Promise<SendWebhookResult> {
  const started = Date.now();
  const obsCtx = {
    correlationId: input.metadata?.correlationId ?? null,
    traceId: input.metadata?.traceId ?? null,
    spanId: null,
    route: input.metadata?.route ?? null,
    method: input.metadata?.method ?? null,
    userId: null,
    hostId: null,
  };
  incrementCounter("notify.webhook.send.attempt.total", 1);

  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    incrementCounter("notify.webhook.send.failure.total", 1, { reason: "invalid_url" });
    observeTiming("notify.webhook.send.duration_ms", Date.now() - started, {
      ok: "false",
      reason: "invalid_url",
    });
    return { ok: false, error: "Invalid webhook URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    incrementCounter("notify.webhook.send.failure.total", 1, { reason: "invalid_protocol" });
    observeTiming("notify.webhook.send.duration_ms", Date.now() - started, {
      ok: "false",
      reason: "invalid_protocol",
    });
    return { ok: false, error: "Webhook URL must use http or https" };
  }

  const timeoutMs = parseTimeoutMs(process.env.VPS_NOTIFY_WEBHOOK_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: safeHeaders(input.headers),
      body: JSON.stringify(input.payload),
      signal: controller.signal,
      cache: "no-store",
    });

    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      incrementCounter("notify.webhook.send.failure.total", 1, {
        reason: "http_error",
        status: res.status,
      });
      observeTiming("notify.webhook.send.duration_ms", Date.now() - started, {
        ok: "false",
        reason: "http_error",
        status: res.status,
      });
      logEvent("warn", "notify.webhook.http_error", obsCtx, {
        url: url.toString(),
        status: res.status,
        detail: bodyText ? truncate(bodyText, MAX_RESPONSE_DETAIL) : null,
      });
      return {
        ok: false,
        status: res.status,
        error: `Webhook HTTP ${res.status}`,
        detail: bodyText ? truncate(bodyText, MAX_RESPONSE_DETAIL) : undefined,
      };
    }

    incrementCounter("notify.webhook.send.success.total", 1, {
      status: res.status,
    });
    observeTiming("notify.webhook.send.duration_ms", Date.now() - started, {
      ok: "true",
      status: res.status,
    });
    logEvent("info", "notify.webhook.sent", obsCtx, {
      url: url.toString(),
      status: res.status,
    });
    return {
      ok: true,
      status: res.status,
      detail: bodyText ? truncate(bodyText, MAX_RESPONSE_DETAIL) : undefined,
    };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    if (msg.toLowerCase().includes("abort")) {
      incrementCounter("notify.webhook.send.failure.total", 1, { reason: "timeout" });
      observeTiming("notify.webhook.send.duration_ms", Date.now() - started, {
        ok: "false",
        reason: "timeout",
      });
      logEvent("warn", "notify.webhook.timeout", obsCtx, {
        url: url.toString(),
      });
      return { ok: false, error: "Webhook timeout" };
    }
    incrementCounter("notify.webhook.send.failure.total", 1, { reason: "request_failed" });
    observeTiming("notify.webhook.send.duration_ms", Date.now() - started, {
      ok: "false",
      reason: "request_failed",
    });
    logEvent("warn", "notify.webhook.request_failed", obsCtx, {
      url: url.toString(),
      error: msg,
    });
    return { ok: false, error: "Webhook request failed", detail: msg };
  } finally {
    clearTimeout(timer);
  }
}
