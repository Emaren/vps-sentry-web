import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getIncidentWorkflowById } from "@/lib/ops/workflows";
import {
  executeWorkflowApiStep,
  resolveWorkflowStepInput,
  type WorkflowExecutionObservability,
} from "@/lib/ops/workflow-executor";

export type IncidentSeverityValue = "critical" | "high" | "medium";
export type IncidentStateValue = "open" | "acknowledged" | "resolved" | "closed";
export type PostmortemStatusValue = "not_started" | "draft" | "published" | "waived";
export type IncidentStateFilter = IncidentStateValue | "active";

export type IncidentPostmortemActionItemStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "done"
  | "waived";

export type IncidentPostmortemActionItem = {
  id: string;
  title: string;
  owner: string | null;
  dueTs: string | null;
  status: IncidentPostmortemActionItemStatus;
  note: string | null;
};

export type IncidentUserRef = {
  id: string;
  email: string | null;
  name: string | null;
};

export type IncidentHostRef = {
  id: string;
  name: string;
  slug: string | null;
};

export type IncidentTimelineEvent = {
  id: string;
  incidentId: string;
  type: string;
  stepId: string | null;
  message: string;
  eventTs: string;
  actor: IncidentUserRef | null;
  meta: Record<string, unknown> | null;
};

export type IncidentRunSummary = {
  id: string;
  workflowId: string;
  workflowTitle: string | null;
  title: string;
  summary: string | null;
  severity: IncidentSeverityValue;
  state: IncidentStateValue;
  triggerSignal: string | null;
  host: IncidentHostRef | null;
  createdBy: IncidentUserRef | null;
  assignee: IncidentUserRef | null;
  assigneeEmail: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: IncidentUserRef | null;
  ackDueAt: string | null;
  escalatedAt: string | null;
  escalationCount: number;
  nextEscalationAt: string | null;
  resolvedAt: string | null;
  resolvedBy: IncidentUserRef | null;
  closedAt: string | null;
  closedBy: IncidentUserRef | null;
  postmortemStatus: PostmortemStatusValue;
  postmortemPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ackOverdue: boolean;
};

export type IncidentRunDetail = IncidentRunSummary & {
  postmortemSummary: string | null;
  postmortemImpact: string | null;
  postmortemRootCause: string | null;
  postmortemActionItems: IncidentPostmortemActionItem[];
  timeline: IncidentTimelineEvent[];
};

export type IncidentRunListSnapshot = {
  generatedAt: string;
  limit: number;
  filters: {
    state: IncidentStateFilter | null;
    hostId: string | null;
    assigneeUserId: string | null;
    includeClosed: boolean;
  };
  counts: {
    total: number;
    open: number;
    acknowledged: number;
    resolved: number;
    closed: number;
    ackOverdue: number;
    escalationDue: number;
  };
  incidents: IncidentRunSummary[];
};

export type IncidentTimerPolicy = {
  ackMinutes: number;
  escalationMinutes: number;
};

export type CreateIncidentRunInput = {
  workflowId: string;
  title?: string | null;
  summary?: string | null;
  severity?: IncidentSeverityValue | null;
  triggerSignal?: string | null;
  hostId?: string | null;
  createdByUserId?: string | null;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  ackDueMinutes?: number | null;
  escalationEveryMinutes?: number | null;
  initialNote?: string | null;
  now?: Date;
};

export type AssignIncidentInput = {
  incidentId: string;
  actorUserId: string;
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
  note?: string | null;
};

export type IncidentActorInput = {
  incidentId: string;
  actorUserId: string;
  note?: string | null;
  now?: Date;
};

export type UpdateIncidentPostmortemInput = {
  incidentId: string;
  actorUserId: string;
  status?: PostmortemStatusValue | null;
  summary?: string | null;
  impact?: string | null;
  rootCause?: string | null;
  actionItems?: unknown;
};

export type ExecuteIncidentWorkflowStepInput = {
  incidentId: string;
  stepId: string;
  actorUserId: string;
  actorEmail: string;
  payload?: Record<string, unknown>;
  observability?: WorkflowExecutionObservability;
};

export type IncidentEscalationSweepInput = {
  actorUserId?: string | null;
  limit?: number;
  now?: Date;
};

export type IncidentEscalationSweepResult = {
  ok: true;
  evaluated: number;
  escalated: number;
  incidentIds: string[];
  nextDueAt: string | null;
};

export class IncidentEngineError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "IncidentEngineError";
  }
}

const INCIDENT_SEVERITIES: IncidentSeverityValue[] = ["critical", "high", "medium"];
const INCIDENT_STATES: IncidentStateValue[] = ["open", "acknowledged", "resolved", "closed"];
const POSTMORTEM_STATUSES: PostmortemStatusValue[] = [
  "not_started",
  "draft",
  "published",
  "waived",
];
const ACTION_ITEM_STATUSES: IncidentPostmortemActionItemStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "waived",
];

