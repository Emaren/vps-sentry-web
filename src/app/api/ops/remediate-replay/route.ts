// /var/www/vps-sentry-web/src/app/api/ops/remediate-replay/route.ts
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
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    mode: "single",
    summary: null,
    replayed: null,
    note: "stubbed during build collection",
  });
}

// ---------- helpers ----------

function parseLimit(v: unknown, fallback = 3): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < 1) return 1;
  if (t > 50) return 50;
  return t;
}

type ReplayMode = "single" | "dlq-batch";

function normalizeMode(v: unknown): ReplayMode {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "dlq-batch") return "dlq-batch";
  return "single";
}

function toTrimmedString(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, queueMod, obsMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/remediate/queue"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const replayDeadLetterRuns = (queueMod as any).replayDeadLetterRuns as (input: any) => Promise<any>;
  const replayRemediationRun = (queueMod as any).replayRemediationRun as (input: any) => Promise<any>;

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
    writeAuditLog,
    replayDeadLetterRuns,
    replayRemediationRun,
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
    { route: "/api/ops/remediate-replay", source: "ops-remediate-replay" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.remediate_replay.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.remediate_replay.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/remediate-replay",
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
      const mode = normalizeMode(body?.mode);

      if (mode === "dlq-batch") {
        const limit = parseLimit(body?.limit, 3);
        const summary = await deps.replayDeadLetterRuns({
          limit,
          replayedByUserId: access.identity.userId,
        });

        deps.incrementCounter("ops.remediate_replay.batch.total", 1, {
          ok: summary?.ok ? "true" : "false",
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.remediate_replay.batch",
          detail: `DLQ replay batch requested (replayed=${summary?.replayed ?? 0}, skipped=${summary?.skipped ?? 0})`,
          meta: {
            route: "/api/ops/remediate-replay",
            mode,
            limit,
            replayed: summary?.replayed ?? 0,
            skipped: summary?.skipped ?? 0,
            ok: Boolean(summary?.ok),
          },
        });

        return NextResponse.json(
          { ok: Boolean(summary?.ok), mode, summary },
          { status: summary?.ok ? 200 : 409 }
        );
      }

      const runId =
        toTrimmedString(body?.runId, 128) ??
        toTrimmedString(body?.id, 128) ??
        toTrimmedString(body?.sourceRunId, 128) ??
        "";

      if (!runId) {
        return NextResponse.json(
          { ok: false, error: "runId is required for single replay mode" },
          { status: 400 }
        );
      }

      const replayed = await deps.replayRemediationRun({
        runId,
        replayedByUserId: access.identity.userId,
      });

      deps.incrementCounter("ops.remediate_replay.single.total", 1, {
        ok: replayed?.ok ? "true" : "false",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: replayed?.ok ? "ops.remediate_replay.single" : "ops.remediate_replay.single.failed",
        detail: replayed?.ok
          ? `Replay queued for source run ${runId}`
          : `Replay failed for source run ${runId}: ${replayed?.error ?? "unknown"}`,
        meta: {
          route: "/api/ops/remediate-replay",
          mode,
          sourceRunId: runId,
          replayRunId: replayed?.replayRunId ?? null,
          ok: Boolean(replayed?.ok),
        },
      });

      if (!replayed?.ok) {
        return NextResponse.json(
          { ok: false, error: replayed?.error ?? "Replay failed" },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode,
        replayed,
      });
    }
  );
}
