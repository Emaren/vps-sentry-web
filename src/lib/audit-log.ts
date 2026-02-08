import { prisma } from "@/lib/prisma";
import {
  contextFromRequest,
  incrementCounter,
  logEvent,
  observeTiming,
} from "@/lib/observability";

const MAX_DETAIL_LEN = 600;
const MAX_META_LEN = 6000;
const MAX_USER_AGENT_LEN = 240;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...[truncated ${s.length - max} chars]`;
}

function stringifyMeta(meta: unknown): string | null {
  if (meta === undefined) return null;

  try {
    const raw = JSON.stringify(
      meta,
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      0
    );
    if (!raw) return null;
    return truncate(raw, MAX_META_LEN);
  } catch {
    return truncate(String(meta), MAX_META_LEN);
  }
}

function mergeMetaWithObservability(
  req: Request | undefined,
  meta: unknown,
  action: string
): unknown {
  if (!req) return meta;
  const obs = contextFromRequest(req, {
    source: "audit-log",
    route: new URL(req.url).pathname,
    method: req.method,
  });
  const baseMeta: Record<string, unknown> =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? { ...(meta as Record<string, unknown>) }
      : { inputMeta: meta ?? null };

  return {
    ...baseMeta,
    observability: {
      correlationId: obs.correlationId,
      traceId: obs.traceId,
      spanId: obs.spanId,
      route: obs.route,
      method: obs.method,
      action,
    },
  };
}

function extractIp(req?: Request): string | null {
  if (!req) return null;

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  return null;
}

function extractUserAgent(req?: Request): string | null {
  if (!req) return null;
  const ua = req.headers.get("user-agent")?.trim();
  if (!ua) return null;
  return truncate(ua, MAX_USER_AGENT_LEN);
}

export type AuditInput = {
  action: string;
  detail?: string;
  userId?: string | null;
  hostId?: string | null;
  req?: Request;
  meta?: unknown;
};

export async function writeAuditLog(input: AuditInput): Promise<void> {
  const action = input.action.trim();
  if (!action) return;

  const detail = input.detail?.trim();
  const started = Date.now();

  try {
    await prisma.auditLog.create({
      data: {
        action: truncate(action, 120),
        detail: detail ? truncate(detail, MAX_DETAIL_LEN) : null,
        userId: input.userId ?? null,
        hostId: input.hostId ?? null,
        metaJson: stringifyMeta(mergeMetaWithObservability(input.req, input.meta, action)),
        ip: extractIp(input.req),
        userAgent: extractUserAgent(input.req),
      },
    });
    incrementCounter("audit.write.success.total", 1, {
      action: truncate(action, 80),
    });
    observeTiming("audit.write.duration_ms", Date.now() - started, {
      ok: "true",
    });
  } catch (err) {
    incrementCounter("audit.write.failure.total", 1, {
      action: truncate(action, 80),
    });
    observeTiming("audit.write.duration_ms", Date.now() - started, {
      ok: "false",
    });
    const obs = input.req
      ? contextFromRequest(input.req, {
          source: "audit-log",
          route: new URL(input.req.url).pathname,
          method: input.req.method,
        })
      : null;
    logEvent("error", "audit.write.failed", obs, {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    // Do not block request flow if audit persistence fails.
    console.error("[audit-log] write failed:", err);
  }
}
