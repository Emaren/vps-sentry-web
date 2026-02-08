import { prisma } from "@/lib/prisma";
import { classifyHeartbeat, readHeartbeatConfig } from "@/lib/host-heartbeat";
import { extractIngestMeta } from "@/lib/host-ingest";

const DEFAULT_LIMIT = 80;
const MIN_LIMIT = 20;
const MAX_LIMIT = 500;
const MAX_HOST_SNAPSHOTS = 25;
const MAX_HOST_BREACHES = 25;

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function safeParseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function trimString(v: unknown, max = 400): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max)}...[truncated]`;
}

function parseMetaJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  const parsed = safeParseJson(raw);
  return asRecord(parsed);
}

export function compactStatusForBundle(statusLike: unknown): Record<string, unknown> | null {
  const status = asRecord(statusLike);
  if (!status) return null;

  const out: Record<string, unknown> = {};
  const keys: string[] = [
    "host",
    "version",
    "ts",
    "ok",
    "alerts_count",
    "public_ports_count",
    "unexpected_public_ports_count",
    "expected_public_ports",
    "auth",
    "alerts",
    "ports_public",
    "ports_public_unexpected",
    "breaches_open",
    "breaches_fixed",
    "breaches",
    "last_ship_ok",
    "last_ship_ts",
    "last_ship_error",
  ];

  for (const key of keys) {
    if (!(key in status)) continue;
    const value = status[key];

    if (key === "alerts" && Array.isArray(value)) {
      out[key] = value.slice(0, 15);
      continue;
    }
    if ((key === "ports_public" || key === "ports_public_unexpected") && Array.isArray(value)) {
      out[key] = value.slice(0, 20);
      continue;
    }
    if (key === "breaches" && Array.isArray(value)) {
      out[key] = value.slice(0, 20);
      continue;
    }

    out[key] = value;
  }

  return out;
}

type BuildSupportBundleInput = {
  userId: string;
  hostId?: string | null;
  includeRaw?: boolean;
  limit?: number;
};

export class SupportBundleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function buildSupportBundle(input: BuildSupportBundleInput) {
  const userId = input.userId?.trim();
  if (!userId) throw new SupportBundleError(400, "Missing userId");

  const limit = clampInt(input.limit ?? DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
  const includeRaw = Boolean(input.includeRaw);
  const hostFilterId = input.hostId?.trim() || null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      createdAt: true,
      plan: true,
      hostLimit: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
    },
  });

  if (!user) throw new SupportBundleError(404, "User not found");

  const hosts = await prisma.host.findMany({
    where: {
      userId,
      ...(hostFilterId ? { id: hostFilterId } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      lastSeenAt: true,
      agentVersion: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          snapshots: true,
          breaches: true,
          remediationRuns: true,
          notificationEvents: true,
          apiKeys: true,
        },
      },
    },
  });

  if (hostFilterId && hosts.length === 0) {
    throw new SupportBundleError(404, "Host not found");
  }

  const hostIds = hosts.map((h) => h.id);
  const heartbeatConfig = readHeartbeatConfig();
  const now = new Date();

  const snapshotsTake = Math.max(limit * 4, 100);
  const breachesTake = Math.max(limit * 2, 60);

  const [snapshotRows, breachRows, breachStateCounts, notificationEndpoints, remediationRuns, auditLogs] =
    await Promise.all([
      hostIds.length
        ? prisma.hostSnapshot.findMany({
            where: { hostId: { in: hostIds } },
            orderBy: [{ ts: "desc" }, { id: "desc" }],
            take: snapshotsTake,
            select: {
              id: true,
              hostId: true,
              ts: true,
              ok: true,
              alertsCount: true,
              publicPortsCount: true,
              createdAt: true,
              statusJson: true,
              lastJson: true,
              diffJson: true,
            },
          })
        : Promise.resolve([]),
      hostIds.length
        ? prisma.breach.findMany({
            where: { hostId: { in: hostIds } },
            orderBy: [{ updatedAt: "desc" }, { openedTs: "desc" }],
            take: breachesTake,
            select: {
              id: true,
              hostId: true,
              code: true,
              title: true,
              detail: true,
              severity: true,
              state: true,
              openedTs: true,
              fixedTs: true,
              updatedAt: true,
              evidenceJson: true,
            },
          })
        : Promise.resolve([]),
      hostIds.length
        ? prisma.breach.groupBy({
            by: ["hostId", "state"],
            where: { hostId: { in: hostIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      prisma.notificationEndpoint.findMany({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }],
        take: limit,
        select: {
          id: true,
          kind: true,
          target: true,
          enabled: true,
          metaJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      hostIds.length
        ? prisma.remediationRun.findMany({
            where: { hostId: { in: hostIds } },
            orderBy: [{ requestedAt: "desc" }],
            take: limit,
            select: {
              id: true,
              hostId: true,
              state: true,
              requestedAt: true,
              startedAt: true,
              finishedAt: true,
              error: true,
              action: {
                select: {
                  key: true,
                  title: true,
                },
              },
              requestedBy: {
                select: {
                  email: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      prisma.auditLog.findMany({
        where: {
          OR: [{ userId }, hostIds.length ? { hostId: { in: hostIds } } : { id: "__none__" }],
        },
        orderBy: [{ createdAt: "desc" }],
        take: limit,
        select: {
          id: true,
          userId: true,
          hostId: true,
          action: true,
          detail: true,
          metaJson: true,
          ip: true,
          userAgent: true,
          createdAt: true,
        },
      }),
    ]);

  const endpointIds = notificationEndpoints.map((e) => e.id);
  const notificationEvents =
    hostIds.length || endpointIds.length
      ? await prisma.notificationEvent.findMany({
          where: {
            OR: [
              hostIds.length ? { hostId: { in: hostIds } } : { id: "__none_host__" },
              endpointIds.length ? { endpointId: { in: endpointIds } } : { id: "__none_endpoint__" },
            ],
          },
          orderBy: [{ createdAt: "desc" }],
          take: limit,
          select: {
            id: true,
            hostId: true,
            endpointId: true,
            eventType: true,
            title: true,
            detail: true,
            deliveredOk: true,
            deliveredTs: true,
            error: true,
            payloadJson: true,
            createdAt: true,
          },
        })
      : [];

  const hostById = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string | null;
      enabled: boolean;
      lastSeenAt: Date | null;
      agentVersion: string | null;
      createdAt: Date;
      updatedAt: Date;
      heartbeat: ReturnType<typeof classifyHeartbeat>;
      counts: {
        snapshots: number;
        breachesTotal: number;
        remediationRuns: number;
        notificationEvents: number;
        apiKeys: number;
      };
      breachesByState: Record<string, number>;
      recentSnapshots: Array<Record<string, unknown>>;
      recentBreaches: Array<Record<string, unknown>>;
    }
  >();

  for (const h of hosts) {
    hostById.set(h.id, {
      id: h.id,
      name: h.name,
      slug: h.slug,
      enabled: h.enabled,
      lastSeenAt: h.lastSeenAt,
      agentVersion: h.agentVersion,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
      heartbeat: classifyHeartbeat(h.lastSeenAt, now, heartbeatConfig),
      counts: {
        snapshots: h._count.snapshots,
        breachesTotal: h._count.breaches,
        remediationRuns: h._count.remediationRuns,
        notificationEvents: h._count.notificationEvents,
        apiKeys: h._count.apiKeys,
      },
      breachesByState: { open: 0, fixed: 0, ignored: 0 },
      recentSnapshots: [],
      recentBreaches: [],
    });
  }

  for (const c of breachStateCounts) {
    const host = hostById.get(c.hostId);
    if (!host) continue;
    host.breachesByState[c.state] = c._count._all;
  }

  for (const s of snapshotRows) {
    const host = hostById.get(s.hostId);
    if (!host || host.recentSnapshots.length >= MAX_HOST_SNAPSHOTS) continue;

    const statusRaw = safeParseJson(s.statusJson);
    const status = includeRaw ? statusRaw : compactStatusForBundle(statusRaw);
    const ingestMeta = extractIngestMeta(statusRaw);

    host.recentSnapshots.push({
      id: s.id,
      ts: s.ts,
      createdAt: s.createdAt,
      ok: s.ok,
      alertsCount: s.alertsCount,
      publicPortsCount: s.publicPortsCount,
      ingestIntegrity: ingestMeta,
      status,
      ...(includeRaw
        ? {
            last: safeParseJson(s.lastJson),
            diff: safeParseJson(s.diffJson),
          }
        : {}),
    });
  }

  for (const b of breachRows) {
    const host = hostById.get(b.hostId);
    if (!host || host.recentBreaches.length >= MAX_HOST_BREACHES) continue;

    host.recentBreaches.push({
      id: b.id,
      code: b.code,
      title: b.title,
      detail: trimString(b.detail, 1200),
      severity: b.severity,
      state: b.state,
      openedTs: b.openedTs,
      fixedTs: b.fixedTs,
      updatedAt: b.updatedAt,
      evidence: includeRaw ? safeParseJson(b.evidenceJson) : undefined,
    });
  }

  let staleHosts = 0;
  let missingHosts = 0;
  for (const host of hostById.values()) {
    if (host.heartbeat.state === "stale") staleHosts += 1;
    if (host.heartbeat.state === "missing") missingHosts += 1;
  }

  const hostsOut = Array.from(hostById.values());

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    filters: {
      hostId: hostFilterId,
      includeRaw,
      limit,
    },
    user: {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      plan: user.plan,
      hostLimit: user.hostLimit,
      subscriptionStatus: user.subscriptionStatus,
      currentPeriodEnd: user.currentPeriodEnd,
    },
    summary: {
      hosts: hostsOut.length,
      enabledHosts: hostsOut.filter((h) => h.enabled).length,
      staleHosts,
      missingHosts,
      totalSnapshots: hostsOut.reduce((sum, h) => sum + h.counts.snapshots, 0),
      totalBreaches: hostsOut.reduce((sum, h) => sum + h.counts.breachesTotal, 0),
      openBreaches: hostsOut.reduce((sum, h) => sum + (h.breachesByState.open ?? 0), 0),
      fixedBreaches: hostsOut.reduce((sum, h) => sum + (h.breachesByState.fixed ?? 0), 0),
      ignoredBreaches: hostsOut.reduce((sum, h) => sum + (h.breachesByState.ignored ?? 0), 0),
      notificationEndpoints: notificationEndpoints.length,
      notificationEventsRecent: notificationEvents.length,
      remediationRunsRecent: remediationRuns.length,
      auditLogsRecent: auditLogs.length,
    },
    hosts: hostsOut,
    notifications: {
      endpoints: notificationEndpoints.map((e) => ({
        id: e.id,
        kind: e.kind,
        target: e.target,
        enabled: e.enabled,
        meta: parseMetaJson(e.metaJson),
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      events: notificationEvents.map((e) => ({
        id: e.id,
        hostId: e.hostId,
        endpointId: e.endpointId,
        eventType: e.eventType,
        title: e.title,
        detail: trimString(e.detail, 1200),
        deliveredOk: e.deliveredOk,
        deliveredTs: e.deliveredTs,
        error: trimString(e.error, 1200),
        payload: includeRaw ? safeParseJson(e.payloadJson) : undefined,
        createdAt: e.createdAt,
      })),
    },
    remediationRuns: remediationRuns.map((r) => ({
      id: r.id,
      hostId: r.hostId,
      state: r.state,
      requestedAt: r.requestedAt,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      error: trimString(r.error, 1200),
      action: r.action,
      requestedBy: r.requestedBy?.email ?? null,
    })),
    auditLogs: auditLogs.map((a) => ({
      id: a.id,
      userId: a.userId,
      hostId: a.hostId,
      action: a.action,
      detail: trimString(a.detail, 1600),
      meta: parseMetaJson(a.metaJson),
      ip: a.ip,
      userAgent: trimString(a.userAgent, 240),
      createdAt: a.createdAt,
    })),
  };
}
