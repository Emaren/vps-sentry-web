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
      const requestedLimit = Math.min(Math.max(alertsCount, 1), 25);
      const run = await postJson("/api/ops/remediate-drain", { limit: requestedLimit });
      if (!run.ok) {
        return { ok: false, detail: run.error };
      }

      const drained = asRecord(run.payload.drained) ?? {};
      const processed = asNumber(drained.processed);
      const requested = asNumber(drained.requestedLimit);
      const queueErrors = asArray(drained.errors).length;

      const bits: string[] = [];
      bits.push(
        `Processed ${processed ?? 0}/${requested ?? requestedLimit} queued remediation run(s).`
      );
      if (queueErrors > 0) bits.push(`${queueErrors} run(s) reported errors; review remediation queue.`);

      if ((processed ?? 0) <= 0 && alertsCount > 0) {
        bits.push("No queued safe remediations were available for the active alerts in this snapshot.");
        return { ok: false, detail: bits.join(" ") };
      }

      return { ok: queueErrors === 0, detail: bits.join(" ") };
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