const INCIDENT_RUN_SELECT = {
  id: true,
  workflowId: true,
  workflowTitle: true,
  title: true,
  summary: true,
  severity: true,
  state: true,
  triggerSignal: true,
  hostId: true,
  createdByUserId: true,
  assigneeUserId: true,
  assigneeEmail: true,
  acknowledgedAt: true,
  acknowledgedByUserId: true,
  ackDueAt: true,
  escalatedAt: true,
  escalationCount: true,
  nextEscalationAt: true,
  resolvedAt: true,
  resolvedByUserId: true,
  closedAt: true,
  closedByUserId: true,
  postmortemStatus: true,
  postmortemSummary: true,
  postmortemImpact: true,
  postmortemRootCause: true,
  postmortemActionItemsJson: true,
  postmortemPublishedAt: true,
  createdAt: true,
  updatedAt: true,
  host: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
  createdByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  assigneeUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  acknowledgedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  resolvedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  closedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} as const;

const INCIDENT_EVENT_SELECT = {
  id: true,
  incidentId: true,
  type: true,
  stepId: true,
  message: true,
  eventTs: true,
  actorUserId: true,
  metaJson: true,
  actorUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} as const;

type IncidentRunRow = Prisma.IncidentWorkflowRunGetPayload<{
  select: typeof INCIDENT_RUN_SELECT;
}>;

type IncidentEventRow = Prisma.IncidentWorkflowEventGetPayload<{
  select: typeof INCIDENT_EVENT_SELECT;
}>;

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parsePositiveInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return clampInt(n, min, max);
}

function trimToNull(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function toIso(v: Date | null | undefined): string | null {
  if (!v) return null;
  return v.toISOString();
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  return parsePositiveInt(raw, fallback, min, max);
}

function normalizeStateInternal(v: unknown): IncidentStateValue | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (INCIDENT_STATES.includes(t as IncidentStateValue)) {
    return t as IncidentStateValue;
  }
  return null;
}

function safeParseObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeStringify(meta: unknown): string | null {
  if (meta === undefined) return null;
  try {
    return JSON.stringify(meta);
  } catch {
    return JSON.stringify({ value: String(meta) });
  }
}

function mapUserRef(
  user:
    | {
        id: string;
        email: string | null;
        name: string | null;
      }
    | null
    | undefined
): IncidentUserRef | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
  };
}

function mapIncidentEvent(row: IncidentEventRow): IncidentTimelineEvent {
  return {
    id: row.id,
    incidentId: row.incidentId,
    type: row.type,
    stepId: row.stepId ?? null,
    message: row.message,
    eventTs: row.eventTs.toISOString(),
    actor: mapUserRef(row.actorUser),
    meta: safeParseObject(row.metaJson),
  };
}

function mapIncidentSummary(row: IncidentRunRow, now: Date): IncidentRunSummary {
  const ackDueAtIso = toIso(row.ackDueAt);
  const ackDueAt = row.ackDueAt ? row.ackDueAt.getTime() : null;
  const ackOverdue = row.state === "open" && ackDueAt !== null && ackDueAt <= now.getTime();

  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowTitle: row.workflowTitle ?? null,
    title: row.title,
    summary: row.summary ?? null,
    severity: normalizeIncidentSeverity(row.severity, "medium") ?? "medium",
    state: normalizeStateInternal(row.state) ?? "open",
    triggerSignal: row.triggerSignal ?? null,
    host: row.host
      ? {
          id: row.host.id,
          name: row.host.name,
          slug: row.host.slug ?? null,
        }
      : null,
    createdBy: mapUserRef(row.createdByUser),
    assignee: mapUserRef(row.assigneeUser),
    assigneeEmail: row.assigneeEmail ?? null,
    acknowledgedAt: toIso(row.acknowledgedAt),
    acknowledgedBy: mapUserRef(row.acknowledgedByUser),
    ackDueAt: ackDueAtIso,
    escalatedAt: toIso(row.escalatedAt),
    escalationCount: row.escalationCount,
    nextEscalationAt: toIso(row.nextEscalationAt),
    resolvedAt: toIso(row.resolvedAt),
    resolvedBy: mapUserRef(row.resolvedByUser),
    closedAt: toIso(row.closedAt),
    closedBy: mapUserRef(row.closedByUser),
    postmortemStatus:
      normalizePostmortemStatus(row.postmortemStatus, "not_started") ?? "not_started",
    postmortemPublishedAt: toIso(row.postmortemPublishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ackOverdue,
  };
}

