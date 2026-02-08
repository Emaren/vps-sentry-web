import { prisma } from "@/lib/prisma";
import { classifyHeartbeat, readHeartbeatConfig } from "@/lib/host-heartbeat";
import { getObservabilitySnapshot, type ObservabilitySnapshot } from "@/lib/observability";

export type SloRoute = "none" | "webhook" | "email" | "both";
export type SloSeverity = "ok" | "warn" | "critical";
export type SloStatus = "ok" | "breach" | "insufficient_data";

export type PercentSlo = {
  kind: "percent";
  key: string;
  title: string;
  targetPct: number;
  currentPct: number | null;
  status: SloStatus;
  total: number;
  good: number;
  bad: number;
  errorBudgetRemainingPct: number | null;
  burnRateShort: number | null;
  burnRateLong: number | null;
};

export type DurationSlo = {
  kind: "duration";
  key: string;
  title: string;
  targetMinutes: number;
  currentMinutes: number | null;
  status: SloStatus;
  sampleCount: number;
};

export type SloObjective = PercentSlo | DurationSlo;

export type SloBurnAlert = {
  severity: SloSeverity;
  shouldAlert: boolean;
  route: SloRoute;
  title: string;
  reason: string;
  affectedObjectives: string[];
  maxBurnRate: number;
};

export type SloSnapshot = {
  generatedAtIso: string;
  windowHours: number;
  burnWindows: {
    shortMinutes: number;
    longMinutes: number;
  };
  goals: {
    availabilityTargetPct: number;
    notifyDeliveryTargetPct: number;
    ingestFreshTargetPct: number;
    mttdTargetMinutes: number;
    mttrTargetMinutes: number;
  };
  measurement: {
    mttd: string;
    mttr: string;
  };
  objectives: SloObjective[];
  openBreachesOlderThanMttdTarget: number;
  burn: SloBurnAlert;
};

type SloConfig = {
  windowHours: number;
  burnShortMinutes: number;
  burnLongMinutes: number;
  burnWarn: number;
  burnCritical: number;
  availabilityTargetPct: number;
  notifyDeliveryTargetPct: number;
  ingestFreshTargetPct: number;
  mttdTargetMinutes: number;
  mttrTargetMinutes: number;
  routing: {
    warn: SloRoute;
    critical: SloRoute;
  };
};

type PercentObjectiveInput = {
  key: string;
  title: string;
  targetPct: number;
  good: number;
  total: number;
  goodShort: number;
  totalShort: number;
  goodLong: number;
  totalLong: number;
};

type BurnEvalInput = {
  objectives: PercentSlo[];
  mttd: DurationSlo;
  mttr: DurationSlo;
  openBreachesOlderThanMttdTarget: number;
  config: SloConfig;
};

function parseNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseRoute(raw: string | undefined, fallback: SloRoute): SloRoute {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "none" || t === "webhook" || t === "email" || t === "both") return t;
  return fallback;
}

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  const total = values.reduce((sum, v) => sum + v, 0);
  return total / values.length;
}

function minutesDiff(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 60_000);
}

function parseNumericUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function traceStatusCode(trace: ObservabilitySnapshot["recentTraces"][number]): number | null {
  if (!trace.attributes) return null;
  const statusRaw = trace.attributes.status;
  return parseNumericUnknown(statusRaw);
}

function tracesInWindow(
  traces: ObservabilitySnapshot["recentTraces"],
  route: string,
  sinceMs: number
): ObservabilitySnapshot["recentTraces"] {
  return traces.filter((t) => {
    if (t.route !== route) return false;
    const ts = Date.parse(t.ts);
    if (!Number.isFinite(ts)) return false;
    return ts >= sinceMs;
  });
}

function statusFromPercent(currentPct: number | null, targetPct: number, total: number): SloStatus {
  if (total <= 0 || currentPct === null) return "insufficient_data";
  return currentPct >= targetPct ? "ok" : "breach";
}

