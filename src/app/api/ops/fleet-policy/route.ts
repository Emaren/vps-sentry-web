// /var/www/vps-sentry-web/src/app/api/ops/fleet-policy/route.ts
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
    summary: {
      hosts: 0,
      enabledHosts: 0,
      groups: [],
      tags: [],
      scopes: [],
    },
    hosts: [],
    note: "stubbed during build collection",
  });
}

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    result: {
      selectedCount: 0,
      changedCount: 0,
      skippedCount: 0,
      limit: 0,
      maxLimit: 0,
      items: [],
    },
    note: "stubbed during build collection",
  });
}

// ---------- parsing helpers ----------

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
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

function normalizeGroupMaybe(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const cleaned = v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || null;
}

function normalizeStringArray(input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= 40) break;
  }
  return out;
}

function mapCountEntries(map: Map<string, number>) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }));
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [rbacMod, auditMod, prismaMod, fleetPolicyMod, obsMod] = await Promise.all([
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/prisma"),
    import("@/lib/remediate/fleet-policy"),
    import("@/lib/observability").catch(() => ({} as any)),
  ]);

  const requireAdminAccess = (rbacMod as any).requireAdminAccess as () => Promise<any>;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const prisma = (prismaMod as any).prisma as any;

  return {
    prisma,
    requireAdminAccess,
    writeAuditLog,

    applyFleetPolicyDelta: (fleetPolicyMod as any).applyFleetPolicyDelta as (before: any, delta: any) => any,
    hasFleetSelectorFilter: (fleetPolicyMod as any).hasFleetSelectorFilter as (selector: any) => boolean,
    hostMatchesFleetSelector: (fleetPolicyMod as any).hostMatchesFleetSelector as (host: any, selector: any) => boolean,
    mergeHostFleetPolicyMeta: (fleetPolicyMod as any).mergeHostFleetPolicyMeta as (input: any) => any,
    normalizeFleetSelector: (fleetPolicyMod as any).normalizeFleetSelector as (v: any) => any,
    readFleetBlastRadiusPolicy: (fleetPolicyMod as any).readFleetBlastRadiusPolicy as () => any,
    readHostFleetPolicyConfig: (fleetPolicyMod as any).readHostFleetPolicyConfig as (metaJson: any) => any,
    sortFleetHostsForRollout: (fleetPolicyMod as any).sortFleetHostsForRollout as (hosts: any[]) => any[],

    incrementCounter: (obsMod as any).incrementCounter ?? (() => {}),
    runObservedRoute:
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
      }),
  };
}

// ---------- routes ----------

