import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildUniqueSlug, slugifyHostName } from "@/lib/host-onboarding";
import {
  mergeHostRemediationPolicyMeta,
  normalizeRemediationPolicyProfile,
  readHostRemediationPolicyConfig,
} from "@/lib/remediate/host-policy";
import {
  mergeHostFleetPolicyMeta,
  readHostFleetPolicyConfig,
} from "@/lib/remediate/fleet-policy";
import type {
  RemediationApprovalRiskThreshold,
  RemediationAutoTier,
} from "@/lib/remediate/autonomous";
import { requireAdminAccess, requireViewerAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function toName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().slice(0, 80);
  return t.length ? t : null;
}

function toSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase().slice(0, 48);
  if (!t) return null;
  const normalized = t.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function toIntMaybe(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

function toBoolMaybe(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return undefined;
}

function toStringArrayMaybe(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
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

function toFleetGroupMaybe(v: unknown): string | null | undefined {
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

function toAutoTierMaybe(v: unknown): RemediationAutoTier | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (t === "observe" || t === "safe_auto" || t === "guarded_auto" || t === "risky_manual") {
    return t;
  }
  return undefined;
}

function toApprovalRiskThresholdMaybe(
  v: unknown
): RemediationApprovalRiskThreshold | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (t === "none" || t === "low" || t === "medium" || t === "high") return t;
  return undefined;
}

async function findUniqueSlug(userId: string, hostId: string, preferredBase: string): Promise<string> {
  const base = slugifyHostName(preferredBase);
  for (let i = 0; i < 50; i++) {
    const candidate = buildUniqueSlug(base, i);
    const exists = await prisma.host.findFirst({
      where: {
        userId,
        id: { not: hostId },
        slug: candidate,
      },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      host: null,
      remediationPolicy: null,
      fleetPolicy: null,
    });
  }

  const access = await requireViewerAccess();
  if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: access.status });

  const { hostId } = await ctx.params;
  const host = await prisma.host.findFirst({
    where: {
      id: hostId,
      userId: access.identity.userId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      agentVersion: true,
      lastSeenAt: true,
      metaJson: true,
      createdAt: true,
      updatedAt: true,
      apiKeys: {
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          prefix: true,
          version: true,
          label: true,
          scopeJson: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
          revokedReason: true,
          expiresAt: true,
          rotatedFromKeyId: true,
        },
      },
      snapshots: {
        orderBy: { ts: "desc" },
        take: 30,
        select: {
          id: true,
          ts: true,
          ok: true,
          alertsCount: true,
          publicPortsCount: true,
          createdAt: true,
        },
      },
      breaches: {
        orderBy: { updatedAt: "desc" },
        take: 30,
        select: {
          id: true,
          title: true,
          detail: true,
          state: true,
          severity: true,
          openedTs: true,
          fixedTs: true,
          updatedAt: true,
        },
      },
      _count: {
        select: {
          snapshots: true,
          breaches: true,
          apiKeys: true,
        },
      },
    },
  });

  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    host,
    remediationPolicy: readHostRemediationPolicyConfig(host.metaJson),
    fleetPolicy: readHostFleetPolicyConfig(host.metaJson),
  });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, buildPhase: true, host: null });
  }

  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "host.update.denied",
      detail: `status=${access.status} role=${access.role ?? "unknown"} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/hosts/[hostId]",
        method: "PUT",
        requiredRole: "admin",
        status: access.status,
        email: access.email ?? null,
        role: access.role ?? null,
      },
    });
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { hostId } = await ctx.params;
  const existing = await prisma.host.findFirst({
    where: {
      id: hostId,
      userId: access.identity.userId,
    },
    select: { id: true, name: true, slug: true, enabled: true, metaJson: true },
  });

  if (!existing) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const nextName = toName(body?.name);
  const nextEnabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  const requestedSlug = body?.slug === null ? null : toSlug(body?.slug);
  const requestedProfile =
    typeof body?.remediationPolicyProfile === "string"
      ? normalizeRemediationPolicyProfile(body.remediationPolicyProfile)
      : null;
  const fleetGroup = toFleetGroupMaybe(body?.fleetGroup);
  const fleetTags = toStringArrayMaybe(body?.fleetTags);
  const fleetScopes = toStringArrayMaybe(body?.fleetScopes);
  const fleetRolloutPaused = toBoolMaybe(body?.fleetRolloutPaused);
  const fleetRolloutPriority = toIntMaybe(body?.fleetRolloutPriority);

  const policyOverridesRaw = asRecord(body?.remediationPolicyOverrides);
  const guardOverridesRaw = asRecord(body?.remediationGuardOverrides);

  const remediationPolicyOverrides = policyOverridesRaw
    ? {
        dryRunMaxAgeMinutes: toIntMaybe(policyOverridesRaw.dryRunMaxAgeMinutes),
        executeCooldownMinutes: toIntMaybe(policyOverridesRaw.executeCooldownMinutes),
        maxExecutePerHour: toIntMaybe(policyOverridesRaw.maxExecutePerHour),
        timelineDedupeWindowMinutes: toIntMaybe(policyOverridesRaw.timelineDedupeWindowMinutes),
        maxQueuePerHost: toIntMaybe(policyOverridesRaw.maxQueuePerHost),
        maxQueueTotal: toIntMaybe(policyOverridesRaw.maxQueueTotal),
        queueTtlMinutes: toIntMaybe(policyOverridesRaw.queueTtlMinutes),
        maxRetryAttempts: toIntMaybe(policyOverridesRaw.maxRetryAttempts),
        retryBackoffSeconds: toIntMaybe(policyOverridesRaw.retryBackoffSeconds),
        retryBackoffMaxSeconds: toIntMaybe(policyOverridesRaw.retryBackoffMaxSeconds),
        commandTimeoutMs: toIntMaybe(policyOverridesRaw.commandTimeoutMs),
        maxBufferBytes: toIntMaybe(policyOverridesRaw.maxBufferBytes),
        queueAutoDrain: toBoolMaybe(policyOverridesRaw.queueAutoDrain),
        autonomousEnabled: toBoolMaybe(policyOverridesRaw.autonomousEnabled),
        autonomousMaxTier: toAutoTierMaybe(policyOverridesRaw.autonomousMaxTier),
        autonomousMaxQueuedPerCycle: toIntMaybe(
          policyOverridesRaw.autonomousMaxQueuedPerCycle
        ),
        autonomousMaxQueuedPerHour: toIntMaybe(
          policyOverridesRaw.autonomousMaxQueuedPerHour
        ),
        approvalRiskThreshold: toApprovalRiskThresholdMaybe(
          policyOverridesRaw.approvalRiskThreshold
        ),
        canaryRolloutPercent: toIntMaybe(policyOverridesRaw.canaryRolloutPercent),
        canaryRequireChecks: toBoolMaybe(policyOverridesRaw.canaryRequireChecks),
        autoRollback: toBoolMaybe(policyOverridesRaw.autoRollback),
      }
    : undefined;

  const remediationGuardOverrides = guardOverridesRaw
    ? {
        enforceAllowlist: toBoolMaybe(guardOverridesRaw.enforceAllowlist),
        maxCommandsPerAction: toIntMaybe(guardOverridesRaw.maxCommandsPerAction),
        maxCommandLength: toIntMaybe(guardOverridesRaw.maxCommandLength),
      }
    : undefined;

  const shouldUpdateRemediationPolicy =
    requestedProfile !== null || Boolean(policyOverridesRaw) || Boolean(guardOverridesRaw);
  const shouldUpdateFleetPolicy =
    fleetGroup !== undefined ||
    fleetTags !== undefined ||
    fleetScopes !== undefined ||
    fleetRolloutPaused !== undefined ||
    fleetRolloutPriority !== undefined;

  let resolvedSlug: string | null | undefined = undefined;
  if (requestedSlug === null && body?.slug === null) {
    resolvedSlug = null;
  } else if (requestedSlug) {
    resolvedSlug = await findUniqueSlug(access.identity.userId, existing.id, requestedSlug);
  }

  let nextMetaJson = existing.metaJson ?? null;
  if (shouldUpdateRemediationPolicy) {
    nextMetaJson = mergeHostRemediationPolicyMeta({
      currentMetaJson: nextMetaJson,
      profile: requestedProfile ?? undefined,
      overrides: remediationPolicyOverrides,
      guardOverrides: remediationGuardOverrides,
    });
  }
  if (shouldUpdateFleetPolicy) {
    nextMetaJson = mergeHostFleetPolicyMeta({
      currentMetaJson: nextMetaJson,
      patch: {
        group: fleetGroup,
        tags: fleetTags,
        scopes: fleetScopes,
        rolloutPaused: fleetRolloutPaused,
        rolloutPriority: fleetRolloutPriority,
      },
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const host = await tx.host.update({
      where: { id: existing.id },
      data: {
        name: nextName ?? undefined,
        enabled: nextEnabled === null ? undefined : nextEnabled,
        slug: resolvedSlug,
        metaJson:
          shouldUpdateRemediationPolicy || shouldUpdateFleetPolicy
            ? nextMetaJson
            : undefined,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        enabled: true,
        metaJson: true,
        updatedAt: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: access.identity.userId,
        hostId: existing.id,
        action: "host.update",
        detail: shouldUpdateRemediationPolicy || shouldUpdateFleetPolicy
          ? `Updated host '${host.name}' (including remediation/fleet policy)`
          : `Updated host '${host.name}'`,
      },
    });

    return host;
  });

  return NextResponse.json({
    ok: true,
    host: updated,
    remediationPolicy: readHostRemediationPolicyConfig(updated.metaJson),
    fleetPolicy: readHostFleetPolicyConfig(updated.metaJson),
  });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, buildPhase: true });
  }

  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "host.delete.denied",
      detail: `status=${access.status} role=${access.role ?? "unknown"} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/hosts/[hostId]",
        method: "DELETE",
        requiredRole: "admin",
        status: access.status,
        email: access.email ?? null,
        role: access.role ?? null,
      },
    });
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { hostId } = await ctx.params;
  const existing = await prisma.host.findFirst({
    where: {
      id: hostId,
      userId: access.identity.userId,
    },
    select: { id: true, name: true },
  });

  if (!existing) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: access.identity.userId,
        hostId: existing.id,
        action: "host.delete",
        detail: `Deleted host '${existing.name}'`,
      },
    });
    await tx.host.delete({ where: { id: existing.id } });
  });

  return NextResponse.json({ ok: true, deletedHostId: existing.id });
}