function buildPercentObjective(input: PercentObjectiveInput): PercentSlo {
  const bad = Math.max(0, input.total - input.good);
  const currentPct = input.total > 0 ? (input.good / input.total) * 100 : null;
  const status = statusFromPercent(currentPct, input.targetPct, input.total);
  const allowedError = 1 - input.targetPct / 100;

  const errorFraction = input.total > 0 ? bad / input.total : null;
  const errorFractionShort =
    input.totalShort > 0 ? (input.totalShort - input.goodShort) / input.totalShort : null;
  const errorFractionLong =
    input.totalLong > 0 ? (input.totalLong - input.goodLong) / input.totalLong : null;

  const burnRateShort =
    errorFractionShort === null || allowedError <= 0 ? null : errorFractionShort / allowedError;
  const burnRateLong =
    errorFractionLong === null || allowedError <= 0 ? null : errorFractionLong / allowedError;
  const errorBudgetRemainingPct =
    errorFraction === null || allowedError <= 0
      ? null
      : ((allowedError - errorFraction) / allowedError) * 100;

  return {
    kind: "percent",
    key: input.key,
    title: input.title,
    targetPct: input.targetPct,
    currentPct: currentPct === null ? null : Number(currentPct.toFixed(4)),
    status,
    total: input.total,
    good: input.good,
    bad,
    errorBudgetRemainingPct:
      errorBudgetRemainingPct === null ? null : Number(errorBudgetRemainingPct.toFixed(4)),
    burnRateShort: burnRateShort === null ? null : Number(burnRateShort.toFixed(4)),
    burnRateLong: burnRateLong === null ? null : Number(burnRateLong.toFixed(4)),
  };
}

function buildDurationObjective(input: {
  key: string;
  title: string;
  targetMinutes: number;
  samples: number[];
}): DurationSlo {
  const current = mean(input.samples);
  const status: SloStatus =
    current === null ? "insufficient_data" : current <= input.targetMinutes ? "ok" : "breach";
  return {
    kind: "duration",
    key: input.key,
    title: input.title,
    targetMinutes: input.targetMinutes,
    currentMinutes: current === null ? null : Number(current.toFixed(4)),
    status,
    sampleCount: input.samples.length,
  };
}

function severityScore(severity: SloSeverity): number {
  if (severity === "critical") return 2;
  if (severity === "warn") return 1;
  return 0;
}

function resolveRoute(severity: SloSeverity, config: SloConfig): SloRoute {
  if (severity === "critical") return config.routing.critical;
  if (severity === "warn") return config.routing.warn;
  return "none";
}

function evaluateBurnRate(input: BurnEvalInput): SloBurnAlert {
  const reasons: string[] = [];
  const affected = new Set<string>();

  let severity: SloSeverity = "ok";
  let maxBurnRate = 0;

  for (const objective of input.objectives) {
    const short = objective.burnRateShort ?? 0;
    const long = objective.burnRateLong ?? 0;
    maxBurnRate = Math.max(maxBurnRate, short, long);

    if (objective.status === "breach") {
      reasons.push(`${objective.key}:target_miss`);
      affected.add(objective.key);
      severity = "warn";
    }

    if (short >= input.config.burnCritical && long >= input.config.burnWarn) {
      reasons.push(`${objective.key}:critical_burn short=${short.toFixed(2)} long=${long.toFixed(2)}`);
      affected.add(objective.key);
      severity = "critical";
      continue;
    }

    if (short >= input.config.burnWarn || long >= input.config.burnWarn) {
      reasons.push(`${objective.key}:warn_burn short=${short.toFixed(2)} long=${long.toFixed(2)}`);
      affected.add(objective.key);
      if (severityScore(severity) < severityScore("warn")) severity = "warn";
    }
  }

  if (input.mttd.status === "breach" && input.mttd.currentMinutes !== null) {
    reasons.push(`mttd:breach current=${input.mttd.currentMinutes.toFixed(2)}m`);
    affected.add("mttd");
    const severe = input.mttd.currentMinutes >= input.mttd.targetMinutes * 2;
    if (severe && severityScore(severity) < severityScore("critical")) severity = "critical";
    else if (severityScore(severity) < severityScore("warn")) severity = "warn";
  }

  if (input.mttr.status === "breach" && input.mttr.currentMinutes !== null) {
    reasons.push(`mttr:breach current=${input.mttr.currentMinutes.toFixed(2)}m`);
    affected.add("mttr");
    const severe = input.mttr.currentMinutes >= input.mttr.targetMinutes * 2;
    if (severe && severityScore(severity) < severityScore("critical")) severity = "critical";
    else if (severityScore(severity) < severityScore("warn")) severity = "warn";
  }

  if (input.openBreachesOlderThanMttdTarget > 0) {
    reasons.push(`open_breaches_over_mttd=${input.openBreachesOlderThanMttdTarget}`);
    affected.add("open_breaches");
    if (severityScore(severity) < severityScore("warn")) severity = "warn";
  }

  const route = resolveRoute(severity, input.config);
  const shouldAlert = severity === "warn" || severity === "critical";
  const title =
    severity === "critical"
      ? "SLO burn-rate critical"
      : severity === "warn"
      ? "SLO burn-rate warning"
      : "SLO healthy";
  const reason =
    reasons.length > 0
      ? reasons.join("; ")
      : "All SLO objectives are within target and burn-rate thresholds.";

  return {
    severity,
    shouldAlert,
    route,
    title,
    reason,
    affectedObjectives: Array.from(affected),
    maxBurnRate: Number(maxBurnRate.toFixed(4)),
  };
}

