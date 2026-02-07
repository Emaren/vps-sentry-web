const DEFAULT_WEBHOOK_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_DETAIL = 1_000;

type SendWebhookInput = {
  url: string;
  payload: unknown;
  headers?: Record<string, string>;
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
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, error: "Invalid webhook URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
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
      return {
        ok: false,
        status: res.status,
        error: `Webhook HTTP ${res.status}`,
        detail: bodyText ? truncate(bodyText, MAX_RESPONSE_DETAIL) : undefined,
      };
    }

    return {
      ok: true,
      status: res.status,
      detail: bodyText ? truncate(bodyText, MAX_RESPONSE_DETAIL) : undefined,
    };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    if (msg.toLowerCase().includes("abort")) {
      return { ok: false, error: "Webhook timeout" };
    }
    return { ok: false, error: "Webhook request failed", detail: msg };
  } finally {
    clearTimeout(timer);
  }
}
