import {
  extractSignalsFromStatus,
  type IncidentSignal,
  type SignalSeverity,
} from "@/lib/incident-signals";
import type { PrismaClient } from "@prisma/client";

type BreachSeverity = "info" | "warn" | "critical";
type BreachState = "open" | "fixed" | "ignored";

type AutoBreachEvidence = {
  managedBy: "host-status-auto-breach";
  version: 1;
  key: string;
  snapshotId: string;
  snapshotTs: string;
  lastObservedTs: string;
  resolvedTs?: string;
  signal: {
    code: string;
    severity: SignalSeverity;
    title: string;
    detail?: string;
    source: IncidentSignal["source"];
  };
};

type AutoBreachCandidate = {
  key: string;
  code: string;
  title: string;
  detail: string | null;
  severity: BreachSeverity;
  signalSeverity: SignalSeverity;
  evidenceJson: string;
};

type AutoBreachRow = {
  id: string;
  code: string | null;
  title: string;
  detail: string | null;
  severity: BreachSeverity;
  state: BreachState;
  evidenceJson: string | null;
};

type BreachClient = {
  breach: Pick<PrismaClient["breach"], "findMany" | "create" | "update">;
};

export type AutoBreachSyncResult = {
  opened: number;
  fixed: number;
  active: number;
  suppressed: number;
};

const AUTO_BREACH_CODES = new Set([
  "config_tamper",
  "firewall_drift",
  "account_drift",
  "unexpected_public_ports",
]);

const SEVERITY_RANK: Record<SignalSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function toIso(ts: Date | string): string {
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return new Date().toISOString();
  }
  return ts.toISOString();
}

function signalToBreachSeverity(severity: SignalSeverity): BreachSeverity {
  if (severity === "critical") return "critical";
  if (severity === "high" || severity === "medium") return "warn";
  return "info";
}

function buildAutoBreachKey(signal: IncidentSignal): string {
  if (signal.code === "alert_generic") {
    return `alert_generic:${signal.title.trim().toLowerCase()}`;
  }
  return signal.code;
}

function buildAutoBreachEvidence(input: {
  key: string;
  signal: IncidentSignal;
  snapshotId: string;
  snapshotTs: string;
  resolvedTs?: string;
}): string {
  const evidence: AutoBreachEvidence = {
    managedBy: "host-status-auto-breach",
    version: 1,
    key: input.key,
    snapshotId: input.snapshotId,
    snapshotTs: input.snapshotTs,
    lastObservedTs: input.snapshotTs,
    signal: {
      code: input.signal.code,
      severity: input.signal.severity,
      title: input.signal.title,
      detail: input.signal.detail,
      source: input.signal.source,
    },
  };

  if (input.resolvedTs) {
    evidence.resolvedTs = input.resolvedTs;
  }

  return JSON.stringify(evidence);
}

function parseAutoBreachEvidence(raw: string | null): AutoBreachEvidence | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.managedBy !== "host-status-auto-breach") return null;
    if (record.key === undefined || typeof record.key !== "string" || !record.key.trim()) return null;
    return record as AutoBreachEvidence;
  } catch {
    return null;
  }
}

export function shouldPromoteSignalToBreach(signal: IncidentSignal): boolean {
  if (AUTO_BREACH_CODES.has(signal.code)) return true;
  return signal.source === "alert" && signal.severity === "critical";
}

export function collectAutoBreachCandidates(input: {
  status: Record<string, unknown>;
  snapshotId: string;
  ts: Date | string;
}): AutoBreachCandidate[] {
  const signals = extractSignalsFromStatus({
    status: input.status,
    snapshotId: input.snapshotId,
    ts: input.ts,
  });

  const snapshotTs = toIso(input.ts);
  const byKey = new Map<string, AutoBreachCandidate>();

  for (const signal of signals) {
    if (!shouldPromoteSignalToBreach(signal)) continue;
    const key = buildAutoBreachKey(signal);
    const candidate: AutoBreachCandidate = {
      key,
      code: signal.code,
      title: signal.title,
      detail: signal.detail ?? null,
      severity: signalToBreachSeverity(signal.severity),
      signalSeverity: signal.severity,
      evidenceJson: buildAutoBreachEvidence({
        key,
        signal,
        snapshotId: input.snapshotId,
        snapshotTs,
      }),
    };

    const existing = byKey.get(key);
    if (!existing || SEVERITY_RANK[candidate.signalSeverity] > SEVERITY_RANK[existing.signalSeverity]) {
      byKey.set(key, candidate);
    }
  }

  return Array.from(byKey.values());
}