function mapIncidentDetail(
  row: IncidentRunRow,
  events: IncidentEventRow[],
  now: Date
): IncidentRunDetail {
  const base = mapIncidentSummary(row, now);
  return {
    ...base,
    postmortemSummary: row.postmortemSummary ?? null,
    postmortemImpact: row.postmortemImpact ?? null,
    postmortemRootCause: row.postmortemRootCause ?? null,
    postmortemActionItems: parsePostmortemActionItems(row.postmortemActionItemsJson),
    timeline: events.map(mapIncidentEvent),
  };
}

function lineItemsToActionItems(v: string): IncidentPostmortemActionItem[] {
  return normalizePostmortemActionItems(
    v
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((title) => ({ title }))
  );
}

export function normalizeIncidentSeverity(
  v: unknown,
  fallback: IncidentSeverityValue | null = null
): IncidentSeverityValue | null {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (INCIDENT_SEVERITIES.includes(t as IncidentSeverityValue)) {
      return t as IncidentSeverityValue;
    }
  }
  return fallback;
}

export function normalizeIncidentState(
  v: unknown,
  fallback: IncidentStateValue | null = null
): IncidentStateValue | null {
  const normalized = normalizeStateInternal(v);
  return normalized ?? fallback;
}

export function normalizeIncidentStateFilter(
  v: unknown,
  fallback: IncidentStateFilter | null = null
): IncidentStateFilter | null {
  if (typeof v !== "string") return fallback;
  const t = v.trim().toLowerCase();
  if (t === "active") return "active";
  if (INCIDENT_STATES.includes(t as IncidentStateValue)) {
    return t as IncidentStateValue;
  }
  return fallback;
}

export function normalizePostmortemStatus(
  v: unknown,
  fallback: PostmortemStatusValue | null = null
): PostmortemStatusValue | null {
  if (typeof v !== "string") return fallback;
  const t = v.trim().toLowerCase();
  if (POSTMORTEM_STATUSES.includes(t as PostmortemStatusValue)) {
    return t as PostmortemStatusValue;
  }
  return fallback;
}

export function normalizePostmortemActionItems(
  input: unknown
): IncidentPostmortemActionItem[] {
  if (!Array.isArray(input)) return [];
  const out: IncidentPostmortemActionItem[] = [];

  for (const item of input.slice(0, 60)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const title = trimToNull(rec.title, 220);
    if (!title) continue;

    const id = trimToNull(rec.id, 80) ?? `ai_${Math.random().toString(36).slice(2, 11)}`;
    const owner = trimToNull(rec.owner, 160);
    const dueTs = trimToNull(rec.dueTs, 80);
    const note = trimToNull(rec.note, 500);
    const statusRaw = trimToNull(rec.status, 40) ?? "open";
    const status = ACTION_ITEM_STATUSES.includes(statusRaw as IncidentPostmortemActionItemStatus)
      ? (statusRaw as IncidentPostmortemActionItemStatus)
      : "open";

    out.push({
      id,
      title,
      owner,
      dueTs,
      status,
      note,
    });
  }

  return out;
}

export function parsePostmortemActionItems(
  raw: string | null | undefined
): IncidentPostmortemActionItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizePostmortemActionItems(parsed);
  } catch {
    return lineItemsToActionItems(raw);
  }
}

export function serializePostmortemActionItems(
  actionItems: IncidentPostmortemActionItem[]
): string | null {
  if (!actionItems.length) return null;
  return safeStringify(actionItems);
}

export function incidentTimerPolicyForSeverity(
  severity: IncidentSeverityValue
): IncidentTimerPolicy {
  const defaults: Record<IncidentSeverityValue, IncidentTimerPolicy> = {
    critical: { ackMinutes: 5, escalationMinutes: 10 },
    high: { ackMinutes: 15, escalationMinutes: 20 },
    medium: { ackMinutes: 30, escalationMinutes: 45 },
  };
  const base = defaults[severity];
  const upper = severity.toUpperCase();

  return {
    ackMinutes: envInt(`VPS_INCIDENT_ACK_MINUTES_${upper}`, base.ackMinutes, 1, 24 * 60),
    escalationMinutes: envInt(
      `VPS_INCIDENT_ESCALATE_EVERY_MINUTES_${upper}`,
      base.escalationMinutes,
      1,
      24 * 60
    ),
  };
}

export function computeIncidentTimers(input: {
  severity: IncidentSeverityValue;
  now?: Date;
  ackDueMinutes?: number | null;
  escalationEveryMinutes?: number | null;
}): { ackDueAt: Date; nextEscalationAt: Date } {
  const now = input.now ?? new Date();
  const policy = incidentTimerPolicyForSeverity(input.severity);
  const ackMinutes = parsePositiveInt(
    input.ackDueMinutes ?? policy.ackMinutes,
    policy.ackMinutes,
    1,
    24 * 60
  );
  const escalationMinutes = parsePositiveInt(
    input.escalationEveryMinutes ?? policy.escalationMinutes,
    policy.escalationMinutes,
    1,
    24 * 60
  );

  const ackDueAt = addMinutes(now, ackMinutes);
  const nextEscalationAt = addMinutes(ackDueAt, escalationMinutes);
  return { ackDueAt, nextEscalationAt };
}