function readSloConfig(env: Record<string, string | undefined> = process.env): SloConfig {
  return {
    windowHours: parseNumber(env.VPS_SLO_WINDOW_HOURS, 24, 1, 24 * 30),
    burnShortMinutes: parseNumber(env.VPS_SLO_BURN_SHORT_WINDOW_MINUTES, 5, 1, 120),
    burnLongMinutes: parseNumber(env.VPS_SLO_BURN_LONG_WINDOW_MINUTES, 60, 5, 24 * 60),
    burnWarn: parseNumber(env.VPS_SLO_BURN_WARN, 6, 1, 200),
    burnCritical: parseNumber(env.VPS_SLO_BURN_CRITICAL, 14, 1, 500),
    availabilityTargetPct: parseNumber(env.VPS_SLO_AVAILABILITY_TARGET_PCT, 99.9, 90, 100),
    notifyDeliveryTargetPct: parseNumber(env.VPS_SLO_NOTIFY_DELIVERY_TARGET_PCT, 99, 80, 100),
    ingestFreshTargetPct: parseNumber(env.VPS_SLO_INGEST_FRESH_TARGET_PCT, 99, 70, 100),
    mttdTargetMinutes: parseNumber(env.VPS_SLO_MTTD_TARGET_MINUTES, 5, 1, 24 * 60),
    mttrTargetMinutes: parseNumber(env.VPS_SLO_MTTR_TARGET_MINUTES, 60, 1, 24 * 60 * 7),
    routing: {
      warn: parseRoute(env.VPS_SLO_ROUTE_WARN, "both"),
      critical: parseRoute(env.VPS_SLO_ROUTE_CRITICAL, "both"),
    },
  };
}

export function formatSloSummary(snapshot: SloSnapshot): string {
  const objectiveParts = snapshot.objectives.map((objective) => {
    if (objective.kind === "percent") {
      return `${objective.key}:${objective.currentPct?.toFixed(2) ?? "n/a"}% target=${objective.targetPct}% status=${objective.status}`;
    }
    return `${objective.key}:${objective.currentMinutes?.toFixed(2) ?? "n/a"}m target=${objective.targetMinutes}m status=${objective.status}`;
  });
  return [
    `severity=${snapshot.burn.severity}`,
    `route=${snapshot.burn.route}`,
    `maxBurnRate=${snapshot.burn.maxBurnRate}`,
    ...objectiveParts,
  ].join(" | ");
}

