import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { requireAdminAccess } from "@/lib/rbac";
import { drainRemediationQueue } from "@/lib/remediate/queue";
import { writeAuditLog } from "@/lib/audit-log";

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
  let actorUserId: string | null = null;
  let authMode: "token" | "admin" = "token";

  if (!hasValidQueueToken(req)) {
    const access = await requireAdminAccess();
    if (!access.ok) {
      await writeAuditLog({
        req,
        action: "ops.remediate_queue_drain.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/api/ops/remediate-drain",
          status: access.status,
          email: access.email ?? null,
        },
      });
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }
    actorUserId = access.identity.userId;
    authMode = "admin";
  }

  const body = await req.json().catch(() => ({}));
  const limitRaw = Number(body?.limit ?? 5);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 5;

  const drained = await drainRemediationQueue({ limit });

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
}
