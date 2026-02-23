// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/StatusActionPopup.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { Panel, StatusActionPopupProps } from "./types";
import { buildActionsNeeded, buildExplainText, buildFixSteps, sleep } from "./logic";
import { css, btn, caretBtn, okBtn, xBtn } from "./styles";
import { useTypewriter } from "./hooks/useTypewriter";

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

async function describeTrackedRuns(runIds: string[]): Promise<string | null> {
  if (runIds.length === 0) return null;
  const snapshot = await readQueueSnapshot(100);
  if (!snapshot) return null;

  const runSet = new Set(runIds);
  const rows = asArray(snapshot.items)
    .map((row) => asRecord(row))
    .filter((row): row is JsonRecord => row !== null)
    .filter((row) => {
      const runId = asString(row.runId);
      return Boolean(runId && runSet.has(runId));
    });

  if (rows.length === 0) return null;

  const states = rows.map((row) => {
    const actionKey = asString(row.actionKey) ?? "action";
    const state = asString(row.state) ?? "unknown";
    const delayed = asBoolean(row.delayed) === true;
    const approval = asString(row.approvalStatus);
    const suffix = [
      delayed ? "delayed" : null,
      approval && approval !== "none" ? `approval=${approval}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    return suffix ? `${actionKey}=${state} (${suffix})` : `${actionKey}=${state}`;
  });

  return `Queue state: ${states.join("; ")}.`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
  const deadlineMs = Date.now() + 15_000;
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

  // If total ports exist but actionable count is 0, we interpret this as "allowlisted"
  const allowlistedTotal = React.useMemo(() => {
    return typeof publicPortsTotalCount === "number" && publicPortsTotalCount > 0 && publicPortsCount === 0
      ? publicPortsTotalCount
      : null;
  }, [publicPortsTotalCount, publicPortsCount]);

  // --------- Action list (instant, no typing) ----------
  const actionsNeeded = React.useMemo(() => {
    return buildActionsNeeded({
      alertsCount,
      publicPortsCount,
      stale,
      allowlistedTotal,
      expectedPublicPorts,
    });
  }, [alertsCount, publicPortsCount, stale, allowlistedTotal, expectedPublicPorts]);

  // --------- AI Explain (typed) ----------
  const explainText = React.useMemo(() => {
    return buildExplainText({
      summary,
      alertsCount,
      publicPortsCount,
      stale,
      actionsNeeded,
      allowlistedTotal,
      expectedPublicPorts,
    });
  }, [summary, alertsCount, publicPortsCount, stale, actionsNeeded, allowlistedTotal, expectedPublicPorts]);

  const typedExplain = useTypewriter(explainText, panel === "explain");

  // --------- Fix Now (step list + progress) ----------
  const [steps, setSteps] = React.useState(() =>
    buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal })
  );
  const [fixResult, setFixResult] = React.useState<null | { ok: boolean; message: string }>(null);
  const [fixRunning, setFixRunning] = React.useState(false);
  const reportTriggeredRef = React.useRef(false);

  React.useEffect(() => {
    if (panel !== "fix") return;
    setSteps(buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal }));
    setFixResult(null);
    setFixRunning(false);
    reportTriggeredRef.current = false;
  }, [panel, alertsCount, publicPortsCount, stale, allowlistedTotal]);

  async function runReportNowStep(): Promise<StepOutcome> {
    const run = await postJson("/api/ops/report-now");
    const triggered = run.payload.triggered === true;
    const emailed = run.payload.emailed === true;
    const statusTs = typeof run.payload.statusTs === "string" ? run.payload.statusTs : null;
    const warning = typeof run.payload.warning === "string" ? run.payload.warning : null;

    if (run.ok || triggered) {
      reportTriggeredRef.current = true;
      const parts = [
        triggered
          ? "Triggered immediate report generation."
          : "Report endpoint returned success.",
      ];
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

    if (stepId === "alerts") {
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
        const reason = failures.length
          ? failures.slice(0, 3).join(" | ")
          : "No safe actions were queued.";
        return { ok: false, detail: reason };
      }

      const requestedLimit = Math.min(Math.max(queuedCount, 1), 25);

      let processedTotal = 0;
      let requestedSeen = requestedLimit;
      let queueErrorsTotal = 0;

      for (let attempt = 0; attempt < 4; attempt++) {
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

        if (processedTotal > 0) break;
        await sleep(900);
      }

      const bits: string[] = [];
      bits.push(`Queued ${queuedCount} safe remediation action(s): ${touchedActionIds.join(", ")}.`);
      bits.push(`Processed ${processedTotal}/${requestedSeen} queued remediation run(s).`);
      if (queueErrorsTotal > 0) bits.push(`${queueErrorsTotal} run(s) reported errors; review remediation queue.`);
      if (failures.length > 0) bits.push(`Action failures: ${failures.slice(0, 2).join(" | ")}`);

      if (processedTotal <= 0) {
        const queueState = await describeTrackedRuns(touchedRunIds);
        if (queueState) bits.push(queueState);
        bits.push("Runs are queued but not executed yet. They may be running, delayed for retry, or pending approval.");
      }

      const ok = queueErrorsTotal === 0 && failures.length === 0 && processedTotal > 0;
      return { ok, detail: bits.join(" ") };
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

    // reset to idle first
    setSteps((prev) => prev.map((s) => ({ ...s, status: "idle", detail: undefined })));

    // Snapshot steps length must be read fresh (React state updates async)
    const localSteps = buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal });
    setSteps(localSteps);

    let failed = 0;

    let snapshotAdvanced = false;
    let postRefreshSnapshotTs: string | null = null;

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

      const refreshState = await waitForSnapshotAdvance(snapshotTsIso);
      snapshotAdvanced = refreshState.advanced;
      postRefreshSnapshotTs = refreshState.current;

      router.refresh();
      if (!snapshotAdvanced) {
        await sleep(900);
        router.refresh();
      }
    } finally {
      setFixRunning(false);
    }

    if (failed === 0) {
      if (snapshotAdvanced) {
        setFixResult({
          ok: true,
          message: `Auto-fix completed. Dashboard refreshed with snapshot ${
            postRefreshSnapshotTs ?? "update"
          }.`,
        });
      } else {
        setFixResult({
          ok: true,
          message:
            "Auto-fix completed, but snapshot timestamp has not advanced yet. Status will update once the next snapshot is written.",
        });
      }
      return;
    }

    setFixResult({
      ok: false,
      message: `Auto-fix finished with ${failed} step(s) needing manual follow-up.`,
    });
  }

  const showExpanded = panel !== null;

  return (
    <div style={{ position: "relative" }}>
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
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

          {needsAction ? <span style={{ opacity: 0.65, fontSize: 12, marginLeft: 8 }}>(tap)</span> : null}
        </div>
      </div>

      {/* BUTTON ROW: AI Explain / Fix Now (only when action needed) */}
      {needsAction ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
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

      {/* META ROW (Signed in + caret) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: needsAction ? 10 : 12,
        }}
      >
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
        <div style={{ marginTop: 10 }}>
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
                setSteps(buildFixSteps({ alertsCount, publicPortsCount, stale, allowlistedTotal }));
                setFixResult(null);
                reportTriggeredRef.current = false;
              }}
            />
          ) : null}

          {/* OK button */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
            <button
              type="button"
              onClick={() => setPanel(null)}
              style={{ ...okBtn(), opacity: fixRunning ? 0.65 : 1, cursor: fixRunning ? "not-allowed" : "pointer" }}
              disabled={fixRunning}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
