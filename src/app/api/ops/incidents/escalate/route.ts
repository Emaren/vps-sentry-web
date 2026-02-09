// /var/www/vps-sentry-web/src/app/api/ops/incidents/escalate/route.ts
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
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    escalated: false,
    incidentId: null,
    note: "stubbed during build collection",
  });
}

// ---------- small parsing helpers ----------

function toTrimmedString(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, prismaMod, obsMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/prisma"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const prisma = (prismaMod as any).prisma as any;

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
    prisma,
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
    { route: "/api/ops/incidents/escalate", source: "ops-incident-escalate" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.incidents.escalate.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.incidents.escalate.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/incidents/escalate",
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
      const incidentId =
        toTrimmedString(body?.incidentId, 128) ??
        toTrimmedString(body?.id, 128) ??
        null;

      const reason = toTrimmedString(body?.reason, 2000);
      const note = toTrimmedString(body?.note, 4000);
      const severity = toTrimmedString(body?.severity, 40); // optional

      if (!incidentId) {
        return NextResponse.json({ ok: false, error: "incidentId is required" }, { status: 400 });
      }

      // Look up incident (best effort — schema varies, so we keep prisma as any)
      const incident = await deps.prisma.incident?.findFirst?.({
        where: { id: incidentId, userId: access.identity.userId },
        select: { id: true, title: true, state: true, severity: true, updatedAt: true },
      });

      if (!incident) {
        deps.incrementCounter("ops.incidents.escalate.not_found.total", 1, { which: "incident" });
        return NextResponse.json({ ok: false, error: "Incident not found" }, { status: 404 });
      }

      deps.incrementCounter("ops.incidents.escalate.invoked.total", 1, {
        severity: severity ?? "unknown",
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.incidents.escalate.invoked",
        detail: `Escalate invoked for incident=${incidentId} by ${access.identity.email}`,
        meta: {
          route: "/api/ops/incidents/escalate",
          incidentId,
          severity: severity ?? null,
          hasReason: Boolean(reason),
          hasNote: Boolean(note),
        },
      });

      try {
        const now = new Date();

        // Best-effort update. If your schema differs, this will throw and we’ll return a 500 with the message.
        const updated = await deps.prisma.incident.update({
          where: { id: incidentId },
          data: {
            escalatedAt: now,
            escalationReason: reason ?? undefined,
            escalationNote: note ?? undefined,
            severity: severity ?? undefined,
            // optionally move state (safe if exists)
            state: "escalated",
            escalationCount: { increment: 1 },
          },
          select: { id: true, title: true, state: true, severity: true, escalatedAt: true, updatedAt: true },
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.incidents.escalate",
          detail: `Escalated incident=${incidentId}`,
          meta: {
            route: "/api/ops/incidents/escalate",
            incidentId,
            ok: true,
          },
        });

        deps.incrementCounter("ops.incidents.escalate.total", 1, { ok: "true" });

        return NextResponse.json({
          ok: true,
          escalated: true,
          incident: updated,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);

        deps.incrementCounter("ops.incidents.escalate.total", 1, { ok: "false" });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.incidents.escalate.failed",
          detail: message,
          meta: {
            route: "/api/ops/incidents/escalate",
            incidentId,
          },
        });

        return NextResponse.json({ ok: false, error: message }, { status: 500 });
      }
    }
  );
}
