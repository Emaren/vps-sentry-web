// /var/www/vps-sentry-web/src/app/api/ops/incidents/[incidentId]/route.ts
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
    incident: null,
    note: "stubbed during build collection",
  });
}

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    action: "stub",
    incident: null,
    note: "stubbed during build collection",
  });
}

// ---------- helpers ----------

function parseLimit(v: string | null, fallback = 120, min = 1, max = 600): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

async function readIncidentIdFromCtx(ctx: any): Promise<string | null> {
  try {
    const params = ctx?.params;
    if (!params) return null;

    // handle both sync params and (older/custom) Promise params
    const resolved = typeof params?.then === "function" ? await params : params;
    const v = resolved?.incidentId;

    if (typeof v === "string") {
      const t = v.trim();
      return t ? t : null;
    }
    return null;
  } catch {
    return null;
  }
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

    acknowledgeIncidentRun: (engineMod as any).acknowledgeIncidentRun as (input: any) => Promise<any>,
    addIncidentNote: (engineMod as any).addIncidentNote as (input: any) => Promise<any>,
    assignIncidentRun: (engineMod as any).assignIncidentRun as (input: any) => Promise<any>,
    closeIncidentRun: (engineMod as any).closeIncidentRun as (input: any) => Promise<any>,
    executeIncidentWorkflowStep: (engineMod as any).executeIncidentWorkflowStep as (input: any) => Promise<any>,
    getIncidentRunDetail: (engineMod as any).getIncidentRunDetail as (incidentId: string, opts: any) => Promise<any>,
    reopenIncidentRun: (engineMod as any).reopenIncidentRun as (input: any) => Promise<any>,
    resolveIncidentRun: (engineMod as any).resolveIncidentRun as (input: any) => Promise<any>,
    updateIncidentPostmortem: (engineMod as any).updateIncidentPostmortem as (input: any) => Promise<any>,
    normalizePostmortemStatus: (engineMod as any).normalizePostmortemStatus as (v: any, fb: any) => any,
  };
}

function toEngineError(deps: Awaited<ReturnType<typeof loadDeps>>, err: unknown): any {
  const IncidentEngineError = deps.IncidentEngineError as any;
  if (IncidentEngineError && err instanceof IncidentEngineError) return err;
  return new (IncidentEngineError ?? Error)(500, err instanceof Error ? err.message : String(err));
}

// ---------- routes ----------

export async function GET(req: Request, ctx: any) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubGet();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/incidents/[incidentId]", source: "ops-incidents" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incidents.detail.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incidents.detail.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents/[incidentId]",
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

      const incidentId = await readIncidentIdFromCtx(ctx);
      if (!incidentId) {
        return NextResponse.json({ ok: false, error: "incidentId is required" }, { status: 400 });
      }

      const url = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);
      const timelineLimit = parseLimit(url.searchParams.get("timelineLimit"));

      try {
        const incident = await deps.getIncidentRunDetail(incidentId, { timelineLimit });
        if (!incident) {
          return NextResponse.json({ ok: false, error: "Incident not found" }, { status: 404 });
        }

        deps.incrementCounter("ops.incidents.detail.total", 1, {
          state: String(incident?.state ?? "unknown"),
        });

        return NextResponse.json({ ok: true, incident });
      } catch (err: unknown) {
        const engineErr = toEngineError(deps, err);
        const status = typeof engineErr?.status === "number" ? engineErr.status : 500;
        const message = typeof engineErr?.message === "string" ? engineErr.message : String(err);

        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
  );
}

