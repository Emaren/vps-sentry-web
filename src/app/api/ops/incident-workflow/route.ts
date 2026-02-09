// /var/www/vps-sentry-web/src/app/api/ops/incident-workflow/route.ts
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
    workflows: [],
    note: "stubbed during build collection",
  });
}

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    error: null,
    workflow: null,
    step: null,
    result: null,
    note: "stubbed during build collection",
  });
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, workflowsMod, execMod, obsMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/ops/workflows"),
    import("@/lib/ops/workflow-executor"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const INCIDENT_WORKFLOWS = (workflowsMod as any).INCIDENT_WORKFLOWS ?? [];

  const resolveWorkflowStepInput = (execMod as any).resolveWorkflowStepInput as (input: any) => any;
  const executeWorkflowApiStep = (execMod as any).executeWorkflowApiStep as (input: any) => Promise<any>;

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
    INCIDENT_WORKFLOWS,
    resolveWorkflowStepInput,
    executeWorkflowApiStep,
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
    { route: "/api/ops/incident-workflow", source: "ops-incident-workflow" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incident_workflow.list.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incident_workflow.list.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incident-workflow",
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

      deps.incrementCounter("ops.incident_workflow.list.total", 1, {
        role: String(access.identity.role ?? "unknown"),
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.incident_workflow.list",
        detail: "Incident workflow catalog viewed",
        meta: {
          route: "/api/ops/incident-workflow",
          count: Array.isArray(deps.INCIDENT_WORKFLOWS) ? deps.INCIDENT_WORKFLOWS.length : 0,
        },
      });

      return NextResponse.json({
        ok: true,
        workflows: deps.INCIDENT_WORKFLOWS,
      });
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
    { route: "/api/ops/incident-workflow", source: "ops-incident-workflow" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incident_workflow.step.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incident_workflow.step.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incident-workflow",
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

      const resolved = deps.resolveWorkflowStepInput({
        workflowId: body?.workflowId,
        stepId: body?.stepId,
        payload: body?.payload,
      });

      if (!resolved?.ok) {
        return NextResponse.json(
          { ok: false, error: resolved?.error ?? "Invalid workflow step input" },
          { status: typeof resolved?.status === "number" ? resolved.status : 400 }
        );
      }

      if (resolved.step?.kind !== "api" || !resolved.step?.action) {
        return NextResponse.json(
          { ok: false, error: "Step is manual-only and cannot be executed by API" },
          { status: 400 }
        );
      }

      const execution = await deps.executeWorkflowApiStep({
        workflow: resolved.workflow,
        step: resolved.step,
        payload: resolved.payload,
        actor: {
          userId: access.identity.userId,
          email: access.identity.email,
          observability: {
            correlationId: obsCtx.correlationId,
            traceId: obsCtx.traceId,
            route: obsCtx.route,
            method: obsCtx.method,
          },
        },
      });

      deps.incrementCounter("ops.incident_workflow.step.total", 1, {
        workflowId: String(resolved.workflow?.id ?? "unknown"),
        stepId: String(resolved.step?.id ?? "unknown"),
        ok: execution?.ok ? "true" : "false",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: execution?.ok
          ? "ops.incident_workflow.step"
          : "ops.incident_workflow.step.failed",
        detail: execution?.ok
          ? `Executed ${resolved.workflow.id}/${resolved.step.id}`
          : `Execution failed for ${resolved.workflow.id}/${resolved.step.id}: ${execution?.error ?? "unknown"}`,
        meta: {
          route: "/api/ops/incident-workflow",
          workflowId: resolved.workflow.id,
          stepId: resolved.step.id,
          action: resolved.step.action,
          ok: Boolean(execution?.ok),
        },
      });

      return NextResponse.json({
        ok: Boolean(execution?.ok),
        error: execution?.error ?? null,
        workflow: execution?.workflow ?? null,
        step: execution?.step ?? null,
        result: execution?.result ?? null,
      });
    }
  );
}
