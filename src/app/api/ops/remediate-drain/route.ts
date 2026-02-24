// /var/www/vps-sentry-web/src/app/api/ops/remediate-drain/route.ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const FALLBACK_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost";

// ---------- build-worker / weird Request hardening ----------

function isBadUrlString(v: unknown): boolean {
  if (typeof v !== "string") return true;
  const s = v.trim();
  if (!s) return true;
  if (s === "[object Object]") return true;
  return false;
}

function canParseUrlString(v: unknown): boolean {
  if (isBadUrlString(v)) return false;
  const s = String(v).trim();
  try {
    new URL(s, FALLBACK_BASE);
    return true;
  } catch {
    return false;
  }
}

function canParseNextUrl(nextUrl: unknown): boolean {
  if (!nextUrl || typeof nextUrl !== "object") return false;
  const anyNext = nextUrl as any;

  if (!isBadUrlString(anyNext?.href)) return canParseUrlString(anyNext.href);

  if (!isBadUrlString(anyNext?.pathname)) {
    const pathname = String(anyNext.pathname).trim();
    const search = typeof anyNext.search === "string" ? anyNext.search : "";
    return canParseUrlString(`${pathname}${search}`);
  }

  return false;
}

function shouldStub(req: Request): boolean {
  if (IS_BUILD_TIME) return true;

  const anyReq = req as any;

  const okUrl = canParseUrlString(anyReq?.url);

  const hasNextUrl = anyReq?.nextUrl !== undefined;
  const okNextUrl = !hasNextUrl ? true : canParseNextUrl(anyReq?.nextUrl);

  return !(okUrl && okNextUrl);
}

function safeUrlString(req: Request): string {
  const anyReq = req as any;

  const raw = anyReq?.url;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s && s !== "[object Object]") return s;
  }

  const href = anyReq?.nextUrl?.href;
  if (typeof href === "string") {
    const s = href.trim();
    if (s && s !== "[object Object]") return s;
  }

  return "/";
}

/**
 * Minimal Request-like object with safe string `url` and no `nextUrl`.
 * Use this when passing req into helpers that might do new URL(req.url).
 */
function makeSafeReq(req: Request): Request {
  const url = safeUrlString(req);
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    authMode: "token",
    drained: {
      ok: true,
      processed: 0,
      requestedLimit: 0,
      errors: [],
    },
    note: "stubbed during build collection",
  });
}

// ---------- auth helper ----------

function hasValidQueueToken(req: Request): boolean {
  const expected = process.env.VPS_REMEDIATE_QUEUE_TOKEN?.trim();
  if (!expected) return false;

  const provided = req.headers.get("x-remediate-queue-token")?.trim();
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function isLoopbackProbeAllowed(): boolean {
  const raw = String(process.env.VPS_REMEDIATE_QUEUE_ALLOW_LOOPBACK_PROBE ?? "1")
    .trim()
    .toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

function normalizeHost(value: string | null): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[::1]")) return "::1";
  return raw.split(":")[0] ?? "";
}

function isLoopbackValue(value: string | null): boolean {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return false;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first === "127.0.0.1" || first === "::1" || first === "localhost";
}

function isTrustedLoopbackProbe(req: Request): boolean {
  if (!isLoopbackProbeAllowed()) return false;

  const host =
    normalizeHost(req.headers.get("host")) ||
    normalizeHost(req.headers.get("x-forwarded-host"));
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;

  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  if (forwardedFor && !isLoopbackValue(forwardedFor)) return false;
  if (realIp && !isLoopbackValue(realIp)) return false;
  if (cfIp && !isLoopbackValue(cfIp)) return false;

  return true;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const t = Math.trunc(v);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, queueMod, auditMod, obsMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/remediate/queue"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;
  const drainRemediationQueue = (queueMod as any).drainRemediationQueue as (input: any) => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const incrementCounter = (obsMod as any).incrementCounter ?? (() => {});
  const runObservedRoute =
    (obsMod as any).runObservedRoute ??
    (async (_req: Request, _meta: any, handler: (ctx: any) => Promise<Response>) => {
      return handler({
        correlationId: "fallback",
        traceId: "fallback",
        spanId: "fallback",
        parentSpanId: null,
        route: _meta?.route ?? null,
        method: (_req as any)?.method ?? null,
        userId: null,
        hostId: null,
        source: _meta?.source ?? null,
      });
    });

  return {
    requireOpsAccess,
    drainRemediationQueue,
    writeAuditLog,
    incrementCounter,
    runObservedRoute,
  };
}

// ---------- route ----------

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubPost();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/remediate-drain", source: "ops-remediate-drain" },
    async (obsCtx: any) => {
      let actorUserId: string | null = null;
      let authMode: "token" | "ops" | "loopback" = "token";

      if (!hasValidQueueToken(req)) {
        if (isTrustedLoopbackProbe(req)) {
          authMode = "loopback";
        } else {
          const access = await deps.requireOpsAccess();
          if (!access?.ok) {
            deps.incrementCounter("ops.remediate_drain.denied.total", 1, {
              status: String(access?.status ?? 403),
            });

            await deps.writeAuditLog({
              req: safeReq,
              action: "ops.remediate_queue_drain.denied",
              detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
              meta: {
                route: "/api/ops/remediate-drain",
                status: access?.status ?? 403,
                requiredRole: "ops",
                email: access?.email ?? null,
                role: access?.role ?? null,
              },
            });

            return NextResponse.json(
              { ok: false, error: access?.error ?? "Access denied" },
              { status: typeof access?.status === "number" ? access.status : 403 }
            );
          }

          actorUserId = access.identity.userId;
          obsCtx.userId = actorUserId;
          authMode = "ops";
        }
      }

      const body: any = await req.json().catch(() => ({}));
      const limitRaw = Number(body?.limit ?? 5);
      const limit = clampInt(Number.isFinite(limitRaw) ? limitRaw : 5, 1, 50);

      const drained = await deps.drainRemediationQueue({ limit });

      deps.incrementCounter("ops.remediate_drain.total", 1, {
        authMode,
        ok: drained?.ok ? "true" : "false",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: actorUserId,
        action: "ops.remediate_queue_drain",
        detail: `Processed ${drained?.processed ?? 0}/${drained?.requestedLimit ?? limit} queued run(s)`,
        meta: {
          route: "/api/ops/remediate-drain",
          authMode,
          processed: drained?.processed ?? 0,
          requestedLimit: drained?.requestedLimit ?? limit,
          ok: Boolean(drained?.ok),
        },
      });

      return NextResponse.json({
        ok: true,
        authMode,
        drained,
      });
    }
  );
}
