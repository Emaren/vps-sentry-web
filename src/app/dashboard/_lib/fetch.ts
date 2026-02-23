// /var/www/vps-sentry-web/src/app/dashboard/_lib/fetch.ts
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { getBaseUrlFromHeaders } from "@/lib/server-base-url";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";
import { getRemediationQueueSnapshot } from "@/lib/remediate/queue";
import { parseExecuteRunPayload } from "@/lib/remediate/queue-runtime";
import { listIncidentRuns } from "@/lib/ops/incident-engine";
import { buildSloSnapshot } from "@/lib/slo";
import { getObservabilitySnapshot } from "@/lib/observability";
import { INCIDENT_WORKFLOWS } from "@/lib/ops/workflows";
import { readHostFleetPolicyConfig } from "@/lib/remediate/fleet-policy";
import { buildIncidentTimeline, type SignalSeverity } from "@/lib/incident-signals";
import {
  normalizeStatusEnvelope,
  type Status,
  type StatusEnvelope,
} from "@/lib/status";
import type {
  DashboardAdaptiveCorrelation,
  DashboardAdaptiveRecommendation,
  DashboardAdaptiveSnapshot,
  DashboardBreachesSnapshot,
  DashboardFleetSummary,
  DashboardKeyLifecycleSummary,
  DashboardOpsPanelHealth,
  DashboardOpsSnapshot,
  DashboardRemediationRunItem,
  DashboardRemediationSnapshot,
  DashboardShippingSnapshot,
} from "./types";
import {
  panelEmpty,
  panelError,
  panelForbidden,
  panelReady,
} from "./panel-health";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapToSortedEntries(map: Map<string, number>, limit = 6) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function toIso(v: Date | null | undefined): string | null {
  if (!v) return null;
  return v.toISOString();
}

type LegacyPortsEnvelope = {
  ports_local?: unknown;
  ports_public?: unknown;
  ports?: {
    local?: unknown;
    public?: unknown;
  };
};

function parseStatusObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function severityRank(severity: SignalSeverity): number {
  if (severity === "critical") return 5;
  if (severity === "high") return 4;
  if (severity === "medium") return 3;
  if (severity === "low") return 2;
  return 1;
}

function toAdaptiveSeverity(severity: SignalSeverity): "info" | "warn" | "critical" {
  if (severity === "critical" || severity === "high") return "critical";
  if (severity === "medium") return "warn";
  return "info";
}
function signalLabelFromCode(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export async function getStatusEnvelopeSafe() {
  const base = await getBaseUrlFromHeaders();
  const incomingHeaders = await headers();
  const forwardedCookie = incomingHeaders.get("cookie");
  const forwardedAuthorization = incomingHeaders.get("authorization");

  try {
    const res = await fetch(`${base}/api/status`, {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(forwardedCookie ? { cookie: forwardedCookie } : {}),
        ...(forwardedAuthorization ? { authorization: forwardedAuthorization } : {}),
      },
    });

    const ts = new Date().toISOString();

    // Try to parse JSON even on non-200 so we can render something.
    const data = (await res.json().catch(() => null)) as unknown;

    if (!res.ok || !data || typeof data !== "object") {
      return normalizeStatusEnvelope({
        ok: false,
        ts,
        status: {
          host: "—",
          version: "—",
          ts,
          alerts_count: 1,
          alerts: [
            {
              title: "Status unavailable",
              detail: `GET /api/status -> ${res.status}`,
            },
          ],
          public_ports_count: 0,
          ports_public: [],
        },
        diff: null,
        warnings: [`dashboard_fallback: /api/status returned ${res.status}`],
      });
    }

    // ✅ FIX: /api/status returns BOTH `status` and `last`, but ports_local is in `last`.
    // Merge `status` into `last` so UI can always see ports_local/ports_public.
    const obj = data as Record<string, unknown>;
    const status =
      obj.status && typeof obj.status === "object" && !Array.isArray(obj.status)
        ? (obj.status as LegacyPortsEnvelope)
        : null;

    const last =
      obj.last && typeof obj.last === "object" && !Array.isArray(obj.last)
        ? (obj.last as LegacyPortsEnvelope)
        : null;

    if (status || last) {
      const safeArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

      const portsLocal = safeArr(
        last?.ports_local ?? last?.ports?.local
      );

      const portsPublicFromStatus = safeArr(
        status?.ports_public ?? status?.ports?.public
      );
      const portsPublicFromLast = safeArr(
        last?.ports_public ?? last?.ports?.public
      );
      const portsPublic =
        portsPublicFromStatus.length > 0 ? portsPublicFromStatus : portsPublicFromLast;

      // Ensure BOTH roots expose ports_local/ports_public so downstream derive logic
      // can’t “miss” them depending on which root it uses.
      const patchedStatus = {
        ...(status ?? {}),
        ports_local: portsLocal,
        ports_public: portsPublic,
      };

      const patchedLast = {
        ...(status ?? {}),
        ...(last ?? {}),
        ports_local: portsLocal,
        ports_public: portsPublic,
      };

      const patched = { ...obj, status: patchedStatus, last: patchedLast };
      return normalizeStatusEnvelope(patched as Status | StatusEnvelope);
    }

    return normalizeStatusEnvelope(data as Status | StatusEnvelope);
  } catch (e: unknown) {
    const ts = new Date().toISOString();
    const detail = errorMessage(e);
    return normalizeStatusEnvelope({
      ok: false,
      ts,
      status: {
        host: "—",
        version: "—",
        ts,
        alerts_count: 1,
        alerts: [{ title: "Status fetch failed", detail }],
        public_ports_count: 0,
        ports_public: [],
      },
      diff: null,
      warnings: [`dashboard_fallback: ${detail}`],
    });
  }
}

