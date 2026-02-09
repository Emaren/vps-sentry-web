// /var/www/vps-sentry-web/src/app/api/ops/remediate-fleet/route.ts
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

function toAbsoluteUrlString(u: string): string {
  const s = String(u ?? "/").trim() || "/";
  try {
    return new URL(s).toString();
  } catch {
    return new URL(s, FALLBACK_BASE).toString();
  }
}

/**
 * Minimal Request-like object with safe *absolute* string `url` and no `nextUrl`.
 * Use this when passing req into helpers that might do new URL(req.url).
 */
function makeSafeReq(req: Request): Request {
  const url = toAbsoluteUrlString(safeUrlString(req));
  const method = (req as any)?.method ?? "POST";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    preview: null,
    execution: null,
    note: "stubbed during build collection",
  });
}

// ---------- route helpers (original logic) ----------

type FleetRemediateMode = "preview" | "execute";
type FleetRolloutStrategy = "group_canary" | "sequential";

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

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [prismaMod, rbacMod, auditMod, fleetMod, autoMod, obsMod] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/remediate/fleet-policy"),
    import("@/lib/remediate/autonomous-runtime"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const prisma = (prismaMod as any).prisma as any;

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

  const applyFleetBlastRadiusSafeguards = (fleetMod as any)
    .applyFleetBlastRadiusSafeguards as (input: any) => any;
  const buildFleetRolloutStages = (fleetMod as any).buildFleetRolloutStages as (
    hosts: any[],
    stageSize: number,
    strategy: FleetRolloutStrategy
  ) => any[][];
  const hasFleetSelectorFilter = (fleetMod as any).hasFleetSelectorFilter as (selector: any) => boolean;
  const hostMatchesFleetSelector = (fleetMod as any).hostMatchesFleetSelector as (host: any, selector: any) => boolean;
  const normalizeFleetSelector = (fleetMod as any).normalizeFleetSelector as (selector: any) => any;
  const readFleetBlastRadiusPolicy = (fleetMod as any).readFleetBlastRadiusPolicy as () => any;
  const readHostFleetPolicyConfig = (fleetMod as any).readHostFleetPolicyConfig as (metaJson: any) => any;
  const sortFleetHostsForRollout = (fleetMod as any).sortFleetHostsForRollout as (hosts: any[]) => any[];

  const queueAutonomousRemediationForHost = (autoMod as any)
    .queueAutonomousRemediationForHost as (input: any) => Promise<any>;

  return {
    prisma,
    requireOpsAccess,
    writeAuditLog,
    incrementCounter,
    runObservedRoute,
    applyFleetBlastRadiusSafeguards,
    buildFleetRolloutStages,
    hasFleetSelectorFilter,
    hostMatchesFleetSelector,
    normalizeFleetSelector,
    readFleetBlastRadiusPolicy,
    readHostFleetPolicyConfig,
    sortFleetHostsForRollout,
    queueAutonomousRemediationForHost,
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
    { route: "/api/ops/remediate-fleet", source: "ops-remediate-fleet" },
    async (obsCtx: any) => {
      const access = await deps.requireOpsAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.remediate_fleet.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.remediate_fleet.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/remediate-fleet",
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

      const blast = deps.readFleetBlastRadiusPolicy();
      const body: any = await req.json().catch(() => ({}));
      const mode = normalizeMode(body?.mode);
      const selector = deps.normalizeFleetSelector(body?.selector);
      const allowWideSelector = parseBool(body?.allowWideSelector, false);
      const reason =
        typeof body?.reason === "string" && body.reason.trim().length > 0
          ? body.reason.trim().slice(0, 160)
          : "fleet_rollout";

      if (blast?.requireSelector && !allowWideSelector && !deps.hasFleetSelectorFilter(selector)) {
        return NextResponse.json(
          {
            ok: false,
            error: "Selector is required for fleet remediation (set allowWideSelector=true to override).",
          },
          { status: 400 }
        );
      }

      const rollout = asRecord(body?.rollout) ?? {};
      const strategy = normalizeRolloutStrategy(rollout.strategy);

      const stageSize = clampInt(
        parseIntMaybe(rollout.stageSize) ?? Number(blast?.defaultStageSize ?? 10),
        1,
        100
      );

      const maxHostsHard = clampInt(Number(blast?.maxHosts ?? 50), 1, Number(blast?.maxHosts ?? 50));
      const maxPerGroupHard = clampInt(
        Number(blast?.maxPerGroup ?? 10),
        1,
        Number(blast?.maxPerGroup ?? 10)
      );
      const maxPercentHard = clampInt(
        Number(blast?.maxPercentOfEnabledFleet ?? 25),
        1,
        Number(blast?.maxPercentOfEnabledFleet ?? 25)
      );

      const maxHosts = clampInt(parseIntMaybe(rollout.maxHosts) ?? maxHostsHard, 1, maxHostsHard);
      const maxPerGroup = clampInt(parseIntMaybe(rollout.maxPerGroup) ?? maxPerGroupHard, 1, maxPerGroupHard);
      const maxPercent = clampInt(
        parseIntMaybe(rollout.maxPercentOfEnabledFleet) ?? maxPercentHard,
        1,
        maxPercentHard
      );

      const stageIndexRequested = clampInt(parseIntMaybe(rollout.stageIndex) ?? 1, 1, 10_000);

      const rows = await deps.prisma.host.findMany({
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

      const totalEnabledFleet = rows.filter((x: any) => x.enabled).length;

      const withFleet = rows.map((row: any) => ({
        ...row,
        fleet: deps.readHostFleetPolicyConfig(row.metaJson),
      }));

      const candidates = withFleet.filter((host: any) => deps.hostMatchesFleetSelector(host, selector));
      const sorted = deps.sortFleetHostsForRollout(candidates);

      const safeguarded = deps.applyFleetBlastRadiusSafeguards({
        hosts: sorted,
        totalEnabledFleet,
        maxHosts,
        maxPerGroup,
        maxPercentOfEnabledFleet: maxPercent,
      });

      const stages = deps.buildFleetRolloutStages(safeguarded.accepted, stageSize, strategy);
      const totalStages = stages.length;

      const stageIndex = totalStages > 0 ? clampInt(stageIndexRequested, 1, totalStages) : 0;
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
          maxPercentOfEnabledFleetEffective: safeguarded.maxPercentOfEnabledFleetEffective,
          allowedByPercent: safeguarded.allowedByPercent,
        },
        stage: {
          stageSize,
          stageIndex,
          totalStages,
          hostsInStage: selectedStage.length,
        },
        stageHosts: selectedStage.map((h: any) => ({
          id: h.id,
          name: h.name,
          enabled: h.enabled,
          lastSeenAt: h.lastSeenAt?.toISOString?.() ?? null,
          fleet: h.fleet,
        })),
        rejectedHosts: (safeguarded.rejected ?? []).slice(0, 100),
      };

      if (mode === "preview") {
        deps.incrementCounter("ops.remediate_fleet.preview.total", 1, {
          matched: String(candidates.length),
          safeguarded: String(safeguarded.accepted.length),
          stageSize: String(stageSize),
        });

        await deps.writeAuditLog({
          req: safeReq,
          userId: access.identity.userId,
          action: "ops.remediate_fleet.preview",
          detail: `Fleet preview matched=${candidates.length} safeguarded=${safeguarded.accepted.length} stage=${stageIndex}/${totalStages}`,
          meta: {
            route: "/api/ops/remediate-fleet",
            preview,
          },
        });

        return NextResponse.json({ ok: true, preview });
      }

      if (selectedStage.length === 0) {
        return NextResponse.json(
          { ok: false, error: "No hosts available in selected stage after safeguards.", preview },
          { status: 409 }
        );
      }

      const confirmPhrase = typeof body?.confirmPhrase === "string" ? body.confirmPhrase.trim() : "";
      const expectedConfirm = `EXECUTE FLEET STAGE ${stageIndex}`;
      if (confirmPhrase !== expectedConfirm) {
        return NextResponse.json(
          { ok: false, error: "Confirmation phrase mismatch.", expectedConfirm, preview },
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

      for (const host of selectedStage as any[]) {
        try {
          const queued = await deps.queueAutonomousRemediationForHost({
            hostId: host.id,
            reason: `fleet_stage_${stageIndex}:${reason}`,
          });

          items.push({
            hostId: host.id,
            hostName: host.name,
            queued: Number(queued?.queued ?? 0),
            approvalPending: Number(queued?.approvalPending ?? 0),
            skipped: Number(queued?.skipped ?? 0),
            ok: Boolean(queued?.ok),
            error: queued?.error ?? null,
          });
        } catch (err: unknown) {
          items.push({
            hostId: host.id,
            hostName: host.name,
            queued: 0,
            approvalPending: 0,
            skipped: 0,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
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

      deps.incrementCounter("ops.remediate_fleet.execute.total", 1, {
        ok: execution.ok ? "true" : "false",
        stageIndex: String(stageIndex),
        queued: String(execution.queued),
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: execution.ok ? "ops.remediate_fleet.execute" : "ops.remediate_fleet.execute.failed",
        detail: `Fleet execute stage=${stageIndex}/${totalStages} hosts=${selectedStage.length} queued=${execution.queued} failedHosts=${execution.failedHosts}`,
        meta: {
          route: "/api/ops/remediate-fleet",
          reason,
          preview,
          execution,
        },
      });

      return NextResponse.json(
        { ok: execution.ok, preview, execution },
        { status: execution.ok ? 200 : 207 }
      );
    }
  );
}
