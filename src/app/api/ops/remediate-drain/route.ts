import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireOpsAccess } from "@/lib/rbac";
import { drainRemediationQueue } from "@/lib/remediate/queue";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

function hasValidQueueToken(req: Request): boolean {
  const expected = process.env.VPS_REMEDIATE_QUEUE_TOKEN?.trim();
  if (!expected) return false;

  const provided = req.headers.get("x-remediate-queue-token")?.trim();
  if (!provided) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/remediate-drain", source: "ops-remediate-drain" }, async (obsCtx) => {
    let actorUserId: string | null = null;
    let authMode: "token" | "ops" = "token";

    if (!hasValidQueueToken(req)) {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.remediate_drain.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.remediate_queue_drain.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/remediate-drain",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }
      actorUserId = access.identity.userId;
      obsCtx.userId = actorUserId;
      authMode = "ops";
    }

    const body = await req.json().catch(() => ({}));
    const limitRaw = Number(body?.limit ?? 5);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 5;

    const drained = await drainRemediationQueue({ limit });
    incrementCounter("ops.remediate_drain.total", 1, {
      authMode,
      ok: drained.ok ? "true" : "false",
    });

    await writeAuditLog({
      req,
      userId: actorUserId,
      action: "ops.remediate_queue_drain",
      detail: `Processed ${drained.processed}/${drained.requestedLimit} queued run(s)`,
      meta: {
        route: "/api/ops/remediate-drain",
        authMode,
        processed: drained.processed,
        requestedLimit: drained.requestedLimit,
        ok: drained.ok,
      },
    });

    return NextResponse.json({
      ok: true,
      authMode,
      drained,
    });
  });
}
