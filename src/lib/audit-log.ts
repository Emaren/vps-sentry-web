import { prisma } from "@/lib/prisma";

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

  try {
    await prisma.auditLog.create({
      data: {
        action: truncate(action, 120),
        detail: detail ? truncate(detail, MAX_DETAIL_LEN) : null,
        userId: input.userId ?? null,
        hostId: input.hostId ?? null,
        metaJson: stringifyMeta(input.meta),
        ip: extractIp(input.req),
        userAgent: extractUserAgent(input.req),
      },
    });
  } catch (err) {
    // Do not block request flow if audit persistence fails.
    console.error("[audit-log] write failed:", err);
  }
}
