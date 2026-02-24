import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import {
  drainRemediationQueue,
  getRemediationQueueSnapshot,
  replayDeadLetterRuns,
} from "@/lib/remediate/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asInt(v: unknown): number {
  const n = asNumber(v);
  return n === null ? 0 : Math.trunc(n);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = asInt(v);
  if (!Number.isFinite(n) || n === 0) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function countDrainFailures(drain: unknown): number {
  if (!drain || typeof drain !== "object") return 0;
  const items = Array.isArray((drain as { items?: unknown }).items)
    ? ((drain as { items: unknown[] }).items ?? [])
    : [];
  let failed = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as { state?: unknown; dlq?: unknown };
    const state = typeof row.state === "string" ? row.state.toLowerCase() : "";
    const dlq = row.dlq === true;
    if (dlq || state === "failed" || state === "canceled") failed += 1;
  }
  return failed;
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/remediate-hygiene", source: "ops-remediate-hygiene" },
    async () => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      try {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        const drainLimitCap = clampInt(body.drainLimit, 1, 50, 30);
        const replayLimitCap = clampInt(body.replayLimit, 1, 50, 15);

        const beforeSnapshot = await getRemediationQueueSnapshot({ limit: 10 });
        const before = beforeSnapshot.counts;
        const beforeQueued = Math.max(0, asInt(before.queued));
        const beforeDlq = Math.max(0, asInt(before.dlq));
        const beforeRunning = Math.max(0, asInt(before.running));
        const beforeApproval = Math.max(0, asInt(before.approvalPending));

        const hadDebt = beforeQueued > 0 || beforeDlq > 0;

        let drainFirst: Awaited<ReturnType<typeof drainRemediationQueue>> | null = null;
        let replaySummary: Awaited<ReturnType<typeof replayDeadLetterRuns>> | null = null;
        let drainSecond: Awaited<ReturnType<typeof drainRemediationQueue>> | null = null;

        if (beforeQueued > 0) {
          drainFirst = await drainRemediationQueue({
            limit: Math.min(Math.max(beforeQueued, 1), drainLimitCap),
          });
        }

        if (beforeDlq > 0) {
          replaySummary = await replayDeadLetterRuns({
            limit: Math.min(Math.max(beforeDlq, 1), replayLimitCap),
            replayedByUserId: access.identity.userId,
          });

          if ((replaySummary.replayed ?? 0) > 0) {
            drainSecond = await drainRemediationQueue({
              limit: Math.min(Math.max(replaySummary.replayed, 1), drainLimitCap),
            });
          }
        }

        const afterSnapshot = await getRemediationQueueSnapshot({ limit: 10 });
        const after = afterSnapshot.counts;
        const afterQueued = Math.max(0, asInt(after.queued));
        const afterDlq = Math.max(0, asInt(after.dlq));
        const afterRunning = Math.max(0, asInt(after.running));
        const afterApproval = Math.max(0, asInt(after.approvalPending));

        const improved = afterQueued < beforeQueued || afterDlq < beforeDlq;
        const cleared = afterQueued === 0 && afterDlq === 0;
        const stillDebt = afterQueued > 0 || afterDlq > 0;

        const drainFailures =
          countDrainFailures(drainFirst) + countDrainFailures(drainSecond);
        const replaySkipped = replaySummary?.skipped ?? 0;

        let ok = true;
        if (hadDebt && !improved && !cleared) ok = false;
        if (drainFailures > 0) ok = false;
        if (replaySkipped > 0 && afterDlq > 0) ok = false;

        const detailParts: string[] = [];
        detailParts.push(`Queue before: queued=${beforeQueued}, dlq=${beforeDlq}.`);
        if (drainFirst) {
          detailParts.push(
            `Drain pass: processed ${asInt(drainFirst.processed)}/${asInt(
              drainFirst.requestedLimit
            )}.`
          );
        }
        if (replaySummary) {
          detailParts.push(
            `DLQ replay: replayed=${asInt(replaySummary.replayed)}, skipped=${asInt(
              replaySummary.skipped
            )}.`
          );
        }
        if (drainSecond) {
          detailParts.push(
            `Post-replay drain: processed ${asInt(drainSecond.processed)}/${asInt(
              drainSecond.requestedLimit
            )}.`
          );
        }
        detailParts.push(`Queue now: queued=${afterQueued}, dlq=${afterDlq}.`);
        if (cleared) detailParts.push("Queue debt cleared.");
        else if (improved) detailParts.push("Queue debt reduced.");
        else if (hadDebt) detailParts.push("Queue debt did not move yet; manual follow-up is required.");
        else detailParts.push("No queue debt was present.");
        if (drainFailures > 0) detailParts.push(`${drainFailures} run(s) still failed/canceled during drain.`);
        if (afterApproval > 0) detailParts.push(`${afterApproval} run(s) still require approval.`);

        incrementCounter("ops.remediate_hygiene.total", 1, {
          ok: ok ? "true" : "false",
          hadDebt: hadDebt ? "true" : "false",
          improved: improved ? "true" : "false",
          cleared: cleared ? "true" : "false",
        });

        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: ok ? "ops.remediate_hygiene.ok" : "ops.remediate_hygiene.followup",
          detail: detailParts.join(" "),
          meta: {
            before: {
              queued: beforeQueued,
              dlq: beforeDlq,
              running: beforeRunning,
              approvalPending: beforeApproval,
            },
            after: {
              queued: afterQueued,
              dlq: afterDlq,
              running: afterRunning,
              approvalPending: afterApproval,
            },
            hadDebt,
            improved,
            cleared,
            stillDebt,
            drainFailures,
            replaySkipped,
          },
        });

        return NextResponse.json({
          ok,
          hadDebt,
          improved,
          cleared,
          stillDebt,
          detail: detailParts.join(" "),
          before: {
            queued: beforeQueued,
            dlq: beforeDlq,
            running: beforeRunning,
            approvalPending: beforeApproval,
          },
          after: {
            queued: afterQueued,
            dlq: afterDlq,
            running: afterRunning,
            approvalPending: afterApproval,
          },
          drain: {
            first: drainFirst
              ? {
                  ok: Boolean(drainFirst.ok),
                  processed: asInt(drainFirst.processed),
                  requestedLimit: asInt(drainFirst.requestedLimit),
                }
              : null,
            second: drainSecond
              ? {
                  ok: Boolean(drainSecond.ok),
                  processed: asInt(drainSecond.processed),
                  requestedLimit: asInt(drainSecond.requestedLimit),
                }
              : null,
            failures: drainFailures,
          },
          replay: replaySummary
            ? {
                ok: Boolean(replaySummary.ok),
                replayed: asInt(replaySummary.replayed),
                skipped: asInt(replaySummary.skipped),
                requestedLimit: asInt(replaySummary.requestedLimit),
              }
            : null,
        });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        incrementCounter("ops.remediate_hygiene.failed.total", 1, {});
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.remediate_hygiene.failed",
          detail,
        });
        return NextResponse.json({ ok: false, error: detail }, { status: 409 });
      }
    }
  );
}