export function canRunIncidentAction(
  state: IncidentStateValue,
  action:
    | "assign"
    | "acknowledge"
    | "resolve"
    | "close"
    | "reopen"
    | "note"
    | "postmortem"
    | "step"
): boolean {
  if (action === "assign" || action === "note" || action === "postmortem") {
    return state !== "closed";
  }
  if (action === "acknowledge") return state === "open" || state === "acknowledged";
  if (action === "resolve") return state === "open" || state === "acknowledged" || state === "resolved";
  if (action === "close") return state === "resolved" || state === "closed";
  if (action === "reopen") return state !== "open";
  if (action === "step") return state !== "closed";
  return false;
}

async function appendIncidentEventTx(
  tx: Prisma.TransactionClient,
  input: {
    incidentId: string;
    type: string;
    message: string;
    actorUserId?: string | null;
    stepId?: string | null;
    meta?: unknown;
  }
) {
  await tx.incidentWorkflowEvent.create({
    data: {
      incidentId: input.incidentId,
      type: input.type.slice(0, 120),
      stepId: trimToNull(input.stepId, 120),
      message: input.message.slice(0, 1200),
      actorUserId: trimToNull(input.actorUserId, 80),
      metaJson: safeStringify(input.meta),
    },
  });
}

async function resolveAssignee(input: {
  assigneeUserId?: string | null;
  assigneeEmail?: string | null;
}): Promise<{ assigneeUserId: string | null; assigneeEmail: string | null }> {
  const assigneeUserId = trimToNull(input.assigneeUserId, 80);
  const assigneeEmailRaw = trimToNull(input.assigneeEmail, 240)?.toLowerCase() ?? null;

  if (assigneeUserId) {
    const user = await prisma.user.findUnique({
      where: { id: assigneeUserId },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new IncidentEngineError(404, "Assignee user not found");
    }
    return {
      assigneeUserId: user.id,
      assigneeEmail: user.email ?? assigneeEmailRaw,
    };
  }

  if (assigneeEmailRaw) {
    const user = await prisma.user.findUnique({
      where: { email: assigneeEmailRaw },
      select: { id: true, email: true },
    });
    if (user) {
      return {
        assigneeUserId: user.id,
        assigneeEmail: user.email ?? assigneeEmailRaw,
      };
    }
    return {
      assigneeUserId: null,
      assigneeEmail: assigneeEmailRaw,
    };
  }

  return {
    assigneeUserId: null,
    assigneeEmail: null,
  };
}

function buildIncidentWhere(input: {
  state?: IncidentStateFilter | null;
  hostId?: string | null;
  assigneeUserId?: string | null;
  includeClosed?: boolean;
}): Prisma.IncidentWorkflowRunWhereInput {
  const where: Prisma.IncidentWorkflowRunWhereInput = {};
  const hostId = trimToNull(input.hostId, 80);
  const assigneeUserId = trimToNull(input.assigneeUserId, 80);
  const state = input.state ?? null;
  const includeClosed = Boolean(input.includeClosed);

  if (hostId) where.hostId = hostId;
  if (assigneeUserId) where.assigneeUserId = assigneeUserId;

  if (state === "active") {
    where.state = { in: ["open", "acknowledged", "resolved"] };
  } else if (state) {
    where.state = state;
  } else if (!includeClosed) {
    where.state = { in: ["open", "acknowledged", "resolved"] };
  }

  return where;
}

export async function listIncidentRuns(input?: {
  limit?: number;
  state?: IncidentStateFilter | null;
  hostId?: string | null;
  assigneeUserId?: string | null;
  includeClosed?: boolean;
}): Promise<IncidentRunListSnapshot> {
  const now = new Date();
  const limit = parsePositiveInt(input?.limit ?? 30, 30, 1, 200);
  const state = normalizeIncidentStateFilter(input?.state, null);
  const where = buildIncidentWhere({
    state,
    hostId: input?.hostId ?? null,
    assigneeUserId: input?.assigneeUserId ?? null,
    includeClosed: input?.includeClosed ?? false,
  });

  const [rows, total, groupedByState, ackOverdue, escalationDue] = await Promise.all([
    prisma.incidentWorkflowRun.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      select: INCIDENT_RUN_SELECT,
    }),
    prisma.incidentWorkflowRun.count({ where }),
    prisma.incidentWorkflowRun.groupBy({
      by: ["state"],
      where,
      _count: { _all: true },
    }),
    prisma.incidentWorkflowRun.count({
      where: {
        ...where,
        state: "open",
        ackDueAt: {
          not: null,
          lte: now,
        },
      },
    }),
    prisma.incidentWorkflowRun.count({
      where: {
        ...where,
        state: "open",
        OR: [
          {
            nextEscalationAt: {
              not: null,
              lte: now,
            },
          },
          {
            nextEscalationAt: null,
            ackDueAt: {
              not: null,
              lte: now,
            },
          },
        ],
      },
    }),
  ]);

  const counts = {
    total,
    open: 0,
    acknowledged: 0,
    resolved: 0,
    closed: 0,
    ackOverdue,
    escalationDue,
  };

  for (const group of groupedByState) {
    const normalized = normalizeStateInternal(group.state);
    if (!normalized) continue;
    counts[normalized] = group._count._all;
  }

  return {
    generatedAt: now.toISOString(),
    limit,
    filters: {
      state,
      hostId: trimToNull(input?.hostId, 80),
      assigneeUserId: trimToNull(input?.assigneeUserId, 80),
      includeClosed: Boolean(input?.includeClosed),
    },
    counts,
    incidents: rows.map((row) => mapIncidentSummary(row, now)),
  };
}