export async function getUserBilling(email?: string | null) {
  if (!email) return null;
  try {
    const u = await prisma.user.findUnique({
      where: { email },
      select: {
        plan: true,
        hostLimit: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return u;
  } catch {
    return null;
  }
}

async function getFleetSummaryForUser(userId: string): Promise<DashboardFleetSummary> {
  const rows = await prisma.host.findMany({
    where: { userId },
    select: {
      id: true,
      enabled: true,
      metaJson: true,
    },
  });

  const groups = new Map<string, number>();
  const tags = new Map<string, number>();
  const scopes = new Map<string, number>();

  let pausedHosts = 0;
  let groupedHosts = 0;
  let enabledHosts = 0;

  for (const row of rows) {
    if (row.enabled) enabledHosts += 1;

    const fleet = readHostFleetPolicyConfig(row.metaJson);
    if (fleet.rolloutPaused) pausedHosts += 1;
    if (fleet.group) groupedHosts += 1;

    const groupKey = fleet.group ?? "ungrouped";
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + 1);
    for (const tag of fleet.tags) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    for (const scope of fleet.scopes) {
      scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    }
  }

  return {
    totalHosts: rows.length,
    enabledHosts,
    pausedHosts,
    groupedHosts,
    topGroups: mapToSortedEntries(groups, 6),
    topTags: mapToSortedEntries(tags, 8),
    topScopes: mapToSortedEntries(scopes, 8),
  };
}

async function getKeyLifecycleSummaryForUser(userId: string): Promise<DashboardKeyLifecycleSummary> {
  const rows = await prisma.hostApiKey.findMany({
    where: {
      host: { userId },
    },
    select: {
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
      version: true,
    },
  });

  const nowMs = Date.now();
  const soonMs = nowMs + 7 * 24 * 60 * 60 * 1000;
  const staleMs = nowMs - 30 * 24 * 60 * 60 * 1000;

  let activeKeys = 0;
  let revokedKeys = 0;
  let expiredKeys = 0;
  let expiringSoonKeys = 0;
  let staleKeys = 0;
  let maxVersion = 0;

  for (const row of rows) {
    if (row.version > maxVersion) maxVersion = row.version;

    if (row.revokedAt) {
      revokedKeys += 1;
      continue;
    }

    const expiresMs = row.expiresAt ? row.expiresAt.getTime() : null;
    if (expiresMs !== null && expiresMs <= nowMs) {
      expiredKeys += 1;
      continue;
    }

    activeKeys += 1;

    if (expiresMs !== null && expiresMs <= soonMs) {
      expiringSoonKeys += 1;
    }

    const lastActivityMs = row.lastUsedAt
      ? row.lastUsedAt.getTime()
      : row.createdAt.getTime();
    if (lastActivityMs < staleMs) {
      staleKeys += 1;
    }
  }

  return {
    totalKeys: rows.length,
    activeKeys,
    revokedKeys,
    expiredKeys,
    expiringSoonKeys,
    staleKeys,
    maxVersion,
  };
}

async function getBreachesSnapshotForHosts(input: {
  hostIds: string[];
}): Promise<DashboardBreachesSnapshot> {
  if (input.hostIds.length === 0) {
    return {
      counts: {
        total: 0,
        open: 0,
        fixed: 0,
        ignored: 0,
      },
      recent: [],
    };
  }

  const [counts, rows] = await Promise.all([
    prisma.breach.groupBy({
      by: ["state"],
      where: {
        hostId: { in: input.hostIds },
      },
      _count: { _all: true },
    }),
    prisma.breach.findMany({
      where: {
        hostId: { in: input.hostIds },
      },
      orderBy: [{ openedTs: "desc" }],
      take: 30,
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
        host: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
    }),
  ]);

  const byState = new Map<string, number>();
  for (const row of counts) byState.set(row.state, row._count._all);

  return {
    counts: {
      total: rows.length,
      open: byState.get("open") ?? 0,
      fixed: byState.get("fixed") ?? 0,
      ignored: byState.get("ignored") ?? 0,
    },
    recent: rows.map((row) => ({
      id: row.id,
      hostId: row.hostId,
      hostName: row.host.name,
      hostSlug: row.host.slug,
      code: row.code,
      title: row.title,
      detail: row.detail,
      severity: row.severity,
      state: row.state,
      openedTs: row.openedTs.toISOString(),
      fixedTs: toIso(row.fixedTs),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

async function getShippingSnapshotForUser(input: {
  userId: string;
  hostIds: string[];
}): Promise<DashboardShippingSnapshot> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const scopedOr: Array<Record<string, unknown>> = [
    { endpoint: { userId: input.userId } },
  ];
  if (input.hostIds.length > 0) {
    scopedOr.push({ hostId: { in: input.hostIds } });
  }

  const where = { OR: scopedOr };

  const [total, delivered, failed, pending, last24h, failed24h, rows] =
    await Promise.all([
      prisma.notificationEvent.count({ where }),
      prisma.notificationEvent.count({ where: { ...where, deliveredOk: true } }),
      prisma.notificationEvent.count({ where: { ...where, deliveredOk: false } }),
      prisma.notificationEvent.count({ where: { ...where, deliveredOk: null } }),
      prisma.notificationEvent.count({
        where: { ...where, createdAt: { gte: oneDayAgo } },
      }),
      prisma.notificationEvent.count({
        where: { ...where, createdAt: { gte: oneDayAgo }, deliveredOk: false },
      }),
      prisma.notificationEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take: 40,
        select: {
          id: true,
          hostId: true,
          eventType: true,
          title: true,
          detail: true,
          deliveredOk: true,
          deliveredTs: true,
          error: true,
          createdAt: true,
          host: {
            select: {
              name: true,
            },
          },
          endpoint: {
            select: {
              kind: true,
              target: true,
            },
          },
        },
      }),
    ]);

  let lastDeliveredTs: string | null = null;
  let lastFailedTs: string | null = null;
  let lastError: string | null = null;

  for (const row of rows) {
    if (!lastDeliveredTs && row.deliveredOk && row.deliveredTs) {
      lastDeliveredTs = row.deliveredTs.toISOString();
    }
    if (!lastFailedTs && row.deliveredOk === false) {
      lastFailedTs = row.createdAt.toISOString();
    }
    if (!lastError && row.error) {
      lastError = row.error;
    }
    if (lastDeliveredTs && lastFailedTs && lastError) break;
  }

  return {
    counts: {
      total,
      delivered,
      failed,
      pending,
      last24h,
      failed24h,
    },
    lastDeliveredTs,
    lastFailedTs,
    lastError,
    recent: rows.map((row) => ({
      id: row.id,
      hostId: row.hostId,
      hostName: row.host?.name ?? null,
      eventType: row.eventType,
      title: row.title,
      detail: row.detail,
      deliveredOk: row.deliveredOk,
      deliveredTs: toIso(row.deliveredTs),
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      endpointKind: row.endpoint?.kind ?? null,
      endpointTarget: row.endpoint?.target ?? null,
    })),
  };
}

async function getRemediationSnapshotForHosts(input: {
  hostIds: string[];
}): Promise<DashboardRemediationSnapshot> {
  if (input.hostIds.length === 0) {
    return {
      counts: {
        total: 0,
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        canceled: 0,
        dlq: 0,
        approvalPending: 0,
        retryScheduled: 0,
        autoQueued: 0,
      },
      recentRuns: [],
    };
  }

  const rows = await prisma.remediationRun.findMany({
    where: {
      hostId: { in: input.hostIds },
      paramsJson: { contains: '"mode":"execute"' },
    },
    orderBy: [{ requestedAt: "desc" }],
    take: 80,
    select: {
      id: true,
      hostId: true,
      state: true,
      requestedAt: true,
      startedAt: true,
      finishedAt: true,
      paramsJson: true,
      error: true,
      host: {
        select: {
          name: true,
        },
      },
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
  });

  const counts = {
    total: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    canceled: 0,
    dlq: 0,
    approvalPending: 0,
    retryScheduled: 0,
    autoQueued: 0,
  };

  const recentRuns: DashboardRemediationRunItem[] = rows.map((row) => {
    const payload = parseExecuteRunPayload(row.paramsJson, {
      defaultMaxAttempts: 3,
    });
    const queue = payload?.queue ?? null;
    const retryScheduled = Boolean(queue?.nextAttemptAt);
    const approvalPending = Boolean(
      queue?.approval.required && queue.approval.status === "pending"
    );
    const dlq = Boolean(queue?.dlq);
    const autoQueued = Boolean(queue?.autoQueued);

    counts.total += 1;
    if (row.state === "queued") counts.queued += 1;
    if (row.state === "running") counts.running += 1;
    if (row.state === "succeeded") counts.succeeded += 1;
    if (row.state === "failed") counts.failed += 1;
    if (row.state === "canceled") counts.canceled += 1;
    if (dlq) counts.dlq += 1;
    if (approvalPending) counts.approvalPending += 1;
    if (retryScheduled) counts.retryScheduled += 1;
    if (autoQueued) counts.autoQueued += 1;

    return {
      runId: row.id,
      hostId: row.hostId,
      hostName: row.host.name,
      actionKey: row.action.key,
      actionTitle: row.action.title,
      state: row.state,
      requestedAt: row.requestedAt.toISOString(),
      startedAt: toIso(row.startedAt),
      finishedAt: toIso(row.finishedAt),
      requestedByEmail: row.requestedBy?.email ?? null,
      attempts: queue?.attempts ?? 0,
      maxAttempts: queue?.maxAttempts ?? 3,
      dlq,
      approvalPending,
      retryScheduled,
      canaryPassed: queue?.canary.passed ?? null,
      rollbackAttempted: queue?.rollback.attempted ?? false,
      rollbackSucceeded: queue?.rollback.succeeded ?? null,
      autoQueued,
      autoTier: queue?.autoTier ?? null,
      error: row.error,
    };
  });

  return {
    counts,
    recentRuns,
  };
}

async function getAdaptiveSnapshotForUser(input: {
  userId: string;
  remediation: DashboardRemediationSnapshot | null;
  breaches: DashboardBreachesSnapshot | null;
}): Promise<DashboardAdaptiveSnapshot> {
  const hosts = await prisma.host.findMany({
    where: {
      userId: input.userId,
    },
    select: {
      id: true,
      name: true,
      snapshots: {
        orderBy: [{ ts: "desc" }],
        take: 8,
        select: {
          id: true,
          ts: true,
          statusJson: true,
        },
      },
    },
  });

  type CorrelationState = {
    key: string;
    title: string;
    maxSeverity: SignalSeverity;
    signalCount: number;
    hosts: Set<string>;
  };

  const codeMap = new Map<string, CorrelationState>();

  for (const host of hosts) {
    const snapshots = host.snapshots
      .map((row) => {
        const status = parseStatusObject(row.statusJson);
        if (!status) return null;
        return {
          id: row.id,
          ts: row.ts,
          status,
        };
      })
      .filter(
        (
          row
        ): row is {
          id: string;
          ts: Date;
          status: Record<string, unknown>;
        } => Boolean(row)
      );

    if (snapshots.length === 0) continue;

    const timelineResult = buildIncidentTimeline(snapshots, {
      dedupeWindowMinutes: 45,
    });

    for (const signal of timelineResult.timeline) {
      const current = codeMap.get(signal.code);
      if (!current) {
        codeMap.set(signal.code, {
          key: signal.code,
          title: signal.title || signalLabelFromCode(signal.code),
          maxSeverity: signal.severity,
          signalCount: 1,
          hosts: new Set([host.name]),
        });
        continue;
      }

      current.signalCount += 1;
      current.hosts.add(host.name);
      if (severityRank(signal.severity) > severityRank(current.maxSeverity)) {
        current.maxSeverity = signal.severity;
        current.title = signal.title || current.title;
      }
    }
  }

  const correlations: DashboardAdaptiveCorrelation[] = Array.from(codeMap.values())
    .map((row) => ({
      key: row.key,
      title: row.title,
      severity: toAdaptiveSeverity(row.maxSeverity),
      hostCount: row.hosts.size,
      signalCount: row.signalCount,
      hosts: Array.from(row.hosts).sort(),
      detail: `${row.signalCount} signal(s) across ${row.hosts.size} host(s)`,
    }))
    .sort((a, b) => {
      const sevA = a.severity === "critical" ? 3 : a.severity === "warn" ? 2 : 1;
      const sevB = b.severity === "critical" ? 3 : b.severity === "warn" ? 2 : 1;
      return sevB - sevA || b.hostCount - a.hostCount || b.signalCount - a.signalCount;
    })
    .slice(0, 8);

  const correlationByKey = new Map(correlations.map((c) => [c.key, c]));
  const recommendations: DashboardAdaptiveRecommendation[] = [];

  const sshNoiseHostCount =
    (correlationByKey.get("ssh_failed_password")?.hostCount ?? 0) +
    (correlationByKey.get("ssh_invalid_user")?.hostCount ?? 0);
  if (sshNoiseHostCount >= 2) {
    recommendations.push({
      id: "adaptive-ssh-bruteforce-profile",
      priority: "high",
      title: "Auto-tune SSH hardening profile for noisy ingress",
      why: "SSH brute-force style signals are correlated across multiple hosts.",
      suggestedAction:
        "Apply stricter SSH/lockdown response profile to exposed host groups and reduce ack timer for auth incidents.",
      evidence: [
        `failed_password hosts: ${correlationByKey.get("ssh_failed_password")?.hostCount ?? 0}`,
        `invalid_user hosts: ${correlationByKey.get("ssh_invalid_user")?.hostCount ?? 0}`,
      ],
    });
  }

  if (correlationByKey.has("unexpected_public_ports")) {
    const row = correlationByKey.get("unexpected_public_ports");
    recommendations.push({
      id: "adaptive-public-port-guard",
      priority: "high",
      title: "Tighten public-port policy and staged remediation rollout",
      why: "Unexpected public listeners were detected and correlated by host.",
      suggestedAction:
        "Enable stricter fleet scope policy for public-port actions and run staged canary remediation with automatic rollback.",
      evidence: [
        `hosts impacted: ${row?.hostCount ?? 0}`,
        `signals: ${row?.signalCount ?? 0}`,
      ],
    });
  }

  if (correlationByKey.has("config_tamper") || correlationByKey.has("firewall_drift")) {
    recommendations.push({
      id: "adaptive-config-guard",
      priority: "high",
      title: "Promote config/firewall drift to guarded auto-remediation",
      why: "Sensitive control-plane drift signals are present in recent correlated timeline data.",
      suggestedAction:
        "Escalate config/firewall drift to guarded auto tier with mandatory dry-run freshness and approval for risky rollback paths.",
      evidence: [
        `config_tamper: ${correlationByKey.get("config_tamper")?.signalCount ?? 0}`,
        `firewall_drift: ${correlationByKey.get("firewall_drift")?.signalCount ?? 0}`,
      ],
    });
  }

  if (
    correlationByKey.has("package_drift") &&
    !correlationByKey.has("config_tamper") &&
    !correlationByKey.has("unexpected_public_ports")
  ) {
    recommendations.push({
      id: "adaptive-maintenance-noise-window",
      priority: "medium",
      title: "Auto-tune maintenance/suppression window for package churn",
      why: "Package drift dominates recent signals without matching high-risk control-plane drift.",
      suggestedAction:
        "Increase maintenance-window suppression for package-change noise while preserving runtime and auth high-severity alerts.",
      evidence: [
        `package_drift signals: ${correlationByKey.get("package_drift")?.signalCount ?? 0}`,
      ],
    });
  }

  if ((input.remediation?.counts.dlq ?? 0) > 0) {
    recommendations.push({
      id: "adaptive-dlq-replay-safety",
      priority: "medium",
      title: "Stabilize remediation DLQ and replay strategy",
      why: "Dead-letter remediation runs indicate automation execution instability.",
      suggestedAction:
        "Prioritize replay of DLQ runs with canary checks enabled and attach rollback notes to recurring failures.",
      evidence: [
        `dlq runs: ${input.remediation?.counts.dlq ?? 0}`,
        `retry scheduled: ${input.remediation?.counts.retryScheduled ?? 0}`,
      ],
    });
  }

  if ((input.breaches?.counts.open ?? 0) > 0) {
    recommendations.push({
      id: "adaptive-open-breach-focus",
      priority: "high",
      title: "Bias policy toward breach closure acceleration",
      why: "Open breaches remain in the active window and should gate aggressive automation.",
      suggestedAction:
        "Prioritize incident assignment/escalation on open breaches and temporarily tighten risky autonomous tiers.",
      evidence: [
        `open breaches: ${input.breaches?.counts.open ?? 0}`,
        `fixed breaches: ${input.breaches?.counts.fixed ?? 0}`,
      ],
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "adaptive-steady-state",
      priority: "low",
      title: "System stable: keep collecting correlation telemetry",
      why: "No dominant high-risk correlated pattern was detected in current host timelines.",
      suggestedAction:
        "Continue baseline monitoring and keep adaptive policy in observe/safe_auto mode for additional data.",
      evidence: [
        `correlations tracked: ${correlations.length}`,
        `generated: ${new Date().toISOString()}`,
      ],
    });
  }

  const priorityRank = { high: 3, medium: 2, low: 1 } as const;
  recommendations.sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority]);

  return {
    generatedAtIso: new Date().toISOString(),
    correlations,
    recommendations: recommendations.slice(0, 6),
  };
}

export async function getDashboardOpsSnapshot(input: {
  userId: string;
  userRole: AppRole;
}): Promise<DashboardOpsSnapshot> {
  const canOps = hasRequiredRole(input.userRole, "ops");
  const canAdmin = hasRequiredRole(input.userRole, "admin");
  const updatedAtIso = new Date().toISOString();

  const hostRows = await prisma.host.findMany({
    where: { userId: input.userId },
    select: {
      id: true,
    },
  });
  const hostIds = hostRows.map((row) => row.id);

  const [breachesRes, shippingRes, remediationRes] = await Promise.allSettled([
    getBreachesSnapshotForHosts({ hostIds }),
    getShippingSnapshotForUser({
      userId: input.userId,
      hostIds,
    }),
    getRemediationSnapshotForHosts({ hostIds }),
  ]);

  const breaches = breachesRes.status === "fulfilled" ? breachesRes.value : null;
  const shipping = shippingRes.status === "fulfilled" ? shippingRes.value : null;
  const remediation = remediationRes.status === "fulfilled" ? remediationRes.value : null;

  const panelHealth: DashboardOpsPanelHealth = {
    breaches:
      breachesRes.status === "fulfilled"
        ? breachesRes.value.counts.total > 0
          ? panelReady(
              `Live breach ledger connected (${breachesRes.value.counts.total} records).`,
              updatedAtIso
            )
          : panelEmpty("Breach ledger connected; no breach records found.", updatedAtIso)
        : panelError(
            `Breach ledger unavailable: ${errorMessage(breachesRes.reason)}`,
            updatedAtIso
          ),
    shipping:
      shippingRes.status === "fulfilled"
        ? shippingRes.value.counts.total > 0
          ? panelReady(
              `Live notification ledger connected (${shippingRes.value.counts.total} events).`,
              updatedAtIso
            )
          : panelEmpty("Notification ledger connected; no shipping events found.", updatedAtIso)
        : panelError(
            `Notification ledger unavailable: ${errorMessage(shippingRes.reason)}`,
            updatedAtIso
          ),
    remediation:
      remediationRes.status === "fulfilled"
        ? remediationRes.value.counts.total > 0
          ? panelReady(
              `Remediation runtime connected (${remediationRes.value.counts.total} runs).`,
              updatedAtIso
            )
          : panelEmpty("Remediation runtime connected; no runs recorded yet.", updatedAtIso)
        : panelError(
            `Remediation runtime unavailable: ${errorMessage(remediationRes.reason)}`,
            updatedAtIso
          ),
    queue: canOps
      ? panelEmpty("Queue runtime waiting for backend response.", updatedAtIso)
      : panelForbidden("Ops role required for queue runtime.", updatedAtIso),
    incidents: canOps
      ? panelEmpty("Incident workflow runtime waiting for backend response.", updatedAtIso)
      : panelForbidden("Ops role required for incident runtime.", updatedAtIso),
    slo: canOps
      ? panelEmpty("SLO runtime waiting for backend response.", updatedAtIso)
      : panelForbidden("Ops role required for SLO runtime.", updatedAtIso),
    observability: canAdmin
      ? panelEmpty("Observability runtime waiting for backend response.", updatedAtIso)
      : panelForbidden("Admin role required for observability runtime.", updatedAtIso),
    fleet: canAdmin
      ? panelEmpty("Fleet policy runtime waiting for backend response.", updatedAtIso)
      : panelForbidden("Admin role required for fleet runtime.", updatedAtIso),
    keyLifecycle: canAdmin
      ? panelEmpty("Key lifecycle runtime waiting for backend response.", updatedAtIso)
      : panelForbidden("Admin role required for key lifecycle runtime.", updatedAtIso),
    adaptive: panelEmpty("Adaptive correlation runtime waiting for backend response.", updatedAtIso),
  };

  let queue: DashboardOpsSnapshot["queue"] = null;
  let incidents: DashboardOpsSnapshot["incidents"] = null;
  let slo: DashboardOpsSnapshot["slo"] = null;

  if (canOps) {
    const [queueRes, incidentsRes, sloRes] = await Promise.allSettled([
      getRemediationQueueSnapshot({ limit: 30 }),
      listIncidentRuns({ limit: 30, state: "active", includeClosed: false }),
      buildSloSnapshot(),
    ]);
    queue = queueRes.status === "fulfilled" ? queueRes.value : null;
    incidents = incidentsRes.status === "fulfilled" ? incidentsRes.value : null;
    slo = sloRes.status === "fulfilled" ? sloRes.value : null;

    panelHealth.queue =
      queueRes.status === "fulfilled"
        ? queueRes.value.items.length > 0
          ? panelReady(
              `Queue runtime connected (${queueRes.value.items.length} visible items).`,
              updatedAtIso
            )
          : panelEmpty("Queue runtime connected; no queued/running items for current filter.", updatedAtIso)
        : panelError(`Queue runtime unavailable: ${errorMessage(queueRes.reason)}`, updatedAtIso);

    panelHealth.incidents =
      incidentsRes.status === "fulfilled"
        ? incidentsRes.value.counts.total > 0
          ? panelReady(
              `Incident runtime connected (${incidentsRes.value.counts.total} incidents).`,
              updatedAtIso
            )
          : panelEmpty("Incident runtime connected; no active incidents.", updatedAtIso)
        : panelError(
            `Incident runtime unavailable: ${errorMessage(incidentsRes.reason)}`,
            updatedAtIso
          );

    panelHealth.slo =
      sloRes.status === "fulfilled"
        ? sloRes.value.objectives.length > 0
          ? panelReady(
              `SLO runtime connected (${sloRes.value.objectives.length} objectives).`,
              updatedAtIso
            )
          : panelEmpty("SLO runtime connected; no objectives configured.", updatedAtIso)
        : panelError(`SLO runtime unavailable: ${errorMessage(sloRes.reason)}`, updatedAtIso);
  }

  let observability: DashboardOpsSnapshot["observability"] = null;
  let fleet: DashboardOpsSnapshot["fleet"] = null;
  let keyLifecycle: DashboardOpsSnapshot["keyLifecycle"] = null;

  if (canAdmin) {
    const [obsRes, fleetRes, keysRes] = await Promise.allSettled([
      getObservabilitySnapshot({
        countersLimit: 120,
        timingsLimit: 120,
        logsLimit: 20,
        tracesLimit: 20,
        alertsLimit: 20,
      }),
      getFleetSummaryForUser(input.userId),
      getKeyLifecycleSummaryForUser(input.userId),
    ]);
    observability = obsRes.status === "fulfilled" ? obsRes.value : null;
    fleet = fleetRes.status === "fulfilled" ? fleetRes.value : null;
    keyLifecycle = keysRes.status === "fulfilled" ? keysRes.value : null;

    panelHealth.observability =
      obsRes.status === "fulfilled"
        ? obsRes.value.counters.length +
            obsRes.value.timings.length +
            obsRes.value.recentLogs.length +
            obsRes.value.recentTraces.length +
            obsRes.value.recentAlerts.length >
          0
          ? panelReady("Observability runtime connected.", updatedAtIso)
          : panelEmpty("Observability runtime connected; no telemetry samples yet.", updatedAtIso)
        : panelError(
            `Observability runtime unavailable: ${errorMessage(obsRes.reason)}`,
            updatedAtIso
          );

    panelHealth.fleet =
      fleetRes.status === "fulfilled"
        ? fleetRes.value.totalHosts > 0
          ? panelReady(`Fleet runtime connected (${fleetRes.value.totalHosts} hosts).`, updatedAtIso)
          : panelEmpty("Fleet runtime connected; no hosts found for this account.", updatedAtIso)
        : panelError(`Fleet runtime unavailable: ${errorMessage(fleetRes.reason)}`, updatedAtIso);

    panelHealth.keyLifecycle =
      keysRes.status === "fulfilled"
        ? keysRes.value.totalKeys > 0
          ? panelReady(
              `Key lifecycle runtime connected (${keysRes.value.totalKeys} keys).`,
              updatedAtIso
            )
          : panelEmpty("Key lifecycle runtime connected; no keys found.", updatedAtIso)
        : panelError(
            `Key lifecycle runtime unavailable: ${errorMessage(keysRes.reason)}`,
            updatedAtIso
          );
  }

  let adaptive: DashboardAdaptiveSnapshot | null = null;
  let adaptiveError: string | null = null;
  try {
    adaptive = await getAdaptiveSnapshotForUser({
      userId: input.userId,
      remediation,
      breaches,
    });
  } catch (err: unknown) {
    adaptive = null;
    adaptiveError = errorMessage(err);
  }

  if (adaptiveError) {
    panelHealth.adaptive = panelError(`Adaptive runtime unavailable: ${adaptiveError}`, updatedAtIso);
  } else if (!adaptive) {
    panelHealth.adaptive = panelEmpty("Adaptive runtime returned no payload.", updatedAtIso);
  } else if (adaptive.correlations.length === 0 && adaptive.recommendations.length === 0) {
    panelHealth.adaptive = panelEmpty("Adaptive runtime connected; no patterns found.", updatedAtIso);
  } else {
    panelHealth.adaptive = panelReady("Adaptive runtime connected with live recommendations.", updatedAtIso);
  }

  return {
    generatedAtIso: updatedAtIso,
    access: {
      role: input.userRole,
      canOps,
      canAdmin,
    },
    panelHealth,
    workflows: canOps ? INCIDENT_WORKFLOWS : null,
    queue,
    incidents,
    slo,
    observability,
    fleet,
    keyLifecycle,
    breaches,
    shipping,
    remediation,
    adaptive,
  };
}