export async function buildSloSnapshot(input?: {
  now?: Date;
  windowHours?: number;
  observability?: ObservabilitySnapshot;
}): Promise<SloSnapshot> {
  const now = input?.now ?? new Date();
  const config = readSloConfig();
  const windowHours = input?.windowHours ?? config.windowHours;
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const sinceShort = new Date(now.getTime() - config.burnShortMinutes * 60 * 1000);
  const sinceLong = new Date(now.getTime() - config.burnLongMinutes * 60 * 1000);

  const observability =
    input?.observability ??
    getObservabilitySnapshot({
      tracesLimit: 1000,
      logsLimit: 200,
      alertsLimit: 300,
      countersLimit: 600,
      timingsLimit: 600,
    });

  const traces = observability.recentTraces;
  const availabilityAll = tracesInWindow(traces, "/api/status", since.getTime());
  const availabilityShort = tracesInWindow(traces, "/api/status", sinceShort.getTime());
  const availabilityLong = tracesInWindow(traces, "/api/status", sinceLong.getTime());

  const availabilityCounts = (rows: ObservabilitySnapshot["recentTraces"]) => {
    let total = 0;
    let good = 0;
    for (const row of rows) {
      const status = traceStatusCode(row);
      if (status === null) continue;
      total += 1;
      if (status >= 200 && status < 500) good += 1;
    }
    return { total, good };
  };

  const availabilityMain = availabilityCounts(availabilityAll);
  const availabilityShortCounts = availabilityCounts(availabilityShort);
  const availabilityLongCounts = availabilityCounts(availabilityLong);

  const [
    notifyTotal,
    notifyGood,
    notifyTotalShort,
    notifyGoodShort,
    notifyTotalLong,
    notifyGoodLong,
    hostRows,
    breachesOpened,
    breachesFixed,
    openBreachesOverMttdTarget,
  ] = await Promise.all([
    prisma.notificationEvent.count({
      where: {
        createdAt: { gte: since },
        deliveredOk: { not: null },
      },
    }),
    prisma.notificationEvent.count({
      where: {
        createdAt: { gte: since },
        deliveredOk: true,
      },
    }),
    prisma.notificationEvent.count({
      where: {
        createdAt: { gte: sinceShort },
        deliveredOk: { not: null },
      },
    }),
    prisma.notificationEvent.count({
      where: {
        createdAt: { gte: sinceShort },
        deliveredOk: true,
      },
    }),
    prisma.notificationEvent.count({
      where: {
        createdAt: { gte: sinceLong },
        deliveredOk: { not: null },
      },
    }),
    prisma.notificationEvent.count({
      where: {
        createdAt: { gte: sinceLong },
        deliveredOk: true,
      },
    }),
    prisma.host.findMany({
      select: {
        id: true,
        lastSeenAt: true,
      },
    }),
    prisma.breach.findMany({
      where: {
        openedTs: { gte: since },
      },
      select: {
        id: true,
        hostId: true,
        openedTs: true,
      },
      orderBy: {
        openedTs: "asc",
      },
    }),
    prisma.breach.findMany({
      where: {
        fixedTs: { gte: since },
      },
      select: {
        id: true,
        openedTs: true,
        fixedTs: true,
      },
      orderBy: {
        fixedTs: "asc",
      },
    }),
    prisma.breach.count({
      where: {
        state: "open",
        openedTs: {
          lte: new Date(now.getTime() - config.mttdTargetMinutes * 60 * 1000),
        },
      },
    }),
  ]);

  const heartbeatConfig = readHeartbeatConfig();
  let hostsGood = 0;
  for (const host of hostRows) {
    const heartbeat = classifyHeartbeat(host.lastSeenAt, now, heartbeatConfig);
    if (heartbeat.state !== "missing") hostsGood += 1;
  }

  const hostTotal = hostRows.length;
  const hostShortTotal = hostTotal;
  const hostLongTotal = hostTotal;
  const hostGoodShort = hostsGood;
  const hostGoodLong = hostsGood;

  const hostIds = Array.from(new Set(breachesOpened.map((b) => b.hostId).filter(Boolean)));
  const notifyByHostRows =
    hostIds.length > 0
      ? await prisma.notificationEvent.findMany({
          where: {
            hostId: { in: hostIds },
            createdAt: { gte: since },
            deliveredOk: true,
            eventType: { startsWith: "notify." },
          },
          select: {
            hostId: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        })
      : [];

  const notifyByHost = new Map<string, Date[]>();
  for (const row of notifyByHostRows) {
    if (!row.hostId) continue;
    const arr = notifyByHost.get(row.hostId) ?? [];
    arr.push(row.createdAt);
    notifyByHost.set(row.hostId, arr);
  }

  const mttdSamples: number[] = [];
  for (const breach of breachesOpened) {
    const hostEvents = notifyByHost.get(breach.hostId) ?? [];
    const firstDetection = hostEvents.find((eventTs) => eventTs.getTime() >= breach.openedTs.getTime());
    if (!firstDetection) continue;
    mttdSamples.push(minutesDiff(breach.openedTs, firstDetection));
  }

  const mttrSamples: number[] = [];
  for (const breach of breachesFixed) {
    if (!breach.fixedTs) continue;
    mttrSamples.push(minutesDiff(breach.openedTs, breach.fixedTs));
  }

  const availabilityObjective = buildPercentObjective({
    key: "availability",
    title: "Status API availability",
    targetPct: config.availabilityTargetPct,
    good: availabilityMain.good,
    total: availabilityMain.total,
    goodShort: availabilityShortCounts.good,
    totalShort: availabilityShortCounts.total,
    goodLong: availabilityLongCounts.good,
    totalLong: availabilityLongCounts.total,
  });

  const notifyObjective = buildPercentObjective({
    key: "notify_delivery",
    title: "Notification delivery success",
    targetPct: config.notifyDeliveryTargetPct,
    good: notifyGood,
    total: notifyTotal,
    goodShort: notifyGoodShort,
    totalShort: notifyTotalShort,
    goodLong: notifyGoodLong,
    totalLong: notifyTotalLong,
  });

  const ingestObjective = buildPercentObjective({
    key: "ingest_fresh_hosts",
    title: "Hosts with non-missing heartbeat",
    targetPct: config.ingestFreshTargetPct,
    good: hostsGood,
    total: hostTotal,
    goodShort: hostGoodShort,
    totalShort: hostShortTotal,
    goodLong: hostGoodLong,
    totalLong: hostLongTotal,
  });

  const mttdObjective = buildDurationObjective({
    key: "mttd",
    title: "Mean time to detect",
    targetMinutes: config.mttdTargetMinutes,
    samples: mttdSamples,
  });

  const mttrObjective = buildDurationObjective({
    key: "mttr",
    title: "Mean time to resolve",
    targetMinutes: config.mttrTargetMinutes,
    samples: mttrSamples,
  });

  const burn = evaluateBurnRate({
    objectives: [availabilityObjective, notifyObjective, ingestObjective],
    mttd: mttdObjective,
    mttr: mttrObjective,
    openBreachesOlderThanMttdTarget: openBreachesOverMttdTarget,
    config,
  });

  return {
    generatedAtIso: nowIso(now),
    windowHours,
    burnWindows: {
      shortMinutes: config.burnShortMinutes,
      longMinutes: config.burnLongMinutes,
    },
    goals: {
      availabilityTargetPct: config.availabilityTargetPct,
      notifyDeliveryTargetPct: config.notifyDeliveryTargetPct,
      ingestFreshTargetPct: config.ingestFreshTargetPct,
      mttdTargetMinutes: config.mttdTargetMinutes,
      mttrTargetMinutes: config.mttrTargetMinutes,
    },
    measurement: {
      mttd: "average minutes from breach openedTs to first delivered notify event on same host.",
      mttr: "average minutes from breach openedTs to breach fixedTs.",
    },
    objectives: [
      availabilityObjective,
      notifyObjective,
      ingestObjective,
      mttdObjective,
      mttrObjective,
    ],
    openBreachesOlderThanMttdTarget: openBreachesOverMttdTarget,
    burn,
  };
}
