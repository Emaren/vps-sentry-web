// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/StatusActionPopup.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { FixResult, Panel, StatusActionPopupProps } from "./types";
import { buildActionsNeeded, buildExplainText, buildFixSteps, sleep } from "./logic";
import { fmtBytes } from "../reclaim-utils";
import { css, btn, caretBtn, okBtn, xBtn } from "./styles";
import { useTypewriter } from "./hooks/useTypewriter";
import {
  DEFAULT_COUNTERSTRIKE_PLAYBOOK,
  getCounterstrikePlaybook,
} from "@/lib/ops/counterstrike-playbooks";

import StatusLight from "./components/StatusLight";
import ActionsPanel from "./components/ActionsPanel";
import ExplainPanel from "./components/ExplainPanel";
import FixPanel from "./components/FixPanel";

type JsonRecord = Record<string, unknown>;

type StepOutcome = {
  ok: boolean;
  detail: string;
};

type RemediationPlanAction = {
  id: string;
  title: string;
  risk: "low" | "medium" | "high";
  autoTier: string;
  confirmPhrase: string;
};

type TrackedRunsSummary = {
  total: number;
  byState: Record<string, number>;
  delayed: number;
  approvalPending: number;
  details: string[];
};

type FixStatusAlert = {
  code: string | null;
  title: string;
  detail: string;
};

type FixThreatProcess = {
  pid: number;
  proc: string;
  exe: string;
  reasons: string[];
};

type FixDiskPressureSnapshot = {
  alertCount: number;
  detail: string | null;
  safeReclaimableBytes: number;
  reclaimableBytesTotal: number;
  rebuildableBytes: number;
  guidedReclaimableBytes: number;
  blockedReclaimableBytes: number;
  runningCleanup: boolean;
  lastCleanupFinishedAt: string | null;
  usedPercent: number | null;
  failPercent: number | null;
  availableBytes: number | null;
  totalBytes: number | null;
};

type FixStatusSnapshot = {
  alerts: FixStatusAlert[];
  unexpectedPublicPortsCount: number;
  publicPortsTotalCount: number;
  expectedPublicPorts: string[];
  sshFailedPassword: number;
  sshInvalidUser: number;
  threatIndicatorCount: number;
  suspiciousProcesses: FixThreatProcess[];
  diskPressure: FixDiskPressureSnapshot;
};

type CounterstrikeRunningSnapshot = {
  runId: string | null;
  playbook: string | null;
  playbookLabel: string | null;
  currentLabel: string | null;
  updatedAt: string | null;
};

type CounterstrikeLastSnapshot = {
  runId: string | null;
  playbook: string | null;
  playbookLabel: string | null;
  status: string | null;
  summary: string | null;
  errors: string[];
  updatedAt: string | null;
};

type CounterstrikeStatusSnapshot = {
  running: CounterstrikeRunningSnapshot | null;
  last: CounterstrikeLastSnapshot | null;
};

const COUNTERSTRIKE_ZAP_TWO_ID = "zap-02-busybox-loader-cutoff";
const COUNTERSTRIKE_POLL_MS = 1_200;
const COUNTERSTRIKE_TIMEOUT_MS = 90_000;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" ? (v as JsonRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function asStringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function toRemediationPlanAction(raw: JsonRecord): RemediationPlanAction | null {
  const id = asString(raw.id);
  if (!id) return null;

  const riskRaw = asString(raw.risk)?.toLowerCase();
  const risk: RemediationPlanAction["risk"] =
    riskRaw === "low" || riskRaw === "medium" || riskRaw === "high" ? riskRaw : "high";

  return {
    id,
    title: asString(raw.title) ?? id,
    risk,
    autoTier: asString(raw.autoTier) ?? "observe",
    confirmPhrase: asString(raw.confirmPhrase) ?? `EXECUTE ${id}`,
  };
}

function normalizeHostToken(v: string): string {
  return v.trim().toLowerCase();
}

function safeActionPriorityValue(action: RemediationPlanAction): number {
  if (action.autoTier === "safe_auto") return 3;
  if (action.autoTier === "guarded_auto") return 2;
  return 1;
}

