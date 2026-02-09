// /var/www/vps-sentry-web/src/app/api/ops/remediate-queue/route.ts
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
      items: [],
      counts: { queued: 0, processing: 0, done: 0, failed: 0, dlq: 0 },
    },
    note: "stubbed during build collection",
  });
}

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    result: {
      ok: true,
      state: null,
      approvalStatus: null,
    },
    note: "stubbed during build collection",
  });
}

// ---------- small helpers ----------

function parseLimit(v: string | null, fallback = 25): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < 1) return 1;
  if (t > 100) return 100;
  return t;
}

function parseBool(v: string | null, fallback = false): boolean {
  if (!v) return fallback;
  const t = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

type ApprovalMode = "approve" | "reject";

function parseApprovalMode(v: unknown): ApprovalMode {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "reject" ? "reject" : "approve";
}

function parseReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length <= 280) return t;
  return `${t.slice(0, 280)}...[truncated ${t.length - 280} chars]`;
}

function statusForApprovalError(error?: string): number {
  if (!error) return 409;
  const lower = error.toLowerCase();
  if (lower.includes("not found")) return 404;
  if (lower.includes("required")) return 400;
  if (lower.includes("invalid")) return 400;
  return 409;
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

  const getRemediationQueueSnapshot = (queueMod as any)
    .getRemediationQueueSnapshot as (input: any) => Promise<any>;

  const setRemediationRunApproval = (queueMod as any)
    .setRemediationRunApproval as (input: any) => Promise<any>;

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
    getRemediationQueueSnapshot,
    setRemediationRunApproval,
    incrementCounter,
    runObservedRoute,
  };
}

// ---------- routes ----------

export async function GET(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubGet();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/remediate-queue", source: "ops-remediate-queue" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.remediate_queue.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.remediate_queue_view.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/remediate-queue",
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

      const url = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);
      const limit = parseLimit(url.searchParams.get("limit"), 25);
      const dlqOnly = parseBool(url.searchParams.get("dlq"), false);

      const snapshot = await deps.getRemediationQueueSnapshot({ limit, dlqOnly });

      deps.incrementCounter("ops.remediate_queue.view.total", 1, {
        dlqOnly: dlqOnly ? "true" : "false",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.remediate_queue_view",
        detail: `Queue snapshot viewed (items=${snapshot?.items?.length ?? 0}, dlqOnly=${dlqOnly})`,
        meta: {
          route: "/api/ops/remediate-queue",
          limit,
          dlqOnly,
          counts: snapshot?.counts ?? null,
        },
      });

      return NextResponse.json({ ok: true, snapshot });
    }
  );
}

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubPost();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/remediate-queue", source: "ops-remediate-queue" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.remediate_queue.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.remediate_queue_approval.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/remediate-queue",
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
      const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
      const mode = parseApprovalMode(body?.mode);
      const reason = parseReason(body?.reason);

      if (!runId) {
        return NextResponse.json({ ok: false, error: "runId is required" }, { status: 400 });
      }

      const result = await deps.setRemediationRunApproval({
        runId,
        actorUserId: access.identity.userId,
        mode,
        reason,
      });

      deps.incrementCounter("ops.remediate_queue.approval.total", 1, {
        mode,
        ok: result?.ok ? "true" : "false",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: result?.ok ? "ops.remediate_queue_approval" : "ops.remediate_queue_approval.failed",
        detail: result?.ok
          ? `run=${runId} mode=${mode} status=${result?.approvalStatus ?? "none"}`
          : `run=${runId} mode=${mode} error=${result?.error ?? "unknown"}`,
        meta: {
          route: "/api/ops/remediate-queue",
          mode,
          runId,
          state: result?.state ?? null,
          approvalStatus: result?.approvalStatus ?? null,
          error: result?.error ?? null,
        },
      });

      if (!result?.ok) {
        return NextResponse.json(
          { ok: false, error: result?.error ?? "Approval failed" },
          { status: statusForApprovalError(result?.error) }
        );
      }

      return NextResponse.json({ ok: true, result });
    }
  );
}
