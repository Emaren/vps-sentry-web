import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import {
  applyFleetPolicyDelta,
  hasFleetSelectorFilter,
  hostMatchesFleetSelector,
  mergeHostFleetPolicyMeta,
  normalizeFleetSelector,
  readFleetBlastRadiusPolicy,
  readHostFleetPolicyConfig,
  sortFleetHostsForRollout,
  type HostFleetPolicyDelta,
} from "@/lib/remediate/fleet-policy";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/fleet-policy", source: "ops-fleet-policy" },
    async (obsCtx) => {
      const access = await requireAdminAccess();
      if (!access.ok) {
        incrementCounter("ops.fleet_policy.denied.total", 1, {
          status: access.status,
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;

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

      const byGroup = new Map<string, number>();
      const byTag = new Map<string, number>();
      const byScope = new Map<string, number>();

      const hosts = rows.map((row) => {
        const fleet = readHostFleetPolicyConfig(row.metaJson);
        const group = fleet.group ?? "__ungrouped";
        byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
        for (const tag of fleet.tags) byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
        for (const scope of fleet.scopes) byScope.set(scope, (byScope.get(scope) ?? 0) + 1);
        return {
          id: row.id,
          name: row.name,
          enabled: row.enabled,
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          fleet,
        };
      });

      incrementCounter("ops.fleet_policy.view.total", 1, {
        hosts: String(hosts.length),
      });
      return NextResponse.json({
        ok: true,
        summary: {
          hosts: hosts.length,
          enabledHosts: hosts.filter((x) => x.enabled).length,
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
  return runObservedRoute(
    req,
    { route: "/api/ops/fleet-policy", source: "ops-fleet-policy" },
    async (obsCtx) => {
      const access = await requireAdminAccess();
      if (!access.ok) {
        incrementCounter("ops.fleet_policy.denied.total", 1, {
          status: access.status,
        });
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      obsCtx.userId = access.identity.userId;

      const blast = readFleetBlastRadiusPolicy();
      const body = await req.json().catch(() => ({}));
      const selector = normalizeFleetSelector(body?.selector);
      const allowWideSelector = parseBool(body?.allowWideSelector, false);
      if (blast.requireSelector && !allowWideSelector && !hasFleetSelectorFilter(selector)) {
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
      const delta: HostFleetPolicyDelta = {
        setGroup: normalizeGroupMaybe(
          patchRaw.setGroup !== undefined ? patchRaw.setGroup : patchRaw.group
        ),
        setTags: normalizeStringArray(
          patchRaw.setTags !== undefined ? patchRaw.setTags : patchRaw.tags
        ),
        addTags: normalizeStringArray(patchRaw.addTags),
        removeTags: normalizeStringArray(patchRaw.removeTags),
        setScopes: normalizeStringArray(
          patchRaw.setScopes !== undefined ? patchRaw.setScopes : patchRaw.scopes
        ),
        addScopes: normalizeStringArray(patchRaw.addScopes),
        removeScopes: normalizeStringArray(patchRaw.removeScopes),
        rolloutPaused:
          patchRaw.rolloutPaused === undefined
            ? undefined
            : parseBool(patchRaw.rolloutPaused, false),
        rolloutPriority:
          patchRaw.rolloutPriority === undefined
            ? undefined
            : clampInt(parseIntMaybe(patchRaw.rolloutPriority) ?? 0, -100, 100),
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
      const candidates = sortFleetHostsForRollout(
        rows
          .map((row) => ({
            ...row,
            fleet: readHostFleetPolicyConfig(row.metaJson),
          }))
          .filter((host) => hostMatchesFleetSelector(host, selector))
      );
      const limit = clampInt(
        parseIntMaybe(body?.limit) ?? blast.maxPolicyUpdateHosts,
        1,
        blast.maxPolicyUpdateHosts
      );
      const selected = candidates.slice(0, limit);

      const items: Array<{
        hostId: string;
        hostName: string;
        changed: boolean;
        before: ReturnType<typeof readHostFleetPolicyConfig>;
        after: ReturnType<typeof readHostFleetPolicyConfig>;
      }> = [];

      for (const host of selected) {
        const before = readHostFleetPolicyConfig(host.metaJson);
        const after = applyFleetPolicyDelta(before, delta);
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

        const nextMetaJson = mergeHostFleetPolicyMeta({
          currentMetaJson: host.metaJson,
          patch: after,
        });
        await prisma.host.update({
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
      incrementCounter("ops.fleet_policy.update.total", 1, {
        changed: String(changedCount),
        selected: String(selected.length),
      });
      await writeAuditLog({
        req,
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
          maxLimit: blast.maxPolicyUpdateHosts,
          items,
        },
      });
    }
  );
}