async function resolveHostIdForName(hostName: string): Promise<{ hostId: string | null; note?: string }> {
  const lookup = normalizeHostToken(hostName);
  const res = await fetch("/api/hosts", {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    return { hostId: null, note: `Could not list hosts (${res.status}).` };
  }

  const payload = asRecord(await res.json().catch(() => null)) ?? {};
  const hostRows = asArray(payload.hosts)
    .map((row) => asRecord(row))
    .filter((row): row is JsonRecord => row !== null);

  if (hostRows.length === 0) {
    return { hostId: null, note: "No hosts were found for this account." };
  }

  const exactByName = hostRows.find((row) => normalizeHostToken(asString(row.name) ?? "") === lookup);
  const exactBySlug = hostRows.find((row) => normalizeHostToken(asString(row.slug) ?? "") === lookup);
  const exact = exactByName ?? exactBySlug;
  if (exact) {
    const id = asString(exact.id);
    if (id) return { hostId: id };
  }

  if (hostRows.length === 1) {
    const onlyId = asString(hostRows[0]?.id);
    if (onlyId) {
      return { hostId: onlyId };
    }
  }

  return {
    hostId: null,
    note: `Could not map '${hostName}' to a managed host ID.`,
  };
}

async function readQueueSnapshot(limit = 80): Promise<JsonRecord | null> {
  try {
    const res = await fetch(`/api/ops/remediate-queue?limit=${limit}`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = asRecord(await res.json().catch(() => null)) ?? {};
    return asRecord(payload.snapshot);
  } catch {
    return null;
  }
}

function asInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function formatPercent(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "unknown";
}

export function normalizeAlertCode(alert: FixStatusAlert): string {
  const code = alert.code?.trim().toLowerCase() ?? "";
  if (code === "public_ports_changed") return "ports_changed";
  if (code) return code;
  const title = `${alert.title} ${alert.detail}`.toLowerCase();
  if (/watched files changed/.test(title)) return "watched_files_changed";
  if (/packages changed/.test(title)) return "packages_changed";
  if (/user list changed/.test(title)) return "user_list_changed";
  if (/cron changed/.test(title)) return "cron_changed";
  if (/firewall changed/.test(title)) return "firewall_changed";
  if (/ports changed|public ports changed/.test(title)) return "ports_changed";
  return "";
}

export function isBaselineDriftAlert(alert: FixStatusAlert): boolean {
  const code = normalizeAlertCode(alert);
  return (
    code === "watched_files_changed" ||
    code === "packages_changed" ||
    code === "user_list_changed" ||
    code === "cron_changed" ||
    code === "firewall_changed" ||
    code === "ports_changed"
  );
}

function isBaselineDriftOnlySnapshot(snapshot: FixStatusSnapshot): boolean {
  if (snapshot.alerts.length === 0) return false;
  if (snapshot.unexpectedPublicPortsCount > 0) return false;
  return snapshot.alerts.every(isBaselineDriftAlert);
}

function normalizeAlertSignal(alert: FixStatusAlert): string {
  return `${alert.code ?? ""} ${alert.title} ${alert.detail}`.toLowerCase();
}

function isRuntimeThreatAlert(alert: FixStatusAlert): boolean {
  const signal = normalizeAlertSignal(alert);
  return (
    signal.includes("suspicious_process_ioc") ||
    signal.includes("suspicious process ioc") ||
    signal.includes("outbound_scan_ioc") ||
    signal.includes("outbound scan ioc") ||
    signal.includes("cpu_hotspot") ||
      signal.includes("cpu hotspot")
  );
}

export function isDiskPressureAlert(alert: FixStatusAlert): boolean {
  const signal = normalizeAlertSignal(alert);
  return (
    signal.includes("host_disk_critical") ||
    signal.includes("host disk critical") ||
    signal.includes("host disk pressure") ||
    signal.includes("disk pressure")
  );
}

function isSystemPathExecutable(exe: string): boolean {
  const lower = exe.trim().toLowerCase();
  return (
    lower.startsWith("/bin/") ||
    lower.startsWith("/sbin/") ||
    lower.startsWith("/usr/bin/") ||
    lower.startsWith("/usr/sbin/") ||
    lower.startsWith("/usr/lib/") ||
    lower.startsWith("/lib/") ||
    lower.startsWith("/lib64/") ||
    lower.startsWith("/opt/") ||
    lower.startsWith("/snap/") ||
    lower.startsWith("/etc/")
  );
}

function isContainerLoaderSignal(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("busybox") ||
    lower.includes("/bin/sh") ||
    lower.includes("/bin/bash") ||
    lower.includes("container") ||
    lower.includes("docker") ||
    lower.includes("loader") ||
    lower.includes("payload")
  );
}

export function pickCounterstrikePlaybookId(input: {
  snapshot: FixStatusSnapshot | null;
  alertsPreview?: StatusActionPopupProps["alertsPreview"];
}): string {
  const suspiciousProcesses = input.snapshot?.suspiciousProcesses ?? [];
  const protectedPathThreat = suspiciousProcesses.some((process) => isSystemPathExecutable(process.exe));
  const containerLoaderThreat = suspiciousProcesses.some((process) =>
    isContainerLoaderSignal(`${process.exe} ${process.proc} ${process.reasons.join(" ")}`)
  );
  const alertSignals = (input.alertsPreview ?? []).some((alert) =>
    isContainerLoaderSignal(`${alert.code ?? ""} ${alert.title} ${alert.detail ?? ""}`)
  );

  if (protectedPathThreat || containerLoaderThreat || alertSignals) {
    return COUNTERSTRIKE_ZAP_TWO_ID;
  }

  return DEFAULT_COUNTERSTRIKE_PLAYBOOK.id;
}

function formatThreatProcess(process: FixThreatProcess): string {
  const base = process.exe || process.proc || "process";
  return process.pid > 0 ? `${base} #${process.pid}` : base;
}

function projectedSafeDiskUsedPercent(snapshot: FixStatusSnapshot): number | null {
  const { availableBytes, safeReclaimableBytes, totalBytes } = snapshot.diskPressure;
  if (
    typeof availableBytes !== "number" ||
    !Number.isFinite(availableBytes) ||
    typeof safeReclaimableBytes !== "number" ||
    !Number.isFinite(safeReclaimableBytes) ||
    typeof totalBytes !== "number" ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }

  const projectedAvailable = Math.min(totalBytes, availableBytes + safeReclaimableBytes);
  const projectedUsed = Math.max(0, totalBytes - projectedAvailable);
  return (projectedUsed / totalBytes) * 100;
}

function buildDiskPressureBlocker(snapshot: FixStatusSnapshot): string | null {
  if (snapshot.diskPressure.alertCount <= 0) return null;

  const parts: string[] = [];
  if (snapshot.diskPressure.detail) {
    parts.push(snapshot.diskPressure.detail);
  } else if (snapshot.diskPressure.usedPercent !== null) {
    parts.push(`root disk still at ${formatPercent(snapshot.diskPressure.usedPercent)} used`);
  } else {
    parts.push("root disk pressure is still critical");
  }

  const safeBytes = snapshot.diskPressure.safeReclaimableBytes;
  if (safeBytes > 0) {
    const projectedUsed = projectedSafeDiskUsedPercent(snapshot);
    if (
      projectedUsed !== null &&
      snapshot.diskPressure.failPercent !== null &&
      projectedUsed >= snapshot.diskPressure.failPercent
    ) {
      parts.push(
        `safe reclaim only covers ${fmtBytes(safeBytes)} right now, which still leaves the host above the ${snapshot.diskPressure.failPercent}% fail line`
      );
    } else {
      parts.push(`safe reclaim catalog currently offers ${fmtBytes(safeBytes)}`);
    }
  } else {
    parts.push("no safe reclaim candidates are currently cataloged");
  }

  return parts.join("; ");
}

function buildSnapshotBlockers(snapshot: FixStatusSnapshot): string[] {
  const blockers: string[] = [];
  const runtimeAlerts = snapshot.alerts.filter(isRuntimeThreatAlert).length;
  const driftAlerts = snapshot.alerts.filter(isBaselineDriftAlert).length;
  const diskAlerts = snapshot.alerts.filter(isDiskPressureAlert).length;
  const otherAlerts = Math.max(0, snapshot.alerts.length - runtimeAlerts - driftAlerts - diskAlerts);
  const suspiciousCount = snapshot.suspiciousProcesses.length;
  const systemPathRuntime = snapshot.suspiciousProcesses.find((process) => isSystemPathExecutable(process.exe));

  if (runtimeAlerts > 0 || snapshot.threatIndicatorCount > 0 || suspiciousCount > 0) {
    const indicatorCount = Math.max(runtimeAlerts, snapshot.threatIndicatorCount, suspiciousCount);
    const sample = systemPathRuntime ?? snapshot.suspiciousProcesses[0] ?? null;
    const sampleText = sample
      ? systemPathRuntime
        ? `; protected-path runtime still visible around ${formatThreatProcess(sample)}`
        : `; sample ${formatThreatProcess(sample)}`
      : "";
    blockers.push(
      `runtime IOC still active (${indicatorCount} threat signal${indicatorCount === 1 ? "" : "s"}${sampleText})`
    );
  }
  if (snapshot.unexpectedPublicPortsCount > 0) {
    blockers.push(
      `${snapshot.unexpectedPublicPortsCount} unexpected public port${snapshot.unexpectedPublicPortsCount === 1 ? "" : "s"} still exposed`
    );
  }
  const diskBlocker = buildDiskPressureBlocker(snapshot);
  if (diskBlocker) {
    blockers.push(diskBlocker);
  }
  if (driftAlerts > 0) {
    blockers.push(
      `${driftAlerts} drift alert${driftAlerts === 1 ? "" : "s"} still need review or baseline acceptance`
    );
  }
  if (otherAlerts > 0) {
    blockers.push(`${otherAlerts} other alert${otherAlerts === 1 ? "" : "s"} still active`);
  }

  return blockers;
}

function buildFixResultDetails(input: {
  beforeSnapshot: FixStatusSnapshot | null;
  afterSnapshot: FixStatusSnapshot | null;
  snapshotAdvanced: boolean;
  postRefreshSnapshotTs: string | null;
}): string[] {
  const details: string[] = [];
  const { afterSnapshot, beforeSnapshot, postRefreshSnapshotTs, snapshotAdvanced } = input;

  if (beforeSnapshot && afterSnapshot) {
    const alertsBefore = beforeSnapshot.alerts.length;
    const alertsAfter = afterSnapshot.alerts.length;
    details.push(`Alerts: ${alertsBefore} -> ${alertsAfter} (${Math.max(0, alertsBefore - alertsAfter)} cleared).`);
    details.push(
      `Unexpected public ports: ${beforeSnapshot.unexpectedPublicPortsCount} -> ${afterSnapshot.unexpectedPublicPortsCount}.`
    );
    details.push(`Threat signals: ${beforeSnapshot.threatIndicatorCount} -> ${afterSnapshot.threatIndicatorCount}.`);
    if (beforeSnapshot.diskPressure.alertCount > 0 || afterSnapshot.diskPressure.alertCount > 0) {
      details.push(
        `Root disk used: ${formatPercent(beforeSnapshot.diskPressure.usedPercent)} -> ${formatPercent(afterSnapshot.diskPressure.usedPercent)}. Safe reclaim catalog: ${fmtBytes(beforeSnapshot.diskPressure.safeReclaimableBytes)} -> ${fmtBytes(afterSnapshot.diskPressure.safeReclaimableBytes)}.`
      );
    }
  } else if (afterSnapshot) {
    details.push(`Latest snapshot still reports ${afterSnapshot.alerts.length} active alert(s).`);
  } else {
    details.push("The latest status snapshot could not be re-read after Fix Now finished.");
  }

  if (!snapshotAdvanced) {
    details.push(
      postRefreshSnapshotTs
        ? `A newer snapshot has not landed yet (latest visible: ${postRefreshSnapshotTs}).`
        : "A newer snapshot has not landed yet."
    );
  }

  if (afterSnapshot) {
    const blockers = buildSnapshotBlockers(afterSnapshot);
    if (blockers.length > 0) {
      details.push(`Still not green because ${blockers.join("; ")}.`);
    } else if (afterSnapshot.alerts.length === 0 && afterSnapshot.unexpectedPublicPortsCount === 0) {
      details.push("No blockers remain in the latest snapshot.");
    }
  }

  return details;
}

async function readFixStatusSnapshot(): Promise<FixStatusSnapshot | null> {
  try {
    const res = await fetch("/api/status", {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;

    const payload = asRecord(await res.json().catch(() => null)) ?? {};
    const status = asRecord(payload.status);
    if (!status) return null;

    const alerts = asArray(status.alerts)
      .map((item) => asRecord(item))
      .filter((item): item is JsonRecord => item !== null)
      .map((item) => ({
        code: asString(item.code),
        title: asStringOrEmpty(item.title) || "Alert",
        detail: asStringOrEmpty(item.detail),
      }));

    const auth = asRecord(status.auth);
    const threat = asRecord(status.threat);
    const garbageEstimate = asRecord(status.garbage_estimate);
    const projectStorage = asRecord(status.project_storage);
    const hostFilesystem = asRecord(projectStorage?.host_filesystem);
    const indicators = asArray(threat?.indicators);
    const suspiciousProcesses = asArray(threat?.suspicious_processes)
      .map((item) => asRecord(item))
      .filter((item): item is JsonRecord => item !== null)
      .map((item) => ({
        pid: asInt(item.pid),
        proc: asStringOrEmpty(item.proc) || "process",
        exe: asStringOrEmpty(item.exe),
        reasons: asArray(item.reasons).map((reason) => asStringOrEmpty(reason)).filter(Boolean),
      }))
      .filter((item) => item.pid > 0 || item.exe.length > 0 || item.proc.length > 0);
    const diskAlert = alerts.find((alert) => isDiskPressureAlert(alert)) ?? null;

    return {
      alerts,
      unexpectedPublicPortsCount: asInt(status.unexpected_public_ports_count),
      publicPortsTotalCount: asInt(status.public_ports_count),
      expectedPublicPorts: asArray(status.expected_public_ports)
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value)),
      sshFailedPassword: asInt(auth?.ssh_failed_password),
      sshInvalidUser: asInt(auth?.ssh_invalid_user),
      threatIndicatorCount: Math.max(indicators.length, suspiciousProcesses.length),
      suspiciousProcesses,
      diskPressure: {
        alertCount: alerts.filter((alert) => isDiskPressureAlert(alert)).length,
        detail: diskAlert?.detail ?? null,
        safeReclaimableBytes: asInt(garbageEstimate?.safe_reclaimable_bytes),
        reclaimableBytesTotal: asInt(garbageEstimate?.reclaimable_bytes_total),
        rebuildableBytes: asInt(garbageEstimate?.rebuildable_bytes),
        guidedReclaimableBytes: asInt(garbageEstimate?.guided_reclaimable_bytes),
        blockedReclaimableBytes: asInt(garbageEstimate?.blocked_reclaimable_bytes),
        runningCleanup: asBoolean(garbageEstimate?.running_cleanup) === true,
        lastCleanupFinishedAt: asString(asRecord(garbageEstimate?.last_cleanup_result)?.finished_at),
        usedPercent: asNumber(hostFilesystem?.used_percent),
        failPercent: asNumber(hostFilesystem?.fail_percent),
        availableBytes: asNumber(hostFilesystem?.available_bytes),
        totalBytes: asNumber(hostFilesystem?.total_bytes),
      },
    };
  } catch {
    return null;
  }
}

function snapshotToAlertsPreview(snapshot: FixStatusSnapshot | null): StatusActionPopupProps["alertsPreview"] | undefined {
  if (!snapshot) return undefined;
  return snapshot.alerts.map((alert) => ({
    code: alert.code ?? undefined,
    title: alert.title,
    detail: alert.detail,
  }));
}

function snapshotAllowlistedTotal(snapshot: FixStatusSnapshot | null): number | null {
  if (!snapshot) return null;
  return snapshot.publicPortsTotalCount > 0 && snapshot.unexpectedPublicPortsCount === 0
    ? snapshot.publicPortsTotalCount
    : null;
}

function normalizeCounterstrikeStatusSnapshot(payload: JsonRecord | null): CounterstrikeStatusSnapshot | null {
  if (!payload) return null;

  const runningRaw = asRecord(payload.running);
  const lastRaw = asRecord(payload.last);

  return {
    running: runningRaw
      ? {
          runId: asString(runningRaw.runId ?? runningRaw.run_id),
          playbook: asString(runningRaw.playbook),
          playbookLabel: asString(runningRaw.playbookLabel ?? runningRaw.playbook_label),
          currentLabel: asString(runningRaw.currentLabel ?? runningRaw.current_label),
          updatedAt: asString(runningRaw.updatedAt ?? runningRaw.updated_at),
        }
      : null,
    last: lastRaw
      ? {
          runId: asString(lastRaw.runId ?? lastRaw.run_id),
          playbook: asString(lastRaw.playbook),
          playbookLabel: asString(lastRaw.playbookLabel ?? lastRaw.playbook_label),
          status: asString(lastRaw.status),
          summary: asString(lastRaw.summary),
          errors: asArray(lastRaw.errors)
            .map((entry) => asString(entry))
            .filter((entry): entry is string => Boolean(entry)),
          updatedAt: asString(lastRaw.updatedAt ?? lastRaw.updated_at),
        }
      : null,
  };
}

async function readCounterstrikeStatusSnapshot(): Promise<CounterstrikeStatusSnapshot | null> {
  try {
    const res = await fetch("/api/ops/counterstrike/status", {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = asRecord(await res.json().catch(() => null));
    if (!payload || payload.ok !== true) return null;
    return normalizeCounterstrikeStatusSnapshot(payload);
  } catch {
    return null;
  }
}

async function waitForCounterstrikeCompletion(runId: string | null): Promise<{
  snapshot: CounterstrikeStatusSnapshot | null;
  timedOut: boolean;
}> {
  const deadline = Date.now() + COUNTERSTRIKE_TIMEOUT_MS;
  let lastSnapshot: CounterstrikeStatusSnapshot | null = null;

  while (Date.now() < deadline) {
    const snapshot = await readCounterstrikeStatusSnapshot();
    if (snapshot) lastSnapshot = snapshot;

    if (snapshot && !snapshot.running) {
      if (!runId || snapshot.last?.runId === runId || snapshot.last) {
        return {
          snapshot,
          timedOut: false,
        };
      }
    }

    await sleep(COUNTERSTRIKE_POLL_MS);
  }

  return {
    snapshot: lastSnapshot,
    timedOut: true,
  };
}

function countTrackedState(summary: TrackedRunsSummary, state: string): number {
  return summary.byState[state] ?? 0;
}

function formatTrackedSummary(summary: TrackedRunsSummary): string {
  const chunks: string[] = [];
  const order = ["succeeded", "running", "queued", "failed", "canceled", "unknown"];
  for (const key of order) {
    const count = countTrackedState(summary, key);
    if (count > 0) chunks.push(`${key}=${count}`);
  }
  if (summary.delayed > 0) chunks.push(`delayed=${summary.delayed}`);
  if (summary.approvalPending > 0) chunks.push(`approvalPending=${summary.approvalPending}`);
  return chunks.length ? chunks.join(", ") : "no tracked runs";
}

async function readTrackedRunsSummary(runIds: string[]): Promise<TrackedRunsSummary | null> {
  if (runIds.length === 0) return null;
  const snapshot = await readQueueSnapshot(140);
  if (!snapshot) return null;

  const runSet = new Set(runIds);
  const rows = asArray(snapshot.items)
    .map((row) => asRecord(row))
    .filter((row): row is JsonRecord => row !== null)
    .filter((row) => {
      const runId = asString(row.runId);
      return Boolean(runId && runSet.has(runId));
    });

  const byState: Record<string, number> = {};
  let delayed = 0;
  let approvalPending = 0;
  const details: string[] = [];

  for (const row of rows) {
    const actionKey = asString(row.actionKey) ?? "action";
    const state = asString(row.state) ?? "unknown";
    byState[state] = (byState[state] ?? 0) + 1;

    const isDelayed = asBoolean(row.delayed) === true;
    const approval = asString(row.approvalStatus);
    if (isDelayed) {
      delayed += 1;
    }
    if (approval === "pending") {
      approvalPending += 1;
    }

    const suffix = [
      isDelayed ? "delayed" : null,
      approval && approval !== "none" ? `approval=${approval}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    details.push(suffix ? `${actionKey}=${state} (${suffix})` : `${actionKey}=${state}`);
  }

  return {
    total: rows.length,
    byState,
    delayed,
    approvalPending,
    details,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function classifyDeferredExecuteError(status: number, rawError: string): string | null {
  const text = rawError.trim().toLowerCase();
  if (!text) return null;

  if (status === 429) {
    if (text.includes("execute rate limit reached")) {
      return "execute rate limit reached";
    }
    if (text.includes("execute cooldown active")) {
      return "execute cooldown active";
    }
    if (text.includes("queue backlog limit reached")) {
      return "queue backlog limit reached";
    }
    if (text.includes("global queue backlog limit reached")) {
      return "global queue backlog limit reached";
    }
  }

  if (text.includes("execute rate limit reached")) return "execute rate limit reached";
  if (text.includes("execute cooldown active")) return "execute cooldown active";
  if (text.includes("queue backlog limit reached")) return "queue backlog limit reached";
  if (text.includes("global queue backlog limit reached")) return "global queue backlog limit reached";

  return null;
}

function parseTsMillis(ts: string | null): number | null {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : null;
}

function pickSnapshotTs(payload: JsonRecord): string | null {
  const fromLast = asString(asRecord(payload.last)?.ts);
  if (fromLast) return fromLast;
  const fromStatus = asString(asRecord(payload.status)?.ts);
  if (fromStatus) return fromStatus;
  return asString(payload.ts);
}

async function readCurrentSnapshotTs(): Promise<string | null> {
  try {
    const res = await fetch("/api/status", {
      method: "GET",
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const payload = asRecord(await res.json().catch(() => null));
    if (!payload) return null;
    return pickSnapshotTs(payload);
  } catch {
    return null;
  }
}

async function waitForSnapshotAdvance(previousSnapshotTs: string): Promise<{ advanced: boolean; current: string | null }> {
  const deadlineMs = Date.now() + 25_000;
  const baselineMs = parseTsMillis(previousSnapshotTs);
  let lastSeen: string | null = null;

  while (Date.now() < deadlineMs) {
    const currentTs = await readCurrentSnapshotTs();
    if (currentTs) lastSeen = currentTs;

    const currentMs = parseTsMillis(currentTs);
    if (baselineMs !== null && currentMs !== null && currentMs > baselineMs) {
      return { advanced: true, current: currentTs };
    }
    if (baselineMs === null && currentTs && currentTs !== previousSnapshotTs) {
      return { advanced: true, current: currentTs };
    }

    await sleep(1200);
  }

  return { advanced: false, current: lastSeen };
}

async function waitForGarbageCleanupCompletion(previousFinishedAt: string | null): Promise<{
  snapshot: FixStatusSnapshot | null;
  timedOut: boolean;
}> {
  const deadlineMs = Date.now() + 30_000;
  let lastSnapshot: FixStatusSnapshot | null = null;
  let sawRunning = false;
  let polls = 0;

  while (Date.now() < deadlineMs) {
    polls += 1;
    const snapshot = await readFixStatusSnapshot();
    if (snapshot) lastSnapshot = snapshot;

    if (snapshot?.diskPressure.runningCleanup) {
      sawRunning = true;
    }

    const finishedAt = snapshot?.diskPressure.lastCleanupFinishedAt ?? null;
    const finishedChanged =
      finishedAt !== null && (previousFinishedAt === null || finishedAt !== previousFinishedAt);

    if (snapshot && !snapshot.diskPressure.runningCleanup && (finishedChanged || (polls >= 3 && !sawRunning))) {
      return {
        snapshot,
        timedOut: false,
      };
    }

    await sleep(1_200);
  }

  return {
    snapshot: lastSnapshot,
    timedOut: true,
  };
}

async function postJson(path: string, body?: Record<string, unknown>) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = asRecord(await res.json().catch(() => null)) ?? {};
  const error =
    (typeof payload.error === "string" && payload.error) ||
    (typeof payload.detail === "string" && payload.detail) ||
    `Request failed (${res.status})`;

  return {
    ok: res.ok,
    status: res.status,
    payload,
    error,
  };
}

function firstAlertDetailLine(detail: string | undefined, pattern: RegExp): string | null {
  if (!detail) return null;
  const line = detail
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => pattern.test(entry));
  return line ?? null;
}

function buildPrimaryCue(input: {
  alertsPreview?: StatusActionPopupProps["alertsPreview"];
  alertsCount: number;
  publicPortsCount: number;
  allowlistedTotal: number | null;
  hasQueueFollowUp: boolean;
}): { tone: "bad" | "warn"; title: string; detail: string } | null {
  const runtimeAlert = (input.alertsPreview ?? []).find((alert) => {
    const signal = `${alert.code ?? ""} ${alert.title} ${alert.detail ?? ""}`.toLowerCase();
    return (
      signal.includes("suspicious_process_ioc") ||
      signal.includes("suspicious process ioc") ||
      signal.includes("cpu_hotspot") ||
      signal.includes("cpu hotspot")
    );
  });
  if (runtimeAlert) {
    const exeLine = firstAlertDetailLine(runtimeAlert.detail, /^exe=/i);
    const procLine = firstAlertDetailLine(runtimeAlert.detail, /^- pid=/i);
    return {
      tone: "bad",
      title: "Primary blocker: a runtime threat signal is still live",
      detail: exeLine
        ? `${exeLine} is still flagged. Fix Now will try Counterstrike first, but the host stays red until the next clean snapshot clears this runtime IOC.`
        : procLine
          ? `${procLine} is still flagged. Fix Now will try Counterstrike first, but the host stays red until the next clean snapshot clears this runtime IOC.`
          : "A suspicious runtime IOC is still active. Fix Now will try Counterstrike first, but the host stays red until the next clean snapshot clears it.",
    };
  }

  const diskAlert = (input.alertsPreview ?? []).find((alert) =>
    isDiskPressureAlert({
      code: alert.code ?? null,
      title: alert.title,
      detail: alert.detail ?? "",
    })
  );
  if (diskAlert) {
    return {
      tone: "bad",
      title: "Primary blocker: root disk is still above the fail line",
      detail: diskAlert.detail
        ? `${diskAlert.detail} Fix Now can run safe reclaim and refresh the report, but the host stays red until fresh headroom lands in the next clean snapshot.`
        : "Root filesystem pressure is still critical. Fix Now can run safe reclaim, but the host stays red until a fresh snapshot confirms the new headroom.",
    };
  }

  if (input.publicPortsCount > 0) {
    return {
      tone: "bad",
      title: "Primary blocker: unexpected public ports still need operator confirmation",
      detail: "VPSSentry will not auto-close exposed ports without an explicit operator decision, so this host stays out of green until the surface is reviewed.",
    };
  }

  if (input.alertsCount > 0) {
    return {
      tone: "warn",
      title: `Primary blocker: ${input.alertsCount} active alert${input.alertsCount === 1 ? "" : "s"} still need review`,
      detail: "The safe playbooks can reduce noise and reconcile obvious drift, but unresolved alerts still keep the host out of green until the next clean snapshot lands.",
    };
  }

  if (input.hasQueueFollowUp) {
    return {
      tone: "warn",
      title: "Primary blocker: remediation queue still has debt",
      detail: "The host may be operationally stable, but the remediation pipeline still has queued or DLQ work that needs operator cleanup.",
    };
  }

  if (input.allowlistedTotal && input.allowlistedTotal > 0) {
    return {
      tone: "warn",
      title: "Primary blocker: allowlisted ports are visible, but other status signals still need a clean scan",
      detail: "The public ports themselves are not the problem here. VPSSentry still needs a clean security snapshot before the host can return to green.",
    };
  }

  return null;
}

export default function StatusActionPopup(props: StatusActionPopupProps) {
  const {
    needsAction,
    headline,
    summary,
    host,
    version,
    snapshotTsIso,
    snapshotLabel,
    scanLabel,
    baselineLabel,
    signedInAs,
    level,
    alertsCount,
    publicPortsCount,
    publicPortsTotalCount,
    expectedPublicPorts,
    alertsPreview,
    queueQueuedCount = 0,
    queueDlqCount = 0,
    stale,
  } = props;
  const router = useRouter();

  const [panel, setPanel] = React.useState<Panel>(null);

  // When panel is open, we default-collapse the meta details
  // (but when panel closes, we restore the "original" look).
  const [metaOpen, setMetaOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (panel) setMetaOpen(false);
    else setMetaOpen(true);
  }, [panel]);

  const [liveSnapshot, setLiveSnapshot] = React.useState<FixStatusSnapshot | null>(null);

  React.useEffect(() => {
    if (panel !== "fix") {
      setLiveSnapshot(null);
      return;
    }

    let cancelled = false;
    void readFixStatusSnapshot().then((snapshot) => {
      if (!cancelled) setLiveSnapshot(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [panel, snapshotTsIso]);

  // If total ports exist but actionable count is 0, we interpret this as "allowlisted"
  const allowlistedTotal = React.useMemo(() => {
    return typeof publicPortsTotalCount === "number" && publicPortsTotalCount > 0 && publicPortsCount === 0
      ? publicPortsTotalCount
      : null;
  }, [publicPortsTotalCount, publicPortsCount]);
  const liveAlertsPreview = React.useMemo(
    () => snapshotToAlertsPreview(liveSnapshot),
    [liveSnapshot]
  );
  const effectiveAlertsPreview =
    panel === "fix" && liveAlertsPreview && liveAlertsPreview.length > 0 ? liveAlertsPreview : alertsPreview;
  const effectiveAlertsCount =
    panel === "fix" && liveSnapshot ? liveSnapshot.alerts.length : alertsCount;
  const effectivePublicPortsCount =
    panel === "fix" && liveSnapshot ? liveSnapshot.unexpectedPublicPortsCount : publicPortsCount;
  const effectiveAllowlistedTotal =
    panel === "fix" && liveSnapshot ? snapshotAllowlistedTotal(liveSnapshot) : allowlistedTotal;
  const effectiveExpectedPublicPorts =
    panel === "fix" && liveSnapshot && liveSnapshot.expectedPublicPorts.length > 0
      ? liveSnapshot.expectedPublicPorts
      : expectedPublicPorts;
  const queueQueued = Math.max(0, Math.trunc(queueQueuedCount));
  const queueDlq = Math.max(0, Math.trunc(queueDlqCount));
  const hasQueueFollowUp = queueQueued > 0 || queueDlq > 0;
  const primaryCue = React.useMemo(
    () =>
      buildPrimaryCue({
        alertsPreview: effectiveAlertsPreview,
        alertsCount: effectiveAlertsCount,
        publicPortsCount: effectivePublicPortsCount,
        allowlistedTotal: effectiveAllowlistedTotal,
        hasQueueFollowUp,
      }),
    [effectiveAlertsPreview, effectiveAlertsCount, effectivePublicPortsCount, effectiveAllowlistedTotal, hasQueueFollowUp]
  );

  // --------- Action list (instant, no typing) ----------
  const actionsNeeded = React.useMemo(() => {
    return buildActionsNeeded({
      alertsCount: effectiveAlertsCount,
      publicPortsCount: effectivePublicPortsCount,
      stale,
      allowlistedTotal: effectiveAllowlistedTotal,
      expectedPublicPorts: effectiveExpectedPublicPorts,
      alertsPreview: effectiveAlertsPreview,
      queueQueuedCount: queueQueued,
      queueDlqCount: queueDlq,
    });
  }, [
    effectiveAlertsCount,
    effectivePublicPortsCount,
    stale,
    effectiveAllowlistedTotal,
    effectiveExpectedPublicPorts,
    effectiveAlertsPreview,
    queueQueued,
    queueDlq,
  ]);

  // --------- AI Explain (typed) ----------
  const explainText = React.useMemo(() => {
    return buildExplainText({
      summary,
      alertsCount: effectiveAlertsCount,
      publicPortsCount: effectivePublicPortsCount,
      stale,
      actionsNeeded,
      allowlistedTotal: effectiveAllowlistedTotal,
      expectedPublicPorts: effectiveExpectedPublicPorts,
      alertsPreview: effectiveAlertsPreview,
    });
  }, [
    summary,
    effectiveAlertsCount,
    effectivePublicPortsCount,
    stale,
    actionsNeeded,
    effectiveAllowlistedTotal,
    effectiveExpectedPublicPorts,
    effectiveAlertsPreview,
  ]);

  const currentFixStepInput = React.useMemo(
    () => ({
      alertsCount: effectiveAlertsCount,
      publicPortsCount: effectivePublicPortsCount,
      stale,
      allowlistedTotal: effectiveAllowlistedTotal,
      alertsPreview: effectiveAlertsPreview,
      queueQueuedCount: queueQueued,
      queueDlqCount: queueDlq,
    }),
    [
      effectiveAlertsCount,
      effectivePublicPortsCount,
      stale,
      effectiveAllowlistedTotal,
      effectiveAlertsPreview,
      queueQueued,
      queueDlq,
    ]
  );

  const typedExplain = useTypewriter(explainText, panel === "explain");

  // --------- Fix Now (step list + progress) ----------
  const [steps, setSteps] = React.useState(() => buildFixSteps(currentFixStepInput));
  const [fixResult, setFixResult] = React.useState<FixResult | null>(null);
  const [fixRunning, setFixRunning] = React.useState(false);
  const reportTriggeredRef = React.useRef(false);

  React.useEffect(() => {
    if (panel !== "fix") return;
    setSteps(buildFixSteps(currentFixStepInput));
    setFixResult(null);
    setFixRunning(false);
    reportTriggeredRef.current = false;
  }, [panel, currentFixStepInput]);

  async function runReportNowStep(): Promise<StepOutcome> {
    const run = await postJson("/api/ops/report-now");
    const triggered = run.payload.triggered === true;
    const emailed = run.payload.emailed === true;
    const statusTs = typeof run.payload.statusTs === "string" ? run.payload.statusTs : null;
    const statusAdvanced = run.payload.statusAdvanced === true;
    const scan = asRecord(run.payload.scan);
    const scanStarted = asBoolean(scan?.started) === true;
    const scanMethod = asString(scan?.method);
    const scanError = asString(scan?.error);
    const warning = typeof run.payload.warning === "string" ? run.payload.warning : null;

    if (run.ok || triggered) {
      reportTriggeredRef.current = true;
      const parts = [
        triggered
          ? "Triggered immediate report generation."
          : "Report endpoint returned success.",
      ];
      if (scanStarted) {
        parts.push(`Started immediate VPS scan (${scanMethod ?? "systemctl start vps-sentry.service"}).`);
      } else if (scanError) {
        parts.push(`Immediate scan start was not confirmed (${scanError}).`);
      }
      if (!statusAdvanced) {
        parts.push("Status timestamp has not advanced yet.");
      }
      if (statusTs) parts.push(`Latest status timestamp: ${statusTs}.`);
      if (emailed) parts.push("Email delivery succeeded.");
      if (warning) parts.push(warning);
      return { ok: true, detail: parts.join(" ") };
    }

    return { ok: false, detail: run.error };
  }

  async function runFixStep(stepId: string): Promise<StepOutcome> {
    if (stepId === "stale") {
      return runReportNowStep();
    }

    if (stepId === "ports-allowlisted") {
      return {
        ok: true,
        detail:
          "No unexpected public ports were detected. Allowlisted ports are informational only.",
      };
    }

    if (stepId === "ports") {
      return {
        ok: true,
        detail:
          "Unexpected public ports require manual confirmation before closure. Auto-fix intentionally avoids auto-closing network ports.",
      };
    }

    if (stepId === "disk-pressure") {
      const beforeSnapshot = await readFixStatusSnapshot();
      const safeBytes = beforeSnapshot?.diskPressure.safeReclaimableBytes ?? 0;
      const reclaimRun = await postJson("/api/ops/garbage/reclaim", {
        profile: "safe",
      });
      if (!reclaimRun.ok) {
        return {
          ok: false,
          detail: `Safe disk reclaim could not start: ${reclaimRun.error}`,
        };
      }

      const finished = await waitForGarbageCleanupCompletion(
        beforeSnapshot?.diskPressure.lastCleanupFinishedAt ?? null
      );
      const latestSnapshot = finished.snapshot ?? (await readFixStatusSnapshot());
      const afterSafeBytes = latestSnapshot?.diskPressure.safeReclaimableBytes ?? 0;
      const diskUsedPercent = latestSnapshot?.diskPressure.usedPercent ?? null;
      const diskFailPercent = latestSnapshot?.diskPressure.failPercent ?? null;
      const projectedUsedPercent =
        latestSnapshot ? projectedSafeDiskUsedPercent(latestSnapshot) : null;
      const detailParts = [
        reclaimRun.payload.detail && typeof reclaimRun.payload.detail === "string"
          ? reclaimRun.payload.detail
          : safeBytes > 0
            ? `Started safe reclaim for ${fmtBytes(safeBytes)} of cataloged headroom.`
            : "Started safe disk reclaim.",
      ];
      if (finished.timedOut) {
        detailParts.push("Cleanup is still finishing; the next snapshot may take another moment to reflect new headroom.");
      }
      if (diskUsedPercent !== null) {
        detailParts.push(`Latest root usage is ${formatPercent(diskUsedPercent)}.`);
      }
      if (
        projectedUsedPercent !== null &&
        diskFailPercent !== null &&
        projectedUsedPercent >= diskFailPercent
      ) {
        detailParts.push(
          `Even after the current safe catalog (${fmtBytes(afterSafeBytes)}), root would still sit above the ${diskFailPercent}% fail line.`
        );
      }

      return {
        ok: true,
        detail: detailParts.join(" "),
      };
    }

    if (stepId === "contain-runtime-ioc") {
      const statusSnap = await readFixStatusSnapshot();
      const playbookId = pickCounterstrikePlaybookId({
        snapshot: statusSnap,
        alertsPreview: effectiveAlertsPreview,
      });
      const playbook = getCounterstrikePlaybook(playbookId) ?? DEFAULT_COUNTERSTRIKE_PLAYBOOK;
      const launch = await postJson("/api/ops/counterstrike/run", {
        playbook: playbook.id,
        mode: "execute",
      });

      let runId: string | null = null;
      let runLabel = playbook.label;

      if (!launch.ok) {
        const existingSnapshot =
          normalizeCounterstrikeStatusSnapshot(asRecord(launch.payload.snapshot)) ??
          normalizeCounterstrikeStatusSnapshot(launch.payload);
        if (launch.status !== 409 || !existingSnapshot?.running) {
          return {
            ok: false,
            detail: `${playbook.label} could not start: ${launch.error}`,
          };
        }

        runId = existingSnapshot.running.runId;
        runLabel =
          existingSnapshot.running.playbookLabel ??
          getCounterstrikePlaybook(existingSnapshot.running.playbook ?? undefined)?.label ??
          runLabel;
      } else {
        const startedSnapshot =
          normalizeCounterstrikeStatusSnapshot(asRecord(launch.payload.snapshot)) ??
          normalizeCounterstrikeStatusSnapshot(launch.payload);
        runId = startedSnapshot?.running?.runId ?? startedSnapshot?.last?.runId ?? null;
        runLabel =
          startedSnapshot?.running?.playbookLabel ??
          startedSnapshot?.last?.playbookLabel ??
          runLabel;
      }

      const finished = await waitForCounterstrikeCompletion(runId);
      const runningSnapshot = finished.snapshot?.running;
      const lastRun = finished.snapshot?.last;

      if (finished.timedOut && runningSnapshot) {
        return {
          ok: false,
          detail: `${runLabel} is still running${runningSnapshot.currentLabel ? ` (${runningSnapshot.currentLabel})` : ""}. Give it another moment, then refresh the Battlefeed.`,
        };
      }

      if (!lastRun) {
        return {
          ok: false,
          detail: `${runLabel} finished, but the final Counterstrike record is not readable yet.`,
        };
      }

      const lastRunLabel =
        lastRun.playbookLabel ??
        getCounterstrikePlaybook(lastRun.playbook ?? undefined)?.label ??
        runLabel;
      const errorSuffix = lastRun.errors.length > 0 ? ` Errors: ${lastRun.errors.slice(0, 2).join(" | ")}` : "";
      const summary = lastRun.summary ?? "Counterstrike finished.";

      if (lastRun.status === "contained") {
        return {
          ok: true,
          detail: `${lastRunLabel}: ${summary}${errorSuffix}`,
        };
      }

      if (lastRun.status === "partial") {
        return {
          ok: false,
          detail: `${lastRunLabel}: ${summary} Manual follow-up is still required.${errorSuffix}`,
        };
      }

      if (lastRun.status === "blocked") {
        return {
          ok: false,
          detail: `${lastRunLabel}: ${summary} The latest snapshot did not offer a safe automatic containment target.${errorSuffix}`,
        };
      }

      return {
        ok: false,
        detail: `${lastRunLabel}: ${summary}${errorSuffix}`,
      };
    }

    if (stepId === "baseline-drift") {
      const statusSnap = await readFixStatusSnapshot();
      const driftAlerts = statusSnap?.alerts.filter((alert) => isBaselineDriftAlert(alert)).length ?? 0;
      if (driftAlerts === 0) {
        return {
          ok: true,
          detail: "The latest snapshot is already clear of baseline drift alerts.",
        };
      }

      const baselineRun = await postJson("/api/ops/baseline-accept");
      if (!baselineRun.ok) {
        return {
          ok: false,
          detail: `Baseline reconcile failed: ${baselineRun.error}`,
        };
      }

      const accepted = baselineRun.payload.accepted === true;
      const statusAdvanced = baselineRun.payload.statusAdvanced === true;
      const statusTs = asString(baselineRun.payload.statusTs);
      const scan = asRecord(baselineRun.payload.scan);
      const scanStarted = asBoolean(scan?.started) === true;
      const scanError = asString(scan?.error);
      const details: string[] = [];
      details.push(
        `Accepted ${driftAlerts} baseline drift alert${driftAlerts === 1 ? "" : "s"} into the host baseline.`
      );
      details.push(accepted ? "Baseline was accepted." : "Baseline acceptance did not confirm success.");
      if (scanStarted) details.push("Immediate VPS scan was started.");
      if (!scanStarted && scanError) details.push(`Immediate scan start was not confirmed (${scanError}).`);
      if (statusAdvanced) details.push("Snapshot timestamp advanced.");
      else details.push("Snapshot timestamp has not advanced yet.");
      if (statusTs) details.push(`Latest status timestamp: ${statusTs}.`);

      return { ok: accepted, detail: details.join(" ") };
    }

    if (stepId === "alerts") {
      const statusSnap = await readFixStatusSnapshot();
      if (statusSnap && statusSnap.alerts.length === 0) {
        return {
          ok: true,
          detail: "The latest snapshot is already clear of active alerts, so no extra alert remediation ran.",
        };
      }

      if (statusSnap) {
        const residualAlerts = statusSnap.alerts.filter(
          (alert) =>
            !isBaselineDriftAlert(alert) && !isDiskPressureAlert(alert) && !isRuntimeThreatAlert(alert)
        );
        if (residualAlerts.length === 0) {
          return {
            ok: true,
            detail: "No extra alert playbooks were needed after handling disk pressure, runtime IOC signals, and baseline drift.",
          };
        }
      }

      if (statusSnap && isBaselineDriftOnlySnapshot(statusSnap)) {
        const baselineRun = await postJson("/api/ops/baseline-accept");
        if (!baselineRun.ok) {
          return {
            ok: false,
            detail: `Baseline reconcile failed: ${baselineRun.error}`,
          };
        }

        const accepted = baselineRun.payload.accepted === true;
        const statusAdvanced = baselineRun.payload.statusAdvanced === true;
        const statusTs = asString(baselineRun.payload.statusTs);
        const scan = asRecord(baselineRun.payload.scan);
        const scanStarted = asBoolean(scan?.started) === true;
        const scanError = asString(scan?.error);
        const details: string[] = [];
        details.push("Drift-only alerts detected; accepted new baseline.");
        details.push(accepted ? "Baseline was accepted." : "Baseline acceptance did not confirm success.");
        if (scanStarted) details.push("Immediate VPS scan was started.");
        if (!scanStarted && scanError) details.push(`Immediate scan start was not confirmed (${scanError}).`);
        if (statusAdvanced) details.push("Snapshot timestamp advanced.");
        else details.push("Snapshot timestamp has not advanced yet.");
        if (statusTs) details.push(`Latest status timestamp: ${statusTs}.`);

        return { ok: accepted, detail: details.join(" ") };
      }

      const hostResolved = await resolveHostIdForName(host);
      if (!hostResolved.hostId) {
        return {
          ok: false,
          detail: hostResolved.note ?? "Unable to resolve host for remediation.",
        };
      }

      const hostId = hostResolved.hostId;
      const planRun = await postJson("/api/remediate", {
        mode: "plan",
        hostId,
      });
      if (!planRun.ok) {
        return {
          ok: false,
          detail: `Could not build remediation plan: ${planRun.error}`,
        };
      }

      const candidateActions = asArray(planRun.payload.actions)
        .map((x) => asRecord(x))
        .filter((x): x is JsonRecord => x !== null)
        .map((x) => toRemediationPlanAction(x))
        .filter((x): x is RemediationPlanAction => x !== null)
        .filter((a) => (a.autoTier === "safe_auto" || a.autoTier === "guarded_auto") && a.risk !== "high")
        .sort((a, b) => safeActionPriorityValue(b) - safeActionPriorityValue(a))
        .slice(0, 3);

      if (candidateActions.length === 0) {
        return {
          ok: false,
          detail:
            "No safe auto-fix playbooks were available for the current alerts. Review alerts manually or adjust remediation policy.",
        };
      }

      let queuedCount = 0;
      const touchedActionIds: string[] = [];
      const touchedRunIds: string[] = [];
      const failures: string[] = [];
      const deferredByPolicy: string[] = [];

      for (const action of candidateActions) {
        const dryRun = await postJson("/api/remediate", {
          mode: "dry-run",
          hostId,
          actionId: action.id,
          confirmPhrase: action.confirmPhrase,
        });
        if (!dryRun.ok) {
          failures.push(`${action.id}: dry-run failed (${dryRun.error})`);
          continue;
        }

        const executeRun = await postJson("/api/remediate", {
          mode: "execute",
          hostId,
          actionId: action.id,
          confirmPhrase: action.confirmPhrase,
        });
        if (!executeRun.ok) {
          const deferredReason = classifyDeferredExecuteError(executeRun.status, executeRun.error);
          if (deferredReason) {
            deferredByPolicy.push(`${action.id}: ${deferredReason}`);
            continue;
          }
          failures.push(`${action.id}: execute failed (${executeRun.error})`);
          continue;
        }

        const queuedFlag = executeRun.payload.queued === true;
        const runState = asString(asRecord(executeRun.payload.run)?.state);
        const accepted =
          queuedFlag || runState === "queued" || runState === "running" || runState === "succeeded";
        if (accepted) {
          queuedCount += 1;
          touchedActionIds.push(action.id);
          const runId = asString(asRecord(executeRun.payload.run)?.id);
          if (runId) touchedRunIds.push(runId);
        }
      }

      if (queuedCount <= 0) {
        if (failures.length === 0 && deferredByPolicy.length > 0) {
          return {
            ok: true,
            detail: `No new execute runs were started this cycle because remediation policy throttled execution (${deferredByPolicy
              .slice(0, 3)
              .join(" | ")}). This is expected operational follow-up; retry after cooldown or queue drain.`,
          };
        }

        const reason = failures.length
          ? failures.slice(0, 3).join(" | ")
          : "No safe actions were queued.";
        return { ok: false, detail: reason };
      }

      const requestedLimit = Math.min(Math.max(queuedCount, 1), 25);

      let processedTotal = 0;
      let requestedSeen = requestedLimit;
      let queueErrorsTotal = 0;
      let trackedSummary: TrackedRunsSummary | null = null;

      for (let attempt = 0; attempt < 8; attempt++) {
        const drainRun = await postJson("/api/ops/remediate-drain", { limit: requestedLimit });
        if (!drainRun.ok) {
          return {
            ok: false,
            detail: `Queued ${queuedCount} action(s) but drain failed: ${drainRun.error}`,
          };
        }

        const drained = asRecord(drainRun.payload.drained) ?? {};
        const processed = asNumber(drained.processed);
        const requested = asNumber(drained.requestedLimit);
        const queueErrors = asArray(drained.errors).length;

        processedTotal += processed ?? 0;
        requestedSeen = requested ?? requestedSeen;
        queueErrorsTotal += queueErrors;

        trackedSummary = await readTrackedRunsSummary(touchedRunIds);
        if (trackedSummary) {
          const pending =
            countTrackedState(trackedSummary, "queued") + countTrackedState(trackedSummary, "running");
          const blocked = trackedSummary.delayed + trackedSummary.approvalPending;
          if (pending === 0 && blocked === 0) break;
        }

        await sleep(900);
      }

      if (!trackedSummary) {
        trackedSummary = await readTrackedRunsSummary(touchedRunIds);
      }

      const failedCount = trackedSummary
        ? countTrackedState(trackedSummary, "failed") + countTrackedState(trackedSummary, "canceled")
        : 0;
      const pendingCount = trackedSummary
        ? countTrackedState(trackedSummary, "queued") + countTrackedState(trackedSummary, "running")
        : 0;
      const blockedCount = trackedSummary ? trackedSummary.delayed + trackedSummary.approvalPending : 0;
      const missingCount = trackedSummary ? Math.max(0, touchedRunIds.length - trackedSummary.total) : touchedRunIds.length;

      const bits: string[] = [];
      bits.push(`Queued ${queuedCount} safe remediation action(s): ${touchedActionIds.join(", ")}.`);
      bits.push(`Processed ${processedTotal}/${requestedSeen} queued remediation run(s).`);
      if (queueErrorsTotal > 0) bits.push(`${queueErrorsTotal} run(s) reported errors; review remediation queue.`);
      if (failures.length > 0) bits.push(`Action failures: ${failures.slice(0, 2).join(" | ")}`);
      if (deferredByPolicy.length > 0) {
        bits.push(`Policy-deferred executes: ${deferredByPolicy.slice(0, 3).join(" | ")}.`);
      }
      if (trackedSummary) bits.push(`Run states: ${formatTrackedSummary(trackedSummary)}.`);
      if (failedCount > 0) bits.push(`${failedCount} remediation run(s) failed or were canceled.`);
      if (pendingCount > 0) bits.push(`${pendingCount} remediation run(s) are still queued/running.`);
      if (blockedCount > 0) bits.push(`${blockedCount} remediation run(s) are delayed or awaiting approval.`);
      if (missingCount > 0) bits.push(`${missingCount} tracked run(s) were not visible in the latest queue snapshot.`);

      if (!trackedSummary) {
        bits.push("Unable to read remediation queue state for tracked runs.");
      }

      const hardFailure =
        queueErrorsTotal > 0 ||
        failures.length > 0 ||
        failedCount > 0 ||
        missingCount > 0 ||
        !trackedSummary;
      const ok = !hardFailure;
      return { ok, detail: bits.join(" ") };
    }

    if (stepId === "queue-followup") {
      const run = await postJson("/api/ops/remediate-hygiene", {
        drainLimit: 50,
        replayLimit: 20,
      });
      if (!run.ok) {
        return {
          ok: false,
          detail: run.error,
        };
      }

      const hadDebt = asBoolean(run.payload.hadDebt) === true;
      const improved = asBoolean(run.payload.improved) === true;
      const cleared = asBoolean(run.payload.cleared) === true;
      const detail =
        asString(run.payload.detail) ??
        "Queue hygiene run completed.";

      if (!hadDebt) {
        return {
          ok: true,
          detail: "No queued remediation backlog or DLQ debt was detected.",
        };
      }

      if (cleared || improved) {
        return {
          ok: true,
          detail,
        };
      }

      const after = asRecord(run.payload.after);
      const afterQueued = asInt(after?.queued);
      const afterDlq = asInt(after?.dlq);
      return {
        ok: false,
        detail: `${detail} Queue still has queued=${afterQueued}, dlq=${afterDlq}; manual follow-up required.`,
      };
    }

    if (stepId === "report") {
      if (reportTriggeredRef.current) {
        return {
          ok: true,
          detail: "Fresh report was already triggered earlier in this auto-fix run.",
        };
      }
      return runReportNowStep();
    }

    return { ok: true, detail: "No action needed for this step." };
  }

  async function runFixNow() {
    if (fixRunning) return;

    setFixResult(null);
    setFixRunning(true);
    reportTriggeredRef.current = false;
    const beforeSnapshot = await readFixStatusSnapshot();
    if (beforeSnapshot) {
      setLiveSnapshot(beforeSnapshot);
    }
    const beforeSnapshotTs = (await readCurrentSnapshotTs()) ?? snapshotTsIso;

    // reset to idle first
    setSteps((prev) => prev.map((s) => ({ ...s, status: "idle", detail: undefined })));

    // Snapshot steps length must be read fresh (React state updates async)
    const localStepInput = beforeSnapshot
      ? {
          alertsCount: beforeSnapshot.alerts.length,
          publicPortsCount: beforeSnapshot.unexpectedPublicPortsCount,
          stale,
          allowlistedTotal: snapshotAllowlistedTotal(beforeSnapshot),
          alertsPreview: snapshotToAlertsPreview(beforeSnapshot),
          queueQueuedCount: queueQueued,
          queueDlqCount: queueDlq,
        }
      : currentFixStepInput;
    const localSteps = buildFixSteps(localStepInput);
    setSteps(localSteps);

    let failed = 0;

    let snapshotAdvanced = false;
    let postRefreshSnapshotTs: string | null = null;
    let afterSnapshot: FixStatusSnapshot | null = null;

    try {
      for (let i = 0; i < localSteps.length; i++) {
        const stepId = localSteps[i]?.id;
        if (!stepId) continue;

        setSteps((prev) =>
          prev.map((s) => (s.id === stepId ? { ...s, status: "running", detail: "Working..." } : s))
        );

        let outcome: StepOutcome;
        try {
          outcome = await runFixStep(stepId);
        } catch (error: unknown) {
          outcome = { ok: false, detail: errorMessage(error) };
        }

        if (!outcome.ok) failed += 1;

        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepId
              ? {
                  ...s,
                  status: outcome.ok ? "success" : "error",
                  detail: outcome.detail,
                }
              : s
          )
        );

        await sleep(140);
      }

      const refreshState = await waitForSnapshotAdvance(beforeSnapshotTs);
      snapshotAdvanced = refreshState.advanced;
      postRefreshSnapshotTs = refreshState.current;

      router.refresh();
      if (!snapshotAdvanced) {
        await sleep(900);
        router.refresh();
      }
      afterSnapshot = await readFixStatusSnapshot();
      if (afterSnapshot) {
        setLiveSnapshot(afterSnapshot);
      }
    } finally {
      setFixRunning(false);
    }

    const resultDetails = buildFixResultDetails({
      beforeSnapshot,
      afterSnapshot,
      snapshotAdvanced,
      postRefreshSnapshotTs,
    });

    if (failed === 0) {
      const blockers = afterSnapshot ? buildSnapshotBlockers(afterSnapshot) : [];
      if (snapshotAdvanced) {
        setFixResult({
          ok: true,
          message:
            blockers.length > 0
              ? `Fix Now ran cleanly, but snapshot ${postRefreshSnapshotTs ?? "refresh"} still shows blockers keeping the host out of green.`
              : `Fix Now finished cleanly. Snapshot ${postRefreshSnapshotTs ?? "update"} should put this host back in green.`,
          details: resultDetails,
        });
      } else {
        setFixResult({
          ok: true,
          message:
            "Fix Now finished, but the next snapshot has not landed yet. The card will turn once fresh status is written.",
          details: resultDetails,
        });
      }
      return;
    }

    setFixResult({
      ok: false,
      message: `Fix Now made progress, but ${failed} step(s) still need manual follow-up.`,
      details: resultDetails,
    });
  }

  const showExpanded = panel !== null;
  const showActionControls = needsAction || hasQueueFollowUp;

  return (
    <div className="vps-status-shell" style={{ position: "relative" }}>
      {/* Inline keyframes (keeps it self-contained) */}
      <style>{css()}</style>

      {/* CLOSE (X) when expanded */}
      {showExpanded ? (
        <button
          type="button"
          aria-label="Close status panel"
          onClick={() => setPanel(null)}
          style={{ ...xBtn(), opacity: fixRunning ? 0.65 : 1, cursor: fixRunning ? "not-allowed" : "pointer" }}
          disabled={fixRunning}
        >
          ×
        </button>
      ) : null}

      {/* TOP LINE: light + Status + tap hint */}
      <div className="vps-status-head">
        <StatusLight level={level} />

        <div style={{ fontWeight: 800 }}>
          Status:{" "}
          <span
            style={{
              fontWeight: 900,
              cursor: needsAction && !fixRunning ? "pointer" : "default",
              textDecoration: needsAction ? "underline" : "none",
              textUnderlineOffset: 3,
            }}
            onClick={() => {
              if (needsAction && !fixRunning) setPanel("actions");
            }}
            role={needsAction ? "button" : undefined}
            aria-label={needsAction ? "Show action needed summary" : undefined}
          >
            {headline}
          </span>

          {needsAction ? (
            <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>(tap)</span>
          ) : hasQueueFollowUp ? (
            <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>(queue follow-up)</span>
          ) : null}
        </div>
      </div>

      {/* BUTTON ROW: AI Explain / Fix Now (only when action needed) */}
      {showActionControls ? (
        <div className="vps-status-actions">
          <button
            type="button"
            onClick={() => setPanel("explain")}
            style={{ ...btn(), cursor: fixRunning ? "not-allowed" : "pointer" }}
            disabled={fixRunning}
          >
            AI Explain
          </button>
          <button
            type="button"
            onClick={() => setPanel("fix")}
            style={{ ...btn(), cursor: fixRunning ? "not-allowed" : "pointer" }}
            disabled={fixRunning}
          >
            Fix Now
          </button>
        </div>
      ) : null}

      {primaryCue ? (
        <div className="vps-primary-cue" data-tone={primaryCue.tone}>
          <div className="vps-primary-cue-kicker">Why It Is Still Not Green</div>
          <div className="vps-primary-cue-title">{primaryCue.title}</div>
          <div className="vps-primary-cue-detail">{primaryCue.detail}</div>
        </div>
      ) : null}

      {/* META ROW (Signed in + caret) */}
      <div className="vps-status-meta">
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          Signed in as <b>{signedInAs}</b>
        </div>

        <button
          type="button"
          onClick={() => setMetaOpen((v) => !v)}
          style={caretBtn()}
          aria-label={metaOpen ? "Collapse host details" : "Expand host details"}
          title={metaOpen ? "Hide host details" : "Show host details"}
        >
          {metaOpen ? "▾" : "▸"}
        </button>
      </div>

      {/* META DETAILS (Host/Snapshot/Baseline) */}
      {metaOpen ? (
        <div className="vps-status-meta-card">
          <div style={{ opacity: 0.85 }}>
            Host: <b>{host}</b> · Version: <b>{version}</b>
          </div>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Snapshot: <b>{snapshotLabel}</b>{" "}
            <span style={{ opacity: 0.85 }}>
              · <b>{scanLabel.includes("Age:") ? scanLabel.split("·").slice(1).join("·").trim() : scanLabel}</b>
            </span>
          </div>

          <div style={{ opacity: 0.85, marginTop: 6 }}>
            Baseline accepted: <b>{baselineLabel}</b>
          </div>
        </div>
      ) : null}

      {/* EXPANDED PANELS */}
      {showExpanded ? (
        <div style={{ marginTop: 12 }}>
          {panel === "actions" ? <ActionsPanel actionsNeeded={actionsNeeded} /> : null}
          {panel === "explain" ? <ExplainPanel typedExplain={typedExplain} /> : null}
          {panel === "fix" ? (
            <FixPanel
              steps={steps}
              fixResult={fixResult}
              running={fixRunning}
              onRun={runFixNow}
              onReset={() => {
                if (fixRunning) return;
                setSteps(buildFixSteps(currentFixStepInput));
                setFixResult(null);
                reportTriggeredRef.current = false;
              }}
            />
          ) : null}

          <div className="vps-panel-footer">
            <button
              type="button"
              onClick={() => setPanel(null)}
              style={{ ...okBtn(), opacity: fixRunning ? 0.65 : 1, cursor: fixRunning ? "not-allowed" : "pointer" }}
              disabled={fixRunning}
            >
              Collapse panel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
