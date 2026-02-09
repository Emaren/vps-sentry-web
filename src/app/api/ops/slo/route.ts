// /var/www/vps-sentry-web/src/app/api/ops/slo/route.ts
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

function toAbsoluteUrlString(u: string): string {
  const s = String(u ?? "/").trim() || "/";
  try {
    return new URL(s).toString();
  } catch {
    return new URL(s, FALLBACK_BASE).toString();
  }
}

/**
 * Minimal Request-like object with safe *absolute* string `url` and no `nextUrl`.
 * Use this when passing req into helpers that might do new URL(req.url).
 */
function makeSafeReq(req: Request): Request {
  const url = toAbsoluteUrlString(safeUrlString(req));
  const method = (req as any)?.method ?? "GET";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubGet() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    authMode: "token",
    summary: "stubbed during build collection",
    snapshot: {
      burn: {
        severity: "none",
        route: null,
        shouldAlert: false,
        affectedObjectives: [],
        reason: "buildPhase",
      },
    },
    note: "stubbed during build collection",
  });
}

// ---------- original auth helpers ----------

function hasValidSloToken(req: Request): boolean {
  const expected = process.env.VPS_SLO_TOKEN?.trim();
  if (!expected) return false;

  const provided = req.headers.get("x-slo-token")?.trim();
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function isLoopbackProbeAllowed(): boolean {
  const raw = String(process.env.VPS_SLO_ALLOW_LOOPBACK_PROBE ?? "1")
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

function parseWindowHoursFromUrl(urlStr: string): number | undefined {
  try {
    const u = new URL(urlStr, FALLBACK_BASE);
    const raw = u.searchParams.get("windowHours");
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    const value = Math.trunc(n);
    if (value < 1) return 1;
    if (value > 24 * 30) return 24 * 30;
    return value;
  } catch {
    return undefined;
  }
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [auditMod, obsMod, rbacMod, sloMod] = await Promise.all([
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/observability").catch(() => ({} as any)),
    import("@/lib/rbac"),
    import("@/lib/slo"),
  ]);

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

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  const buildSloSnapshot = (sloMod as any).buildSloSnapshot as (input: any) => Promise<any>;
  const formatSloSummary = (sloMod as any).formatSloSummary as (snapshot: any) => string;

  return {
    writeAuditLog,
    incrementCounter,
    runObservedRoute,
    requireOpsAccess,
    buildSloSnapshot,
    formatSloSummary,
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
    { route: "/api/ops/slo", source: "ops-slo" },
    async (obsCtx: any) => {
      let actorUserId: string | null = null;
      let authMode: "token" | "ops" | "loopback" = "token";

      // Use *original* req for token/loopback checks (headers), but only after shouldStub passed.
      if (!hasValidSloToken(req)) {
        if (isTrustedLoopbackProbe(req)) {
          authMode = "loopback";
        } else {
          const access = await deps.requireOpsAccess();
          if (!access?.ok) {
            deps.incrementCounter("ops.slo.denied.total", 1, {
              status: String(access?.status ?? 403),
            });

            await deps.writeAuditLog({
              req: safeReq,
              action: "ops.slo.denied",
              detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
              meta: {
                route: "/api/ops/slo",
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

      const windowHours = parseWindowHoursFromUrl(String((safeReq as any).url ?? "/"));

      const snapshot = await deps.buildSloSnapshot({ windowHours });
      const summary = deps.formatSloSummary(snapshot);

      deps.incrementCounter("ops.slo.view.total", 1, {
        authMode,
        severity: String(snapshot?.burn?.severity ?? "unknown"),
        route: String(snapshot?.burn?.route ?? "unknown"),
        shouldAlert: snapshot?.burn?.shouldAlert ? "true" : "false",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: actorUserId,
        action: "ops.slo.view",
        detail: summary,
        meta: {
          route: "/api/ops/slo",
          authMode,
          severity: snapshot?.burn?.severity ?? null,
          shouldAlert: Boolean(snapshot?.burn?.shouldAlert),
          alertRoute: snapshot?.burn?.route ?? null,
          affectedObjectives: snapshot?.burn?.affectedObjectives ?? null,
          reason: snapshot?.burn?.reason ?? null,
          windowHours: windowHours ?? null,
        },
      });

      return NextResponse.json({
        ok: true,
        authMode,
        summary,
        snapshot,
      });
    }
  );
}
