import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBaseUrlFromHeaders } from "@/lib/server-base-url";
import { classifyHeartbeat, readHeartbeatConfig } from "@/lib/host-heartbeat";
import {
  buildIngestEndpoint,
  buildShipHookInstallScript,
  buildTestIngestCommand,
  buildUniqueSlug,
  generateHostTokenBundle,
  slugifyHostName,
} from "@/lib/host-onboarding";
import { HOST_KEY_DEFAULT_SCOPES, serializeHostKeyScopes } from "@/lib/host-keys";
import {
  mergeHostFleetPolicyMeta,
  readHostFleetPolicyConfig,
} from "@/lib/remediate/fleet-policy";
import { requireAdminAccess, requireViewerAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

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

function toStringArray(input: unknown, maxItems = 30): string[] | undefined {
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
    if (out.length >= maxItems) break;
  }
  return out;
}

function toFleetGroup(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || null;
}

function toBoolMaybe(input: unknown): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const t = input.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return undefined;
}

function toIntMaybe(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

async function findUniqueSlug(userId: string, preferredBase: string): Promise<string> {
  const base = slugifyHostName(preferredBase);
  for (let i = 0; i < 50; i++) {
    const candidate = buildUniqueSlug(base, i);
    const exists = await prisma.host.findFirst({
      where: { userId, slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  // extremely unlikely fallback
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export async function GET() {
  const access = await requireViewerAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const user = await prisma.user.findUnique({
    where: { id: access.identity.userId },
    select: {
      id: true,
      email: true,
      plan: true,
      hostLimit: true,
    },
  });
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const heartbeatConfig = readHeartbeatConfig();

  const hosts = await prisma.host.findMany({
    where: { userId: user.id },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      metaJson: true,
      agentVersion: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      snapshots: {
        orderBy: { ts: "desc" },
        take: 1,
        select: {
          id: true,
          ts: true,
          ok: true,
          alertsCount: true,
          publicPortsCount: true,
        },
      },
      apiKeys: {
        where: { revokedAt: null },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          lastUsedAt: true,
          createdAt: true,
          prefix: true,
          version: true,
          scopeJson: true,
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

  const hostIds = hosts.map((h) => h.id);
  const openBreaches = hostIds.length
    ? await prisma.breach.groupBy({
        by: ["hostId"],
        where: {
          hostId: { in: hostIds },
          state: "open",
        },
        _count: { _all: true },
      })
    : [];

  const openByHost = new Map<string, number>();
  for (const row of openBreaches) {
    openByHost.set(row.hostId, row._count._all);
  }

  const items = hosts.map((h) => {
    const latest = h.snapshots[0] ?? null;
    const latestKey = h.apiKeys[0] ?? null;
    const heartbeat = classifyHeartbeat(h.lastSeenAt, new Date(), heartbeatConfig);

    return {
      id: h.id,
      name: h.name,
      slug: h.slug,
      enabled: h.enabled,
      fleetPolicy: readHostFleetPolicyConfig(h.metaJson),
      agentVersion: h.agentVersion,
      lastSeenAt: h.lastSeenAt,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
      latestSnapshot: latest,
      heartbeat,
      activeKey: latestKey
        ? {
            id: latestKey.id,
            prefix: latestKey.prefix,
            version: latestKey.version,
            scopeJson: latestKey.scopeJson,
            lastUsedAt: latestKey.lastUsedAt,
            createdAt: latestKey.createdAt,
          }
        : null,
      counts: {
        snapshots: h._count.snapshots,
        breachesTotal: h._count.breaches,
        breachesOpen: openByHost.get(h.id) ?? 0,
        apiKeysTotal: h._count.apiKeys,
      },
    };
  });

  return NextResponse.json({
    ok: true,
    hosts: items,
    usage: {
      current: items.length,
      hostLimit: user.hostLimit ?? 1,
      plan: user.plan,
    },
  });
}

export async function POST(req: Request) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "host.create.denied",
      detail: `status=${access.status} role=${access.role ?? "unknown"} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/hosts",
        status: access.status,
        requiredRole: "admin",
        email: access.email ?? null,
        role: access.role ?? null,
      },
    });
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const user = await prisma.user.findUnique({
    where: { id: access.identity.userId },
    select: {
      id: true,
      email: true,
      plan: true,
      hostLimit: true,
    },
  });
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedName = toName(body?.name) ?? "New VPS Host";
  const requestedSlug = toSlug(body?.slug);
  const fleetGroup = toFleetGroup(body?.fleetGroup);
  const fleetTags = toStringArray(body?.fleetTags);
  const fleetScopes = toStringArray(body?.fleetScopes);
  const fleetRolloutPaused = toBoolMaybe(body?.fleetRolloutPaused);
  const fleetRolloutPriority = toIntMaybe(body?.fleetRolloutPriority);

  const hasFleetPatch =
    fleetGroup !== undefined ||
    fleetTags !== undefined ||
    fleetScopes !== undefined ||
    fleetRolloutPaused !== undefined ||
    fleetRolloutPriority !== undefined;
  const initialMetaJson = hasFleetPatch
    ? mergeHostFleetPolicyMeta({
        currentMetaJson: null,
        patch: {
          group: fleetGroup,
          tags: fleetTags,
          scopes: fleetScopes,
          rolloutPaused: fleetRolloutPaused,
          rolloutPriority: fleetRolloutPriority,
        },
      })
    : null;

  const existingCount = await prisma.host.count({ where: { userId: user.id } });
  const hostLimit = user.hostLimit ?? 1;
  if (existingCount >= hostLimit) {
    return NextResponse.json(
      {
        ok: false,
        error: `Host limit reached (${hostLimit}). Upgrade your plan to add more hosts.`,
        usage: { current: existingCount, hostLimit },
      },
      { status: 403 }
    );
  }

  const slug = await findUniqueSlug(user.id, requestedSlug ?? requestedName);
  const tokenBundle = generateHostTokenBundle({ version: 1 });

  const created = await prisma.$transaction(async (tx) => {
    const host = await tx.host.create({
      data: {
        userId: user.id,
        name: requestedName,
        slug,
        enabled: true,
        metaJson: initialMetaJson ?? undefined,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        enabled: true,
        metaJson: true,
        createdAt: true,
      },
    });

    await tx.hostApiKey.create({
      data: {
        hostId: host.id,
        tokenHash: tokenBundle.tokenHash,
        prefix: tokenBundle.prefix,
        version: tokenBundle.version,
        label: "primary",
        scopeJson: serializeHostKeyScopes(HOST_KEY_DEFAULT_SCOPES),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        hostId: host.id,
        action: "host.create",
        detail: `Created host '${host.name}' (${host.slug ?? host.id})`,
      },
    });

    return host;
  });

  const baseUrl = await getBaseUrlFromHeaders();
  const ingestEndpoint = buildIngestEndpoint(baseUrl, created.id);
  const testIngestCommand = buildTestIngestCommand({
    ingestEndpoint,
    token: tokenBundle.token,
  });
  const installHookScript = buildShipHookInstallScript({
    ingestEndpoint,
    token: tokenBundle.token,
  });

  return NextResponse.json({
    ok: true,
    host: {
      ...created,
      fleetPolicy: readHostFleetPolicyConfig(created.metaJson),
    },
    onboarding: {
      ingestEndpoint,
      token: tokenBundle.token,
      tokenPrefix: tokenBundle.prefix,
      tokenVersion: tokenBundle.version,
      tokenScopes: HOST_KEY_DEFAULT_SCOPES,
      testIngestCommand,
      installHookScript,
      note: "Token is shown once. Save it now.",
    },
  });
}
