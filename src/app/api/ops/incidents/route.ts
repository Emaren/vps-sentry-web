// /var/www/vps-sentry-web/src/app/api/ops/incidents/route.ts
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
      incidents: [],
      filters: {},
      counts: {},
    },
    note: "stubbed during build collection",
  });
}

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    action: "stub",
    note: "stubbed during build collection",
  });
}

// ---------- helpers ----------

function parseLimit(v: string | null, fallback = 30, min = 1, max = 200): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function parseBool(v: string | null, fallback = false): boolean {
  if (!v) return fallback;
  const t = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

function toEngineError(deps: Awaited<ReturnType<typeof loadDeps>>, err: unknown): any {
  const IncidentEngineError = deps.IncidentEngineError as any;
  if (IncidentEngineError && err instanceof IncidentEngineError) return err;
  return new (IncidentEngineError ?? Error)(500, err instanceof Error ? err.message : String(err));
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, obsMod, engineMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/observability").catch(() => ({} as any)),
    import("@/lib/ops/incident-engine"),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

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
    writeAuditLog,
    incrementCounter,
    runObservedRoute,

    IncidentEngineError: (engineMod as any).IncidentEngineError as any,
    createIncidentRun: (engineMod as any).createIncidentRun as (input: any) => Promise<any>,
    listIncidentRuns: (engineMod as any).listIncidentRuns as (input: any) => Promise<any>,
    normalizeIncidentSeverity: (engineMod as any).normalizeIncidentSeverity as (v: any, fb: any) => any,
    normalizeIncidentStateFilter: (engineMod as any).normalizeIncidentStateFilter as (v: any, fb: any) => any,
    runIncidentEscalationSweep: (engineMod as any).runIncidentEscalationSweep as (input: any) => Promise<any>,
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
    { route: "/api/ops/incidents", source: "ops-incidents" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incidents.list.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incidents.list.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents",
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

      // Parse using the guaranteed-safe req.url
      const url = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);

      const stateRaw = url.searchParams.get("state");
      const state = deps.normalizeIncidentStateFilter(stateRaw, null);
      if (stateRaw && !state) {
        return NextResponse.json({ ok: false, error: "Invalid state filter" }, { status: 400 });
      }

      const snapshot = await deps.listIncidentRuns({
        limit: parseLimit(url.searchParams.get("limit"), 30, 1, 200),
        state,
        hostId: url.searchParams.get("hostId"),
        assigneeUserId: url.searchParams.get("assigneeUserId"),
        includeClosed: parseBool(url.searchParams.get("includeClosed"), false),
      });

      deps.incrementCounter("ops.incidents.list.total", 1, {
        state: state ?? "default",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.incidents.list",
        detail: `Incident list viewed (rows=${snapshot?.incidents?.length ?? 0})`,
        meta: {
          route: "/api/ops/incidents",
          filters: snapshot?.filters ?? null,
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
    { route: "/api/ops/incidents", source: "ops-incidents" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incidents.mutate.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incidents.mutate.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents",
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
      const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "create";

      if (action === "escalation-sweep") {
        const summary = await deps.runIncidentEscalationSweep({
          actorUserId: access.identity.userId,
          limit: parseLimit(String(body?.limit ?? "25"), 25, 1, 200),
        });

        deps.incrementCounter("ops.incidents.escalation_sweep.total", 1, {
          escalated: (summary?.escalated ?? 0) > 0 ? "true" : "false",
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.incidents.escalation_sweep",
          detail: `Escalation sweep ran (escalated=${summary?.escalated ?? 0})`,
          meta: {
            route: "/api/ops/incidents",
            summary,
          },
        });

        return NextResponse.json({ ok: true, action, summary });
      }

      if (action !== "create") {
        return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
      }

      try {
        const severity =
          body?.severity === undefined ? null : deps.normalizeIncidentSeverity(body.severity, null);

        if (body?.severity !== undefined && !severity) {
          return NextResponse.json({ ok: false, error: "Invalid severity" }, { status: 400 });
        }

        const incident = await deps.createIncidentRun({
          workflowId: typeof body?.workflowId === "string" ? body.workflowId : "",
          title: typeof body?.title === "string" ? body.title : null,
          summary: typeof body?.summary === "string" ? body.summary : null,
          severity,
          triggerSignal: typeof body?.triggerSignal === "string" ? body.triggerSignal : null,
          hostId: typeof body?.hostId === "string" ? body.hostId : null,
          createdByUserId: access.identity.userId,
          assigneeUserId: typeof body?.assigneeUserId === "string" ? body.assigneeUserId : null,
          assigneeEmail: typeof body?.assigneeEmail === "string" ? body.assigneeEmail : null,
          ackDueMinutes: typeof body?.ackDueMinutes === "number" ? body.ackDueMinutes : null,
          escalationEveryMinutes:
            typeof body?.escalationEveryMinutes === "number" ? body.escalationEveryMinutes : null,
          initialNote: typeof body?.initialNote === "string" ? body.initialNote : null,
        });

        deps.incrementCounter("ops.incidents.create.total", 1, {
          workflowId: String(incident?.workflowId ?? "unknown"),
          severity: String(incident?.severity ?? "unknown"),
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          hostId: incident?.host?.id ?? null,
          action: "ops.incidents.create",
          detail: `Created incident ${incident.id} (${incident.workflowId})`,
          meta: {
            route: "/api/ops/incidents",
            incidentId: incident.id,
            workflowId: incident.workflowId,
            severity: incident.severity,
            hostId: incident?.host?.id ?? null,
          },
        });

        return NextResponse.json({ ok: true, action, incident }, { status: 201 });
      } catch (err: unknown) {
        const engineErr = toEngineError(deps, err);
        const status = typeof engineErr?.status === "number" ? engineErr.status : 500;
        const message = typeof engineErr?.message === "string" ? engineErr.message : String(err);

        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
  );
}
