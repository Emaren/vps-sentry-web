import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import {
  applyFleetBlastRadiusSafeguards,
  buildFleetRolloutStages,
  hasFleetSelectorFilter,
  hostMatchesFleetSelector,
  normalizeFleetSelector,
  readFleetBlastRadiusPolicy,
  readHostFleetPolicyConfig,
  sortFleetHostsForRollout,
  type FleetRolloutStrategy,
} from "@/lib/remediate/fleet-policy";
import { queueAutonomousRemediationForHost } from "@/lib/remediate/autonomous-runtime";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

type FleetRemediateMode = "preview" | "execute";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function normalizeMode(v: unknown): FleetRemediateMode {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "execute" ? "execute" : "preview";
}

function parseIntMaybe(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const t = Math.trunc(v);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function normalizeRolloutStrategy(v: unknown): FleetRolloutStrategy {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "sequential" ? "sequential" : "group_canary";
}

function parseBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return fallback;
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/remediate-fleet", source: "ops-remediate-fleet" },
    async (obsCtx) => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        incrementCounter("ops.remediate_fleet.denied.total", 1, {
          status: access.status,
        });
        await writeAuditLog({
          req,
          action: "ops.remediate_fleet.denied",
          detail: `status=${access.status} email=${access.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/remediate-fleet",
            status: access.status,
            requiredRole: "ops",
            email: access.email ?? null,
            role: access.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;

      const blast = readFleetBlastRadiusPolicy();
      const body = await req.json().catch(() => ({}));
      const mode = normalizeMode(body?.mode);
      const selector = normalizeFleetSelector(body?.selector);
      const allowWideSelector = parseBool(body?.allowWideSelector, false);
      const reason =
        typeof body?.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim().slice(0, 160)
          : "fleet_rollout";

      if (blast.requireSelector && !allowWideSelector && !hasFleetSelectorFilter(selector)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Selector is required for fleet remediation (set allowWideSelector=true to override).",
          },
          { status: 400 }
        );
      }

      const rollout = asRecord(body?.rollout) ?? {};
      const strategy = normalizeRolloutStrategy(rollout.strategy);
      const stageSize = clampInt(
        parseIntMaybe(rollout.stageSize) ?? blast.defaultStageSize,
        1,
        100
      );
      const maxHosts = clampInt(
        parseIntMaybe(rollout.maxHosts) ?? blast.maxHosts,
        1,
        blast.maxHosts
      );
      const maxPerGroup = clampInt(
        parseIntMaybe(rollout.maxPerGroup) ?? blast.maxPerGroup,
        1,
        blast.maxPerGroup
      );
      const maxPercent = clampInt(
        parseIntMaybe(rollout.maxPercentOfEnabledFleet) ?? blast.maxPercentOfEnabledFleet,
        1,
        blast.maxPercentOfEnabledFleet
      );
      const stageIndexRequested = clampInt(parseIntMaybe(rollout.stageIndex) ?? 1, 1, 10_000);

      const rows = await prisma.host.findMany({
        where: { userId: access.identity.userId },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          name: true,
          enabled: true,
          lastSeenAt: true,
          metaJson: true,
        },
      });
      const totalEnabledFleet = rows.filter((x) => x.enabled).length;
      const withFleet = rows.map((row) => ({
        ...row,
        fleet: readHostFleetPolicyConfig(row.metaJson),
      }));
      const candidates = withFleet.filter((host) => hostMatchesFleetSelector(host, selector));
      const sorted = sortFleetHostsForRollout(candidates);
      const safeguarded = applyFleetBlastRadiusSafeguards({
        hosts: sorted,
        totalEnabledFleet,
        maxHosts,
        maxPerGroup,
        maxPercentOfEnabledFleet: maxPercent,
      });
      const stages = buildFleetRolloutStages(safeguarded.accepted, stageSize, strategy);
      const totalStages = stages.length;
      const stageIndex =
        totalStages > 0 ? clampInt(stageIndexRequested, 1, totalStages) : 0;
      const selectedStage = stageIndex > 0 ? stages[stageIndex - 1] ?? [] : [];

      const preview = {
        mode,
        selector,
        strategy,
        totalHostsInFleet: rows.length,
        totalEnabledFleet,
        matchedHosts: candidates.length,
        safeguardedHosts: safeguarded.accepted.length,
        rejectedBySafeguards: safeguarded.rejected.length,
        safeguards: {
          maxHostsEffective: safeguarded.maxHostsEffective,
          maxPerGroupEffective: safeguarded.maxPerGroupEffective,
          maxPercentOfEnabledFleetEffective:
            safeguarded.maxPercentOfEnabledFleetEffective,
          allowedByPercent: safeguarded.allowedByPercent,
        },
        stage: {
          stageSize,
          stageIndex,
          totalStages,
          hostsInStage: selectedStage.length,
        },
        stageHosts: selectedStage.map((h) => ({
          id: h.id,
          name: h.name,
          enabled: h.enabled,
          lastSeenAt: h.lastSeenAt?.toISOString() ?? null,
          fleet: h.fleet,
        })),
        rejectedHosts: safeguarded.rejected.slice(0, 100),
      };

      if (mode === "preview") {
        incrementCounter("ops.remediate_fleet.preview.total", 1, {
          matched: String(candidates.length),
          safeguarded: String(safeguarded.accepted.length),
          stageSize: String(stageSize),
        });
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.remediate_fleet.preview",
          detail: `Fleet preview matched=${candidates.length} safeguarded=${safeguarded.accepted.length} stage=${stageIndex}/${totalStages}`,
          meta: {
            route: "/api/ops/remediate-fleet",
            preview,
          },
        });
        return NextResponse.json({
          ok: true,
          preview,
        });
      }

      if (selectedStage.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "No hosts available in selected stage after safeguards.",
            preview,
          },
          { status: 409 }
        );
      }

      const confirmPhrase =
        typeof body?.confirmPhrase === "string" ? body.confirmPhrase.trim() : "";
      const expectedConfirm = `EXECUTE FLEET STAGE ${stageIndex}`;
      if (confirmPhrase !== expectedConfirm) {
        return NextResponse.json(
          {
            ok: false,
            error: "Confirmation phrase mismatch.",
            expectedConfirm,
            preview,
          },
          { status: 400 }
        );
      }

      const items: Array<{
        hostId: string;
        hostName: string;
        queued: number;
        approvalPending: number;
        skipped: number;
        ok: boolean;
        error: string | null;
      }> = [];

      for (const host of selectedStage) {
        try {
          const queued = await queueAutonomousRemediationForHost({
            hostId: host.id,
            reason: `fleet_stage_${stageIndex}:${reason}`,
          });
          items.push({
            hostId: host.id,
            hostName: host.name,
            queued: queued.queued,
            approvalPending: queued.approvalPending,
            skipped: queued.skipped,
            ok: queued.ok,
            error: queued.error ?? null,
          });
        } catch (err: unknown) {
          items.push({
            hostId: host.id,
            hostName: host.name,
            queued: 0,
            approvalPending: 0,
            skipped: 0,
            ok: false,
            error: String(err),
          });
        }
      }

      const execution = {
        stageIndex,
        totalStages,
        requestedHosts: selectedStage.length,
        ok: items.every((x) => x.ok),
        queued: items.reduce((sum, x) => sum + x.queued, 0),
        approvalPending: items.reduce((sum, x) => sum + x.approvalPending, 0),
        skipped: items.reduce((sum, x) => sum + x.skipped, 0),
        failedHosts: items.filter((x) => !x.ok).length,
        items,
      };

      incrementCounter("ops.remediate_fleet.execute.total", 1, {
        ok: execution.ok ? "true" : "false",
        stageIndex: String(stageIndex),
        queued: String(execution.queued),
      });
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: execution.ok
          ? "ops.remediate_fleet.execute"
          : "ops.remediate_fleet.execute.failed",
        detail: `Fleet execute stage=${stageIndex}/${totalStages} hosts=${selectedStage.length} queued=${execution.queued} failedHosts=${execution.failedHosts}`,
        meta: {
          route: "/api/ops/remediate-fleet",
          reason,
          preview,
          execution,
        },
      });

      return NextResponse.json(
        {
          ok: execution.ok,
          preview,
          execution,
        },
        { status: execution.ok ? 200 : 207 }
      );
    }
  );
}
