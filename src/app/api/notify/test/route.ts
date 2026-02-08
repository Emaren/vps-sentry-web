import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { dispatchNotifyTest, inferNotifyKindFromTarget, type NotifyKind } from "@/lib/notify";
import { prisma } from "@/lib/prisma";
import { incrementCounter, logEvent, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

function normalizeKind(v: unknown): NotifyKind | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  if (t === "EMAIL" || t === "WEBHOOK") return t;
  return null;
}

export async function POST(req: Request) {
  return runObservedRoute(req, { route: "/api/notify/test", source: "notify-test" }, async (obsCtx) => {
    const access = await requireOpsAccess();
    if (!access.ok) {
      incrementCounter("notify.test.denied.total", 1, {
        status: access.status,
      });
      await writeAuditLog({
        req,
        action: "notify.test.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/api/notify/test",
          status: access.status,
          requiredRole: "ops",
          email: access.email ?? null,
          role: access.role ?? null,
        },
      });
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    obsCtx.userId = access.identity.userId;

    const body = await req.json().catch(() => ({}));
    const target = typeof body?.target === "string" ? body.target.trim() : "";
    const hostId = typeof body?.hostId === "string" ? body.hostId.trim() : "";
    const kind = normalizeKind(body?.kind);
    const inferredKind = target ? inferNotifyKindFromTarget(target) : null;

    if (target && !kind && !inferredKind) {
      incrementCounter("notify.test.invalid_target.total", 1);
      return NextResponse.json(
        {
          error: "Unable to infer target kind. Provide kind=EMAIL|WEBHOOK or a valid email/http(s) target.",
        },
        { status: 400 }
      );
    }

    if (hostId) {
      const host = await prisma.host.findUnique({
        where: { id: hostId },
        select: { id: true },
      });
      if (!host) {
        incrementCounter("notify.test.host_not_found.total", 1);
        return NextResponse.json({ error: "Host not found" }, { status: 404 });
      }
      obsCtx.hostId = host.id;
    }

    await writeAuditLog({
      req,
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
      const result = await dispatchNotifyTest({
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

      await writeAuditLog({
        req,
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

      incrementCounter("notify.test.attempts.total", result.attempted, {
        ok: result.ok ? "true" : "false",
      });
      logEvent(result.ok ? "info" : "warn", "notify.test.complete", obsCtx, {
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
      incrementCounter("notify.test.errors.total", 1);
      const message = err instanceof Error ? err.message : String(err);
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        hostId: hostId || null,
        action: "notify.test.failed",
        detail: message,
        meta: {
          route: "/api/notify/test",
        },
      });
      logEvent("error", "notify.test.failed", obsCtx, {
        error: message,
      });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  });
}