export async function POST(req: Request, ctx: any) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubPost();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/incidents/[incidentId]", source: "ops-incidents" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incidents.action.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incidents.action.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents/[incidentId]",
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

      const incidentId = await readIncidentIdFromCtx(ctx);
      if (!incidentId) {
        return NextResponse.json({ ok: false, error: "incidentId is required" }, { status: 400 });
      }

      const body: any = await req.json().catch(() => ({}));
      const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

      try {
        if (action === "assign") {
          const incident = await deps.assignIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            assigneeUserId: typeof body?.assigneeUserId === "string" ? body.assigneeUserId : null,
            assigneeEmail: typeof body?.assigneeEmail === "string" ? body.assigneeEmail : null,
            note: typeof body?.note === "string" ? body.note : null,
          });

          deps.incrementCounter("ops.incidents.assign.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.assign",
            detail: `Assigned incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
              assigneeUserId: incident?.assignee?.id ?? null,
              assigneeEmail: incident?.assigneeEmail ?? null,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "acknowledge") {
          const incident = await deps.acknowledgeIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });

          deps.incrementCounter("ops.incidents.acknowledge.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.acknowledge",
            detail: `Acknowledged incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
              state: incident?.state ?? null,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "resolve") {
          const incident = await deps.resolveIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });

          deps.incrementCounter("ops.incidents.resolve.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.resolve",
            detail: `Resolved incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
              state: incident?.state ?? null,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "close") {
          const incident = await deps.closeIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });

          deps.incrementCounter("ops.incidents.close.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.close",
            detail: `Closed incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
              state: incident?.state ?? null,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "reopen") {
          const incident = await deps.reopenIncidentRun({
            incidentId,
            actorUserId: access.identity.userId,
            note: typeof body?.note === "string" ? body.note : null,
          });

          deps.incrementCounter("ops.incidents.reopen.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.reopen",
            detail: `Reopened incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
              state: incident?.state ?? null,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "note") {
          const message = typeof body?.message === "string" ? body.message : "";
          const incident = await deps.addIncidentNote({
            incidentId,
            actorUserId: access.identity.userId,
            message,
          });

          deps.incrementCounter("ops.incidents.note.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.note",
            detail: `Added timeline note on incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "postmortem") {
          const statusRaw = body?.status;
          const status =
            statusRaw === undefined ? undefined : deps.normalizePostmortemStatus(statusRaw, null);

          if (statusRaw !== undefined && status === null) {
            return NextResponse.json({ ok: false, error: "Invalid postmortem status" }, { status: 400 });
          }

          const incident = await deps.updateIncidentPostmortem({
            incidentId,
            actorUserId: access.identity.userId,
            status,
            summary: typeof body?.summary === "string" ? body.summary : undefined,
            impact: typeof body?.impact === "string" ? body.impact : undefined,
            rootCause: typeof body?.rootCause === "string" ? body.rootCause : undefined,
            actionItems: body?.actionItems,
          });

          deps.incrementCounter("ops.incidents.postmortem.total", 1, { ok: "true" });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: incident?.host?.id ?? null,
            action: "ops.incidents.postmortem",
            detail: `Updated postmortem for incident ${incident?.id ?? incidentId}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: incident?.id ?? incidentId,
              postmortemStatus: incident?.postmortemStatus ?? null,
            },
          });

          return NextResponse.json({ ok: true, action, incident });
        }

        if (action === "step") {
          const stepId = typeof body?.stepId === "string" ? body.stepId : "";
          const payload =
            body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
              ? (body.payload as Record<string, unknown>)
              : {};

          const execution = await deps.executeIncidentWorkflowStep({
            incidentId,
            stepId,
            actorUserId: access.identity.userId,
            actorEmail: access.identity.email,
            payload,
            observability: {
              correlationId: obsCtx.correlationId,
              traceId: obsCtx.traceId,
              route: obsCtx.route,
              method: obsCtx.method,
            },
          });

          deps.incrementCounter("ops.incidents.step.total", 1, {
            stepId,
            ok: execution?.ok ? "true" : "false",
          });

          await deps.writeAuditLog({
            req: safeReq,
            userId: access.identity.userId,
            hostId: execution?.incident?.host?.id ?? null,
            action: execution?.ok ? "ops.incidents.step" : "ops.incidents.step.failed",
            detail: execution?.ok
              ? `Incident step ${execution.step.id} executed`
              : `Incident step ${execution.step.id} failed: ${execution?.error ?? "unknown"}`,
            meta: {
              route: "/api/ops/incidents/[incidentId]",
              incidentId: execution?.incident?.id ?? incidentId,
              workflowId: execution?.workflow?.id ?? null,
              stepId: execution?.step?.id ?? stepId,
              action: execution?.step?.action ?? null,
              ok: Boolean(execution?.ok),
            },
          });

          return NextResponse.json(
            {
              ok: Boolean(execution?.ok),
              error: execution?.error ?? null,
              action,
              incident: execution?.incident ?? null,
              workflow: execution?.workflow ?? null,
              step: execution?.step ?? null,
              result: execution?.result ?? null,
            },
            { status: execution?.ok ? 200 : 409 }
          );
        }

        return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
      } catch (err: unknown) {
        const engineErr = toEngineError(deps, err);
        const status = typeof engineErr?.status === "number" ? engineErr.status : 500;
        const message = typeof engineErr?.message === "string" ? engineErr.message : String(err);

        return NextResponse.json({ ok: false, error: message }, { status });
      }
    }
  );
}
