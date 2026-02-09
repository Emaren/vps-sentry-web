// /var/www/vps-sentry-web/src/app/api/ops/observability/route.ts
import { NextResponse } from "next/server";

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
    // eslint-disable-next-line no-new
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
  const method = (req as any)?.method ?? "GET";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubGet() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    snapshot: {
      counters: [],
      timings: [],
      recentLogs: [],
      recentTraces: [],
      recentAlerts: [],
    },
    note: "stubbed during build collection",
  });
}

// ---------- helpers ----------

function parseLimit(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [auditMod, obsMod, rbacMod] = await Promise.all([
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/observability").catch(() => ({} as any)),
    import("@/lib/rbac"),
  ]);

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const requireAdminAccess = (rbacMod as any).requireAdminAccess as () => Promise<any>;

  const getObservabilitySnapshot =
    (obsMod as any).getObservabilitySnapshot ??
    (() => ({
      counters: [],
      timings: [],
      recentLogs: [],
      recentTraces: [],
      recentAlerts: [],
    }));

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
    writeAuditLog,
    getObservabilitySnapshot,
    runObservedRoute,
    requireAdminAccess,
  };
}

// ---------- route ----------

export async function GET(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubGet();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/observability", source: "ops-observability" },
    async (obsCtx: any) => {
      const access = await deps.requireAdminAccess();
      if (!access?.ok) {
        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.observability.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/observability",
            status: access?.status ?? 403,
            requiredRole: "admin",
            email: access?.email ?? null,
            role: access?.role ?? null,
          },
        });

        return NextResponse.json(
          { ok: false, error: access?.error ?? "Access denied" },
          { status: typeof access?.status === "number" ? access.status : 403 }
        );
      }

      obsCtx.userId = access.identity.userId;

      // Parse using guaranteed-safe req.url
      const url = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);

      const snapshot = await Promise.resolve(
        deps.getObservabilitySnapshot({
          logsLimit: parseLimit(url.searchParams.get("logs"), 80, 5, 500),
          tracesLimit: parseLimit(url.searchParams.get("traces"), 80, 5, 500),
          alertsLimit: parseLimit(url.searchParams.get("alerts"), 80, 5, 500),
          countersLimit: parseLimit(url.searchParams.get("counters"), 300, 10, 1000),
          timingsLimit: parseLimit(url.searchParams.get("timings"), 300, 10, 1000),
        })
      );

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.observability.view",
        detail: "Observability dashboard snapshot viewed",
        meta: {
          route: "/api/ops/observability",
          counters: Array.isArray(snapshot?.counters) ? snapshot.counters.length : 0,
          timings: Array.isArray(snapshot?.timings) ? snapshot.timings.length : 0,
          logs: Array.isArray(snapshot?.recentLogs) ? snapshot.recentLogs.length : 0,
          traces: Array.isArray(snapshot?.recentTraces) ? snapshot.recentTraces.length : 0,
          alerts: Array.isArray(snapshot?.recentAlerts) ? snapshot.recentAlerts.length : 0,
        },
      });

      return NextResponse.json({ ok: true, snapshot });
    }
  );
}
