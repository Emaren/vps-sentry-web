import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import {
  replayDeadLetterRuns,
  replayRemediationRun,
} from "@/lib/remediate/queue";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

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

export async function POST(req: Request) {
  return runObservedRoute(req, { route: "/api/ops/remediate-replay", source: "ops-remediate-replay" }, async (obsCtx) => {
    const access = await requireOpsAccess();
    if (!access.ok) {
      incrementCounter("ops.remediate_replay.denied.total", 1, {
        status: access.status,
      });
      await writeAuditLog({
        req,
        action: "ops.remediate_replay.denied",
        detail: `status=${access.status} email=${access.email ?? "unknown"}`,
        meta: {
          route: "/api/ops/remediate-replay",
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
    const mode = normalizeMode(body?.mode);

    if (mode === "dlq-batch") {
      const limit = parseLimit(body?.limit, 3);
      const summary = await replayDeadLetterRuns({
        limit,
        replayedByUserId: access.identity.userId,
      });

      incrementCounter("ops.remediate_replay.batch.total", 1, {
        ok: summary.ok ? "true" : "false",
      });
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.remediate_replay.batch",
        detail: `DLQ replay batch requested (replayed=${summary.replayed}, skipped=${summary.skipped})`,
        meta: {
          route: "/api/ops/remediate-replay",
          mode,
          limit,
          replayed: summary.replayed,
          skipped: summary.skipped,
          ok: summary.ok,
        },
      });

      return NextResponse.json(
        {
          ok: summary.ok,
          mode,
          summary,
        },
        { status: summary.ok ? 200 : 409 }
      );
    }

    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json(
        { ok: false, error: "runId is required for single replay mode" },
        { status: 400 }
      );
    }

    const replayed = await replayRemediationRun({
      runId,
      replayedByUserId: access.identity.userId,
    });

    incrementCounter("ops.remediate_replay.single.total", 1, {
      ok: replayed.ok ? "true" : "false",
    });
    await writeAuditLog({
      req,
      userId: access.identity.userId,
      action: replayed.ok ? "ops.remediate_replay.single" : "ops.remediate_replay.single.failed",
      detail: replayed.ok
        ? `Replay queued for source run ${runId}`
        : `Replay failed for source run ${runId}: ${replayed.error ?? "unknown"}`,
      meta: {
        route: "/api/ops/remediate-replay",
        mode,
        sourceRunId: runId,
        replayRunId: replayed.replayRunId ?? null,
        ok: replayed.ok,
      },
    });

    if (!replayed.ok) {
      return NextResponse.json({ ok: false, error: replayed.error }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      mode,
      replayed,
    });
  });
}
