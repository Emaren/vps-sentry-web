// /var/www/vps-sentry-web/src/app/api/notify/test/route.ts
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

type NotifyKind = "EMAIL" | "WEBHOOK";

function normalizeKind(v: unknown): NotifyKind | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  if (t === "EMAIL" || t === "WEBHOOK") return t;
  return null;
}

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
    // absolute or relative
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
 * Some libs might do new URL(req.url) or similar. Give them a minimal Request-like
 * object with a guaranteed-safe string `url` and no `nextUrl`.
 */
function makeSafeReq(req: Request): Request {
  const url = safeUrlString(req);
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

function stubResponse() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    attempted: 0,
    delivered: 0,
    failed: 0,
    usedFallback: false,
    attempts: [],
    note: "stubbed during build collection",
  });
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, notifyMod, prismaMod, obsMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/notify"),
    import("@/lib/prisma"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const dispatchNotifyTest = (notifyMod as any).dispatchNotifyTest as (input: any) => Promise<any>;
  const inferNotifyKindFromTarget = (notifyMod as any)
    .inferNotifyKindFromTarget as (target: string) => NotifyKind | null;

  const prisma = (prismaMod as any).prisma as any;

  const incrementCounter = (obsMod as any).incrementCounter ?? (() => {});
  const logEvent = (obsMod as any).logEvent ?? (() => {});
  const runObservedRoute =
    (obsMod as any).runObservedRoute ??
    (async (_req: Request, _meta: any, handler: (ctx: any) => Promise<Response>) => {
      // minimal obs context fallback
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
    writeAuditLog,
    dispatchNotifyTest,
    inferNotifyKindFromTarget,
    prisma,
    incrementCounter,
    logEvent,
    runObservedRoute,
  };
}

// ---------- route ----------

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubResponse();

  const deps = await loadDeps();

  return deps.runObservedRoute(
    req,
    { route: "/api/notify/test", source: "notify-test" },
    async (obsCtx: any) => {
      const safeReq = makeSafeReq(req);

      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("notify.test.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "notify.test.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/notify/test",
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

      obsCtx.userId = access.identity.userId;

      const body: any = await req.json().catch(() => ({}));
      const target = typeof body?.target === "string" ? body.target.trim() : "";
      const hostId = typeof body?.hostId === "string" ? body.hostId.trim() : "";
      const kind = normalizeKind(body?.kind);
      const inferredKind = target ? deps.inferNotifyKindFromTarget(target) : null;

      if (target && !kind && !inferredKind) {
        deps.incrementCounter("notify.test.invalid_target.total", 1);
        return NextResponse.json(
          {
            ok: false,
            error:
              "Unable to infer target kind. Provide kind=EMAIL|WEBHOOK or a valid email/http(s) target.",
          },
          { status: 400 }
        );
      }

      if (hostId) {
        const host = await deps.prisma.host.findUnique({
          where: { id: hostId },
          select: { id: true },
        });
        if (!host) {
          deps.incrementCounter("notify.test.host_not_found.total", 1);
          return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });
        }
        obsCtx.hostId = host.id;
      }

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "notify.test.invoked",
        detail: `Notify test invoked by ${access.identity.email}`,
        meta: {
          route: "/api/notify/test",
          hostId: hostId || null,
          kind: kind ?? inferredKind ?? null,
          hasTarget: Boolean(target),
        },
      });

      try {
        const result = await deps.dispatchNotifyTest({
          userId: access.identity.userId,
          requestedByEmail: access.identity.email,
          hostId: hostId || null,
          kind: kind ?? inferredKind ?? null,
          target: target || null,
          title: typeof body?.title === "string" ? body.title : null,
          detail: typeof body?.detail === "string" ? body.detail : null,
          observability: {
            correlationId: obsCtx.correlationId,
            traceId: obsCtx.traceId,
            route: obsCtx.route,
            method: obsCtx.method,
          },
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          hostId: hostId || null,
          action: "notify.test.result",
          detail: `attempted=${result.attempted} delivered=${result.delivered} failed=${result.failed}`,
          meta: {
            route: "/api/notify/test",
            attempted: result.attempted,
            delivered: result.delivered,
            failed: result.failed,
            usedFallback: result.usedFallback,
          },
        });

        deps.incrementCounter("notify.test.attempts.total", Number(result.attempted ?? 0), {
          ok: result.ok ? "true" : "false",
        });

        deps.logEvent(result.ok ? "info" : "warn", "notify.test.complete", obsCtx, {
          attempted: result.attempted,
          delivered: result.delivered,
          failed: result.failed,
        });

        return NextResponse.json({
          ok: result.ok,
          title: result.title,
          detail: result.detail,
          attempted: result.attempted,
          delivered: result.delivered,
          failed: result.failed,
          usedFallback: result.usedFallback,
          attempts: result.attempts,
          note: result.ok ? "notify test completed" : "notify test completed with failures",
        });
      } catch (err: unknown) {
        deps.incrementCounter("notify.test.errors.total", 1);
        const message = err instanceof Error ? err.message : String(err);

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          hostId: hostId || null,
          action: "notify.test.failed",
          detail: message,
          meta: { route: "/api/notify/test" },
        });

        deps.logEvent("error", "notify.test.failed", obsCtx, { error: message });

        return NextResponse.json({ ok: false, error: message }, { status: 500 });
      }
    }
  );
}