export async function getIncidentRunDetail(
  incidentId: string,
  input?: { timelineLimit?: number }
): Promise<IncidentRunDetail | null> {
  const id = trimToNull(incidentId, 80);
  if (!id) return null;
  const timelineLimit = parsePositiveInt(input?.timelineLimit ?? 120, 120, 1, 600);
  const now = new Date();

  const row = await prisma.incidentWorkflowRun.findUnique({
    where: { id },
    select: INCIDENT_RUN_SELECT,
  });
  if (!row) return null;

  const events = await prisma.incidentWorkflowEvent.findMany({
    where: { incidentId: id },
    orderBy: [{ eventTs: "desc" }],
    take: timelineLimit,
    select: INCIDENT_EVENT_SELECT,
  });

  return mapIncidentDetail(row, events, now);
}

export async function createIncidentRun(
  input: CreateIncidentRunInput
): Promise<IncidentRunDetail> {
  const workflowId = trimToNull(input.workflowId, 80);
  if (!workflowId) {
    throw new IncidentEngineError(400, "workflowId is required");
  }

  const workflow = getIncidentWorkflowById(workflowId);
  if (!workflow) {
    throw new IncidentEngineError(404, "Unknown workflowId");
  }

  const severity =
    normalizeIncidentSeverity(input.severity, workflow.severity) ?? workflow.severity;
  const now = input.now ?? new Date();
  const createdByUserId = trimToNull(input.createdByUserId, 80);
  const title = trimToNull(input.title, 180) ?? workflow.title;
  const summary = trimToNull(input.summary, 2000) ?? workflow.summary;
  const triggerSignal = trimToNull(input.triggerSignal, 120);
  const hostId = trimToNull(input.hostId, 80);
  const initialNote = trimToNull(input.initialNote, 1200);
  const assignee = await resolveAssignee({
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeEmail: input.assigneeEmail ?? null,
  });
  const timers = computeIncidentTimers({
    severity,
    now,
    ackDueMinutes: input.ackDueMinutes ?? null,
    escalationEveryMinutes: input.escalationEveryMinutes ?? null,
  });

  const createdId = await prisma.$transaction(async (tx) => {
    if (hostId) {
      const host = await tx.host.findUnique({
        where: { id: hostId },
        select: { id: true },
      });
      if (!host) {
        throw new IncidentEngineError(404, "Host not found");
      }
    }

    const created = await tx.incidentWorkflowRun.create({
      data: {
        workflowId: workflow.id,
        workflowTitle: workflow.title,
        title,
        summary,
        severity,
        state: "open",
        triggerSignal,
        hostId,
        createdByUserId,
        assigneeUserId: assignee.assigneeUserId,
        assigneeEmail: assignee.assigneeEmail,
        ackDueAt: timers.ackDueAt,
        nextEscalationAt: timers.nextEscalationAt,
      },
      select: { id: true },
    });

    await appendIncidentEventTx(tx, {
      incidentId: created.id,
      type: "incident.created",
      message: `Incident created from workflow "${workflow.title}"`,
      actorUserId: createdByUserId,
      meta: {
        workflowId: workflow.id,
        severity,
        triggerSignal,
        hostId,
        timers: {
          ackDueAt: timers.ackDueAt.toISOString(),
          nextEscalationAt: timers.nextEscalationAt.toISOString(),
        },
      },
    });

    if (assignee.assigneeUserId || assignee.assigneeEmail) {
      await appendIncidentEventTx(tx, {
        incidentId: created.id,
        type: "incident.assigned",
        message: `Assigned to ${assignee.assigneeEmail ?? assignee.assigneeUserId}`,
        actorUserId: createdByUserId,
        meta: {
          assigneeUserId: assignee.assigneeUserId,
          assigneeEmail: assignee.assigneeEmail,
        },
      });
    }

    if (initialNote) {
      await appendIncidentEventTx(tx, {
        incidentId: created.id,
        type: "incident.note",
        message: initialNote,
        actorUserId: createdByUserId,
      });
    }

    return created.id;
  });

  const detail = await getIncidentRunDetail(createdId, { timelineLimit: 120 });
  if (!detail) {
    throw new IncidentEngineError(500, "Incident created but detail lookup failed");
  }
  return detail;
}

