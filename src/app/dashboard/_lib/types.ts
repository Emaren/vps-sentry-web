import type { Status } from "@/lib/status";
import type { AppRole } from "@/lib/rbac-policy";
import type { IncidentWorkflow } from "@/lib/ops/workflows";
import type { RemediationQueueSnapshot } from "@/lib/remediate/queue";
import type { IncidentRunListSnapshot } from "@/lib/ops/incident-engine";
import type { SloSnapshot } from "@/lib/slo";
import type { ObservabilitySnapshot } from "@/lib/observability";

export type DashboardEnv = {
  ok: boolean;
  ts?: string;
  diff?: unknown;
  raw: unknown;
  last: Status;
};

export type DashboardBilling = {
  plan?: string | null;
  hostLimit?: number | null;
  stripeCustomerId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionId?: string | null;
  currentPeriodEnd?: string | Date | null;
} | null;

export type DashboardFleetSummary = {
  totalHosts: number;
  enabledHosts: number;
  pausedHosts: number;
  groupedHosts: number;
  topGroups: Array<{ key: string; count: number }>;
  topTags: Array<{ key: string; count: number }>;
  topScopes: Array<{ key: string; count: number }>;
};

export type DashboardKeyLifecycleSummary = {
  totalKeys: number;
  activeKeys: number;
  revokedKeys: number;
  expiredKeys: number;
  expiringSoonKeys: number;
  staleKeys: number;
  maxVersion: number;
};

export type DashboardBreachItem = {
  id: string;
  hostId: string;
  hostName: string;
  hostSlug: string | null;
  code: string | null;
  title: string;
  detail: string | null;
  severity: "info" | "warn" | "critical";
  state: "open" | "fixed" | "ignored";
  openedTs: string;
  fixedTs: string | null;
  updatedAt: string;
};

export type DashboardBreachesSnapshot = {
  counts: {
    total: number;
    open: number;
    fixed: number;
    ignored: number;
  };
  recent: DashboardBreachItem[];
};

export type DashboardShippingEvent = {
  id: string;
  hostId: string | null;
  hostName: string | null;
  eventType: string;
  title: string;
  detail: string | null;
  deliveredOk: boolean | null;
  deliveredTs: string | null;
  error: string | null;
  createdAt: string;
  endpointKind: "EMAIL" | "WEBHOOK" | null;
  endpointTarget: string | null;
};

export type DashboardShippingSnapshot = {
  counts: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    last24h: number;
    failed24h: number;
  };
  lastDeliveredTs: string | null;
  lastFailedTs: string | null;
  lastError: string | null;
  recent: DashboardShippingEvent[];
};

export type DashboardRemediationRunItem = {
  runId: string;
  hostId: string;
  hostName: string;
  actionKey: string;
  actionTitle: string;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedByEmail: string | null;
  attempts: number;
  maxAttempts: number;
  dlq: boolean;
  approvalPending: boolean;
  retryScheduled: boolean;
  canaryPassed: boolean | null;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean | null;
  autoQueued: boolean;
  autoTier: string | null;
  error: string | null;
};

export type DashboardRemediationSnapshot = {
  counts: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    canceled: number;
    dlq: number;
    approvalPending: number;
    retryScheduled: number;
    autoQueued: number;
  };
  recentRuns: DashboardRemediationRunItem[];
};

export type DashboardAdaptiveCorrelation = {
  key: string;
  title: string;
  severity: "info" | "warn" | "critical";
  hostCount: number;
  signalCount: number;
  hosts: string[];
  detail: string;
};

export type DashboardAdaptiveRecommendation = {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  why: string;
  suggestedAction: string;
  evidence: string[];
};

export type DashboardAdaptiveSnapshot = {
  generatedAtIso: string;
  correlations: DashboardAdaptiveCorrelation[];
  recommendations: DashboardAdaptiveRecommendation[];
};

export type DashboardOpsSnapshot = {
  generatedAtIso: string;
  access: {
    role: AppRole;
    canOps: boolean;
    canAdmin: boolean;
  };
  workflows: IncidentWorkflow[] | null;
  queue: RemediationQueueSnapshot | null;
  incidents: IncidentRunListSnapshot | null;
  slo: SloSnapshot | null;
  observability: ObservabilitySnapshot | null;
  fleet: DashboardFleetSummary | null;
  keyLifecycle: DashboardKeyLifecycleSummary | null;
  breaches: DashboardBreachesSnapshot | null;
  shipping: DashboardShippingSnapshot | null;
  remediation: DashboardRemediationSnapshot | null;
  adaptive: DashboardAdaptiveSnapshot | null;
};