export async function reconcileAutoBreachesForHost(input: {
  prisma: BreachClient;
  hostId: string;
  snapshotId: string;
  status: Record<string, unknown>;
  ts: Date | string;
}): Promise<AutoBreachSyncResult> {
  const candidates = collectAutoBreachCandidates({
    status: input.status,
    snapshotId: input.snapshotId,
    ts: input.ts,
  });
  const snapshotTs = toIso(input.ts);

  const existingRows = await input.prisma.breach.findMany({
    where: {
      hostId: input.hostId,
      state: { in: ["open", "ignored"] },
    },
    orderBy: [{ openedTs: "desc" }],
    select: {
      id: true,
      code: true,
      title: true,
      detail: true,
      severity: true,
      state: true,
      evidenceJson: true,
    },
  });

  const openAutoBreaches = new Map<string, AutoBreachRow>();
  const ignoredAutoBreachKeys = new Set<string>();

  for (const row of existingRows) {
    const evidence = parseAutoBreachEvidence(row.evidenceJson);
    if (!evidence) continue;
    if (row.state === "ignored") {
      ignoredAutoBreachKeys.add(evidence.key);
      continue;
    }
    if (!openAutoBreaches.has(evidence.key)) {
      openAutoBreaches.set(evidence.key, row);
    }
  }

  let opened = 0;
  let fixed = 0;
  let suppressed = 0;
  const mutations: Promise<unknown>[] = [];

  for (const candidate of candidates) {
    if (ignoredAutoBreachKeys.has(candidate.key)) {
      suppressed += 1;
      openAutoBreaches.delete(candidate.key);
      continue;
    }

    const existing = openAutoBreaches.get(candidate.key);
    if (existing) {
      openAutoBreaches.delete(candidate.key);
      if (
        existing.code !== candidate.code ||
        existing.title !== candidate.title ||
        existing.detail !== candidate.detail ||
        existing.severity !== candidate.severity
      ) {
        mutations.push(
          input.prisma.breach.update({
            where: { id: existing.id },
            data: {
              code: candidate.code,
              title: candidate.title,
              detail: candidate.detail,
              severity: candidate.severity,
              evidenceJson: candidate.evidenceJson,
            },
          })
        );
      }
      continue;
    }

    opened += 1;
    mutations.push(
      input.prisma.breach.create({
        data: {
          hostId: input.hostId,
          code: candidate.code,
          title: candidate.title,
          detail: candidate.detail,
          severity: candidate.severity,
          state: "open",
          openedTs: new Date(snapshotTs),
          evidenceJson: candidate.evidenceJson,
        },
      })
    );
  }

  for (const row of openAutoBreaches.values()) {
    fixed += 1;
    const evidence = parseAutoBreachEvidence(row.evidenceJson);
    mutations.push(
      input.prisma.breach.update({
        where: { id: row.id },
        data: {
          state: "fixed",
          fixedTs: new Date(snapshotTs),
          evidenceJson: buildAutoBreachEvidence({
            key: evidence?.key ?? row.code ?? row.id,
            signal: {
              code: evidence?.signal.code ?? row.code ?? "auto_breach",
              severity: evidence?.signal.severity ?? "medium",
              title: evidence?.signal.title ?? row.title,
              detail: evidence?.signal.detail ?? row.detail ?? undefined,
              source: evidence?.signal.source ?? "alert",
              ts: snapshotTs,
            },
            snapshotId: evidence?.snapshotId ?? input.snapshotId,
            snapshotTs: evidence?.snapshotTs ?? snapshotTs,
            resolvedTs: snapshotTs,
          }),
        },
      })
    );
  }

  if (mutations.length > 0) {
    await Promise.all(mutations);
  }

  return {
    opened,
    fixed,
    active: candidates.length,
    suppressed,
  };
}