export async function assignIncidentRun(
  input: AssignIncidentInput
): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  if (!incidentId || !actorUserId) {
    throw new IncidentEngineError(400, "incidentId and actorUserId are required");
  }

  const assignee = await resolveAssignee({
    assigneeUserId: input.assigneeUserId ?? null,
    assigneeEmail: input.assigneeEmail ?? null,
  });
  if (!assignee.assigneeUserId && !assignee.assigneeEmail) {
    throw new IncidentEngineError(400, "assigneeUserId or assigneeEmail is required");
  }

  const note = trimToNull(input.note, 500);

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "assign")) {
      throw new IncidentEngineError(409, `Cannot assign while incident is ${state}`);
    }

    await tx.incidentWorkflowRun.update({
      where: { id: incidentId },
      data: {
        assigneeUserId: assignee.assigneeUserId,
        assigneeEmail: assignee.assigneeEmail,
      },
    });

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.assigned",
      message: note ?? `Assigned to ${assignee.assigneeEmail ?? assignee.assigneeUserId}`,
      actorUserId,
      meta: {
        assigneeUserId: assignee.assigneeUserId,
        assigneeEmail: assignee.assigneeEmail,
      },
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function acknowledgeIncidentRun(
  input: IncidentActorInput
): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  if (!incidentId || !actorUserId) {
    throw new IncidentEngineError(400, "incidentId and actorUserId are required");
  }
  const note = trimToNull(input.note, 500);
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "acknowledge")) {
      throw new IncidentEngineError(409, `Cannot acknowledge while incident is ${state}`);
    }

    await tx.incidentWorkflowRun.update({
      where: { id: incidentId },
      data: {
        state: "acknowledged",
        acknowledgedAt: now,
        acknowledgedByUserId: actorUserId,
        nextEscalationAt: null,
      },
    });

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.acknowledged",
      message: note ?? "Incident acknowledged",
      actorUserId,
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function resolveIncidentRun(
  input: IncidentActorInput
): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  if (!incidentId || !actorUserId) {
    throw new IncidentEngineError(400, "incidentId and actorUserId are required");
  }
  const note = trimToNull(input.note, 600);
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true, postmortemStatus: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "resolve")) {
      throw new IncidentEngineError(409, `Cannot resolve while incident is ${state}`);
    }

    const postmortemStatus =
      normalizePostmortemStatus(row.postmortemStatus, "not_started") ?? "not_started";

    await tx.incidentWorkflowRun.update({
      where: { id: incidentId },
      data: {
        state: "resolved",
        resolvedAt: now,
        resolvedByUserId: actorUserId,
        nextEscalationAt: null,
        postmortemStatus:
          postmortemStatus === "not_started" ? "draft" : postmortemStatus,
      },
    });

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.resolved",
      message: note ?? "Incident resolved",
      actorUserId,
      meta: {
        postmortemStatus:
          postmortemStatus === "not_started" ? "draft" : postmortemStatus,
      },
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function closeIncidentRun(
  input: IncidentActorInput
): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  if (!incidentId || !actorUserId) {
    throw new IncidentEngineError(400, "incidentId and actorUserId are required");
  }
  const note = trimToNull(input.note, 600);
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "close")) {
      throw new IncidentEngineError(
        409,
        "Incident must be resolved before it can be closed"
      );
    }

    await tx.incidentWorkflowRun.update({
      where: { id: incidentId },
      data: {
        state: "closed",
        closedAt: now,
        closedByUserId: actorUserId,
        nextEscalationAt: null,
      },
    });

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.closed",
      message: note ?? "Incident closed",
      actorUserId,
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function reopenIncidentRun(
  input: IncidentActorInput
): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  if (!incidentId || !actorUserId) {
    throw new IncidentEngineError(400, "incidentId and actorUserId are required");
  }
  const note = trimToNull(input.note, 600);
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true, severity: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "reopen")) {
      throw new IncidentEngineError(409, `Incident is already ${state}`);
    }

    const severity = normalizeIncidentSeverity(row.severity, "medium") ?? "medium";
    const timers = computeIncidentTimers({ severity, now });

    await tx.incidentWorkflowRun.update({
      where: { id: incidentId },
      data: {
        state: "open",
        acknowledgedAt: null,
        acknowledgedByUserId: null,
        resolvedAt: null,
        resolvedByUserId: null,
        closedAt: null,
        closedByUserId: null,
        ackDueAt: timers.ackDueAt,
        nextEscalationAt: timers.nextEscalationAt,
      },
    });

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.reopened",
      message: note ?? "Incident reopened",
      actorUserId,
      meta: {
        timers: {
          ackDueAt: timers.ackDueAt.toISOString(),
          nextEscalationAt: timers.nextEscalationAt.toISOString(),
        },
      },
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function addIncidentNote(input: {
  incidentId: string;
  actorUserId: string;
  message: string;
}): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  const message = trimToNull(input.message, 1200);
  if (!incidentId || !actorUserId || !message) {
    throw new IncidentEngineError(400, "incidentId, actorUserId, and message are required");
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "note")) {
      throw new IncidentEngineError(409, `Cannot add note while incident is ${state}`);
    }

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.note",
      message,
      actorUserId,
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function updateIncidentPostmortem(
  input: UpdateIncidentPostmortemInput
): Promise<IncidentRunDetail> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  if (!incidentId || !actorUserId) {
    throw new IncidentEngineError(400, "incidentId and actorUserId are required");
  }

  const normalizedStatus = normalizePostmortemStatus(input.status, null);
  const summary = input.summary === undefined ? undefined : trimToNull(input.summary, 4000);
  const impact = input.impact === undefined ? undefined : trimToNull(input.impact, 4000);
  const rootCause =
    input.rootCause === undefined ? undefined : trimToNull(input.rootCause, 4000);

  let actionItems: IncidentPostmortemActionItem[] | undefined;
  if (input.actionItems !== undefined) {
    if (typeof input.actionItems === "string") {
      actionItems = lineItemsToActionItems(input.actionItems);
    } else {
      actionItems = normalizePostmortemActionItems(input.actionItems);
    }
  }

  if (
    normalizedStatus === null &&
    summary === undefined &&
    impact === undefined &&
    rootCause === undefined &&
    actionItems === undefined
  ) {
    throw new IncidentEngineError(400, "No postmortem fields supplied");
  }

  await prisma.$transaction(async (tx) => {
    const row = await tx.incidentWorkflowRun.findUnique({
      where: { id: incidentId },
      select: { id: true, state: true },
    });
    if (!row) throw new IncidentEngineError(404, "Incident not found");
    const state = normalizeStateInternal(row.state) ?? "open";
    if (!canRunIncidentAction(state, "postmortem")) {
      throw new IncidentEngineError(409, `Cannot edit postmortem while incident is ${state}`);
    }

    const data: Prisma.IncidentWorkflowRunUpdateInput = {};
    if (normalizedStatus !== null) {
      data.postmortemStatus = normalizedStatus;
      data.postmortemPublishedAt =
        normalizedStatus === "published" ? new Date() : null;
    }
    if (summary !== undefined) data.postmortemSummary = summary;
    if (impact !== undefined) data.postmortemImpact = impact;
    if (rootCause !== undefined) data.postmortemRootCause = rootCause;
    if (actionItems !== undefined) {
      data.postmortemActionItemsJson = serializePostmortemActionItems(actionItems);
    }

    await tx.incidentWorkflowRun.update({
      where: { id: incidentId },
      data,
    });

    await appendIncidentEventTx(tx, {
      incidentId,
      type: "incident.postmortem.updated",
      message: "Postmortem scaffold updated",
      actorUserId,
      meta: {
        status: normalizedStatus,
        summaryUpdated: summary !== undefined,
        impactUpdated: impact !== undefined,
        rootCauseUpdated: rootCause !== undefined,
        actionItemsCount: actionItems?.length ?? null,
      },
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) throw new IncidentEngineError(404, "Incident not found");
  return detail;
}

export async function executeIncidentWorkflowStep(
  input: ExecuteIncidentWorkflowStepInput
): Promise<{
  ok: boolean;
  error?: string;
  incident: IncidentRunDetail;
  result: unknown;
  workflow: {
    id: string;
    title: string;
    severity: IncidentSeverityValue;
  };
  step: {
    id: string;
    title: string;
    action: string | null;
  };
}> {
  const incidentId = trimToNull(input.incidentId, 80);
  const actorUserId = trimToNull(input.actorUserId, 80);
  const actorEmail = trimToNull(input.actorEmail, 240);
  if (!incidentId || !actorUserId || !actorEmail) {
    throw new IncidentEngineError(400, "incidentId, actorUserId, and actorEmail are required");
  }

  const row = await prisma.incidentWorkflowRun.findUnique({
    where: { id: incidentId },
    select: {
      id: true,
      state: true,
      workflowId: true,
      title: true,
    },
  });
  if (!row) {
    throw new IncidentEngineError(404, "Incident not found");
  }
  const state = normalizeStateInternal(row.state) ?? "open";
  if (!canRunIncidentAction(state, "step")) {
    throw new IncidentEngineError(409, `Cannot execute workflow steps while incident is ${state}`);
  }

  const resolved = resolveWorkflowStepInput({
    workflowId: row.workflowId,
    stepId: input.stepId,
    payload: input.payload ?? {},
  });
  if (!resolved.ok) {
    throw new IncidentEngineError(resolved.status, resolved.error);
  }
  if (resolved.step.kind !== "api" || !resolved.step.action) {
    throw new IncidentEngineError(400, "Step is manual-only and cannot be executed by API");
  }

  const execution = await executeWorkflowApiStep({
    workflow: resolved.workflow,
    step: resolved.step,
    payload: resolved.payload,
    actor: {
      userId: actorUserId,
      email: actorEmail,
      observability: input.observability,
    },
  });

  await prisma.$transaction(async (tx) => {
    await appendIncidentEventTx(tx, {
      incidentId,
      type: execution.ok ? "incident.step.executed" : "incident.step.failed",
      stepId: resolved.step.id,
      actorUserId,
      message: execution.ok
        ? `Workflow step "${resolved.step.title}" executed`
        : `Workflow step "${resolved.step.title}" failed: ${execution.error ?? "unknown"}`,
      meta: {
        workflowId: resolved.workflow.id,
        stepId: resolved.step.id,
        action: resolved.step.action,
        ok: execution.ok,
        error: execution.error ?? null,
      },
    });
  });

  const detail = await getIncidentRunDetail(incidentId, { timelineLimit: 120 });
  if (!detail) {
    throw new IncidentEngineError(404, "Incident not found");
  }

  return {
    ok: execution.ok,
    error: execution.error,
    incident: detail,
    result: execution.result,
    workflow: {
      id: execution.workflow.id,
      title: execution.workflow.title,
      severity:
        normalizeIncidentSeverity(execution.workflow.severity, "medium") ?? "medium",
    },
    step: {
      id: execution.step.id,
      title: execution.step.title,
      action: execution.step.action ?? null,
    },
  };
}

export async function runIncidentEscalationSweep(
  input?: IncidentEscalationSweepInput
): Promise<IncidentEscalationSweepResult> {
  const now = input?.now ?? new Date();
  const limit = parsePositiveInt(input?.limit ?? 25, 25, 1, 200);
  const actorUserId = trimToNull(input?.actorUserId, 80);

  const due = await prisma.incidentWorkflowRun.findMany({
    where: {
      state: "open",
      OR: [
        {
          nextEscalationAt: {
            not: null,
            lte: now,
          },
        },
        {
          nextEscalationAt: null,
          ackDueAt: {
            not: null,
            lte: now,
          },
        },
      ],
    },
    orderBy: [{ nextEscalationAt: "asc" }, { ackDueAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true,
      severity: true,
      escalationCount: true,
    },
  });

  const escalatedIds: string[] = [];

  for (const row of due) {
    const severity = normalizeIncidentSeverity(row.severity, "medium") ?? "medium";
    const policy = incidentTimerPolicyForSeverity(severity);
    const nextEscalationAt = addMinutes(now, policy.escalationMinutes);

    await prisma.$transaction(async (tx) => {
      await tx.incidentWorkflowRun.update({
        where: { id: row.id },
        data: {
          escalatedAt: now,
          escalationCount: row.escalationCount + 1,
          nextEscalationAt,
        },
      });

      await appendIncidentEventTx(tx, {
        incidentId: row.id,
        type: "incident.escalated",
        actorUserId,
        message: `Escalation #${row.escalationCount + 1} triggered`,
        meta: {
          escalationCount: row.escalationCount + 1,
          nextEscalationAt: nextEscalationAt.toISOString(),
        },
      });
    });

    escalatedIds.push(row.id);
  }

  const nextDue = await prisma.incidentWorkflowRun.findFirst({
    where: {
      state: "open",
      OR: [{ nextEscalationAt: { not: null } }, { ackDueAt: { not: null } }],
    },
    orderBy: [{ nextEscalationAt: "asc" }, { ackDueAt: "asc" }],
    select: {
      nextEscalationAt: true,
      ackDueAt: true,
    },
  });

  return {
    ok: true,
    evaluated: due.length,
    escalated: escalatedIds.length,
    incidentIds: escalatedIds,
    nextDueAt: toIso(nextDue?.nextEscalationAt ?? nextDue?.ackDueAt ?? null),
  };
}