export async function GET(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubGet();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/fleet-policy", source: "ops-fleet-policy" },
    async (obsCtx: any) => {
      const access = await deps.requireAdminAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.fleet_policy.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        // best-effort audit
        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.fleet_policy.view.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/fleet-policy",
            status: access?.status ?? 403,
            requiredRole: "admin",
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

      const byGroup = new Map<string, number>();
      const byTag = new Map<string, number>();
      const byScope = new Map<string, number>();

      const hosts = (rows ?? []).map((row: any) => {
        const fleet = deps.readHostFleetPolicyConfig(row.metaJson);
        const group = fleet?.group ?? "__ungrouped";
        byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
        for (const tag of fleet?.tags ?? []) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
        for (const scope of fleet?.scopes ?? []) byScope.set(scope, (byScope.get(scope) ?? 0) + 1);

        return {
          id: row.id,
          name: row.name,
          enabled: row.enabled,
          lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString?.() ?? String(row.lastSeenAt) : null,
          fleet,
        };
      });

      deps.incrementCounter("ops.fleet_policy.view.total", 1, {
        hosts: String(hosts.length),
      });

      return NextResponse.json({
        ok: true,
        summary: {
          hosts: hosts.length,
          enabledHosts: hosts.filter((x: any) => x.enabled).length,
          groups: mapCountEntries(byGroup),
          tags: mapCountEntries(byTag).slice(0, 50),
          scopes: mapCountEntries(byScope).slice(0, 50),
        },
        hosts,
      });
    }
  );
}

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubPost();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  return deps.runObservedRoute(
    safeReq,
    { route: "/api/ops/fleet-policy", source: "ops-fleet-policy" },
    async (obsCtx: any) => {
      const access = await deps.requireAdminAccess();
      if (!access?.ok) {
        deps.incrementCounter("ops.fleet_policy.denied.total", 1, {
          status: String(access?.status ?? 403),
        });

        await deps.writeAuditLog({
          req: safeReq,
          action: "ops.fleet_policy.update.denied",
          detail: `status=${access?.status ?? 403} email=${access?.email ?? "unknown"}`,
          meta: {
            route: "/api/ops/fleet-policy",
            status: access?.status ?? 403,
            requiredRole: "admin",
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
      const selector = deps.normalizeFleetSelector(body?.selector);
      const allowWideSelector = parseBool(body?.allowWideSelector, false);

      if (blast?.requireSelector && !allowWideSelector && !deps.hasFleetSelectorFilter(selector)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Selector is required for fleet policy updates (set allowWideSelector=true to override).",
          },
          { status: 400 }
        );
      }

      const patchRaw = asRecord(body?.patch) ?? {};
      const delta: any = {
        setGroup: normalizeGroupMaybe(
          patchRaw.setGroup !== undefined ? patchRaw.setGroup : (patchRaw as any).group
        ),
        setTags: normalizeStringArray(
          patchRaw.setTags !== undefined ? patchRaw.setTags : (patchRaw as any).tags
        ),
        addTags: normalizeStringArray((patchRaw as any).addTags),
        removeTags: normalizeStringArray((patchRaw as any).removeTags),
        setScopes: normalizeStringArray(
          patchRaw.setScopes !== undefined ? patchRaw.setScopes : (patchRaw as any).scopes
        ),
        addScopes: normalizeStringArray((patchRaw as any).addScopes),
        removeScopes: normalizeStringArray((patchRaw as any).removeScopes),
        rolloutPaused:
          (patchRaw as any).rolloutPaused === undefined
            ? undefined
            : parseBool((patchRaw as any).rolloutPaused, false),
        rolloutPriority:
          (patchRaw as any).rolloutPriority === undefined
            ? undefined
            : clampInt(parseIntMaybe((patchRaw as any).rolloutPriority) ?? 0, -100, 100),
      };

      const hasPatch =
        delta.setGroup !== undefined ||
        delta.setTags !== undefined ||
        delta.addTags !== undefined ||
        delta.removeTags !== undefined ||
        delta.setScopes !== undefined ||
        delta.addScopes !== undefined ||
        delta.removeScopes !== undefined ||
        delta.rolloutPaused !== undefined ||
        delta.rolloutPriority !== undefined;

      if (!hasPatch) {
        return NextResponse.json(
          { ok: false, error: "At least one patch field is required." },
          { status: 400 }
        );
      }

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

      const enriched = (rows ?? []).map((row: any) => ({
        ...row,
        fleet: deps.readHostFleetPolicyConfig(row.metaJson),
      }));

      const candidates = deps
        .sortFleetHostsForRollout(enriched)
        .filter((host: any) => deps.hostMatchesFleetSelector(host, selector));

      const limit = clampInt(
        parseIntMaybe(body?.limit) ?? (blast?.maxPolicyUpdateHosts ?? 1),
        1,
        blast?.maxPolicyUpdateHosts ?? 1
      );

      const selected = candidates.slice(0, limit);

      const items: Array<{
        hostId: string;
        hostName: string;
        changed: boolean;
        before: any;
        after: any;
      }> = [];

      for (const host of selected) {
        const before = deps.readHostFleetPolicyConfig(host.metaJson);
        const after = deps.applyFleetPolicyDelta(before, delta);

        const changed = JSON.stringify(before) !== JSON.stringify(after);

        if (!changed) {
          items.push({
            hostId: host.id,
            hostName: host.name,
            changed,
            before,
            after,
          });
          continue;
        }

        const nextMetaJson = deps.mergeHostFleetPolicyMeta({
          currentMetaJson: host.metaJson,
          patch: after,
        });

        await deps.prisma.host.update({
          where: { id: host.id },
          data: { metaJson: nextMetaJson },
          select: { id: true },
        });

        items.push({
          hostId: host.id,
          hostName: host.name,
          changed,
          before,
          after,
        });
      }

      const changedCount = items.filter((x) => x.changed).length;

      deps.incrementCounter("ops.fleet_policy.update.total", 1, {
        changed: String(changedCount),
        selected: String(selected.length),
      });

      await deps.writeAuditLog({
        req: safeReq,
        userId: access.identity.userId,
        action: "ops.fleet_policy.update",
        detail: `Fleet policy update selected=${selected.length} changed=${changedCount}`,
        meta: {
          route: "/api/ops/fleet-policy",
          selector,
          delta,
          changedCount,
          selectedCount: selected.length,
          limit,
        },
      });

      return NextResponse.json({
        ok: true,
        result: {
          selectedCount: selected.length,
          changedCount,
          skippedCount: selected.length - changedCount,
          limit,
          maxLimit: blast?.maxPolicyUpdateHosts ?? null,
          items,
        },
      });
    }
  );
}
