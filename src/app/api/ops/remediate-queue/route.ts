import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { safeRequestUrl } from "@/lib/request-url";
import {
  getRemediationQueueSnapshot,
  setRemediationRunApproval,
} from "@/lib/remediate/queue";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/remediate-queue", source: "ops-remediate-queue" }, async (obsCtx) => {
    const access = await requireOpsAccess();
    if (!access.ok) {
      incrementCounter("ops.remediate_queue.denied.total", 1, {
        status: access.status,
      });
      await writeAuditLog({
        req,
        action: "ops.remediate_queue_view.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/api/ops/remediate-queue",
          status: access.status,
          requiredRole: "ops",
          email: access.email ?? null,
          role: access.role ?? null,
        },
      });
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }

    obsCtx.userId = access.identity.userId;

    const url = safeRequestUrl(req);
    const limit = parseLimit(url.searchParams.get("limit"), 25);
    const dlqOnly = parseBool(url.searchParams.get("dlq"), false);
    const snapshot = await getRemediationQueueSnapshot({ limit, dlqOnly });

    incrementCounter("ops.remediate_queue.view.total", 1, {
      dlqOnly: dlqOnly ? "true" : "false",
    });
    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: "ops.remediate_queue_view",
      detail: `Queue snapshot viewed (items=${snapshot.items.length}, dlqOnly=${dlqOnly})`,
      meta: {
        route: "/api/ops/remediate-queue",
        limit,
        dlqOnly,
        counts: snapshot.counts,
      },
    });

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  });
}

export async function POST(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/remediate-queue", source: "ops-remediate-queue" }, async (obsCtx) => {
    const access = await requireOpsAccess();
    if (!access.ok) {
      incrementCounter("ops.remediate_queue.denied.total", 1, {
        status: access.status,
      });
      await writeAuditLog({
        req,
        action: "ops.remediate_queue_approval.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/api/ops/remediate-queue",
          status: access.status,
          requiredRole: "ops",
          email: access.email ?? null,
          role: access.role ?? null,
        },
      });
      return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
    }

    obsCtx.userId = access.identity.userId;

    const body = await req.json().catch(() => ({}));
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const mode = parseApprovalMode(body?.mode);
    const reason = parseReason(body?.reason);

    if (!runId) {
      return NextResponse.json({ ok: false, error: "runId is required" }, { status: 400 });
    }

    const result = await setRemediationRunApproval({
      runId,
      actorUserId: access.identity.userId,
      mode,
      reason,
    });

    incrementCounter("ops.remediate_queue.approval.total", 1, {
      mode,
      ok: result.ok ? "true" : "false",
    });
    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: result.ok
        ? "ops.remediate_queue_approval"
        : "ops.remediate_queue_approval.failed",
      detail: result.ok
        ? `run=${runId} mode=${mode} status=${result.approvalStatus ?? "none"}`
        : `run=${runId} mode=${mode} error=${result.error ?? "unknown"}`,
      meta: {
        route: "/api/ops/remediate-queue",
        mode,
        runId,
        state: result.state ?? null,
        approvalStatus: result.approvalStatus ?? null,
        error: result.error ?? null,
      },
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: statusForApprovalError(result.error) });
    }

    return NextResponse.json({
      ok: true,
      result,
    });
  });
}
