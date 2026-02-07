"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CopyCodeBlock from "@/app/get-vps-sentry/CopyCodeBlock";
import type { RemediationAction } from "@/lib/remediate/actions";

type ApiResponse = {
  ok: boolean;
  error?: string;
  expected?: string;
  run?: {
    id: string;
    state: string;
    output?: string | null;
    error?: string | null;
  };
};

export default function RemediationConsole(props: {
  hostId: string;
  actions: RemediationAction[];
}) {
  const router = useRouter();
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [lastOutputByAction, setLastOutputByAction] = useState<Record<string, string>>({});

  const canExecute = useMemo(() => {
    if (!confirmingActionId) return false;
    const action = props.actions.find((a) => a.id === confirmingActionId);
    if (!action) return false;
    return confirmText.trim() === action.confirmPhrase;
  }, [confirmText, confirmingActionId, props.actions]);

  async function callRemediate(mode: "dry-run" | "execute", action: RemediationAction, phrase?: string) {
    setBusyActionId(action.id);
    setMessage(null);

    try {
      const res = await fetch("/api/remediate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          hostId: props.hostId,
          actionId: action.id,
          confirmPhrase: phrase,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok) {
        const reason = data.error || `Request failed (${res.status})`;
        const hint = data.expected ? ` Expected: ${data.expected}` : "";
        setMessage(`${mode} failed: ${reason}${hint}`);
        return;
      }

      const output = data.run?.output?.trim();
      if (output) {
        setLastOutputByAction((prev) => ({ ...prev, [action.id]: output }));
      }

      if (!data.ok) {
        const reason = data.error || data.run?.error || "one or more commands failed";
        setMessage(`${mode} finished with failure: ${reason}. Run logged.`);
        router.refresh();
        return;
      }

      setMessage(
        mode === "dry-run"
          ? `Dry run recorded (${data.run?.id ?? "run"}).`
          : `Execution ${data.run?.state ?? "completed"} (${data.run?.id ?? "run"}).`
      );

      if (mode === "execute") {
        setConfirmingActionId(null);
        setConfirmText("");
      }

      router.refresh();
    } catch (err: unknown) {
      setMessage(`${mode} failed: ${String(err)}`);
    } finally {
      setBusyActionId(null);
    }
  }

  if (!props.actions.length) {
    return <div style={{ marginTop: 10, opacity: 0.7 }}>No response actions suggested for recent signals.</div>;
  }

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      {props.actions.map((a) => {
        const isBusy = busyActionId === a.id;
        const isConfirming = confirmingActionId === a.id;

        return (
          <div
            key={a.id}
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 10,
              padding: "10px 12px",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>{a.title}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={pillStyle("priority")}>{a.priority}</span>
                <span style={pillStyle("risk")}>risk:{a.risk}</span>
              </div>
            </div>

            <div style={{ marginTop: 8, opacity: 0.9 }}>{a.why}</div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.72 }}>
              Triggered by: {a.sourceCodes.join(", ")}
            </div>

            <div style={{ marginTop: 10 }}>
              <CopyCodeBlock text={a.commands.join("\n")} />
            </div>

            {a.rollbackNotes?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                Rollback notes: {a.rollbackNotes.join(" ")}
              </div>
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
              <button
                type="button"
                onClick={() => callRemediate("dry-run", a)}
                disabled={isBusy}
                style={buttonStyle()}
              >
                {isBusy ? "Working..." : "Dry run"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingActionId(isConfirming ? null : a.id);
                  setConfirmText("");
                }}
                disabled={isBusy}
                style={buttonStyle("warn")}
              >
                Execute
              </button>
            </div>

            {isConfirming ? (
              <div
                style={{
                  marginTop: 10,
                  border: "1px solid rgba(245,158,11,0.30)",
                  background: "rgba(245,158,11,0.08)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.88 }}>
                  Type <code>{a.confirmPhrase}</code> to execute this action.
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.currentTarget.value)}
                    placeholder={a.confirmPhrase}
                    style={{
                      minWidth: 260,
                      padding: "9px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "rgba(0,0,0,0.24)",
                      color: "inherit",
                    }}
                  />
                  <button
                    type="button"
                    disabled={!canExecute || isBusy}
                    onClick={() => callRemediate("execute", a, confirmText.trim())}
                    style={buttonStyle("warn")}
                  >
                    {isBusy ? "Executing..." : "Confirm Execute"}
                  </button>
                </div>
              </div>
            ) : null}

            {lastOutputByAction[a.id] ? (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>Last run output</summary>
                <pre
                  style={{
                    marginTop: 8,
                    whiteSpace: "pre-wrap",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: "rgba(0,0,0,0.18)",
                  }}
                >
                  {lastOutputByAction[a.id]}
                </pre>
              </details>
            ) : null}
          </div>
        );
      })}

      {message ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            background: "rgba(255,255,255,0.05)",
            padding: "10px 12px",
            fontSize: 13,
            opacity: 0.92,
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

function buttonStyle(tone: "normal" | "warn" = "normal"): React.CSSProperties {
  return {
    borderRadius: 10,
    border:
      tone === "warn"
        ? "1px solid rgba(245,158,11,0.35)"
        : "1px solid rgba(255,255,255,0.15)",
    background:
      tone === "warn"
        ? "rgba(245,158,11,0.12)"
        : "rgba(255,255,255,0.06)",
    color: "inherit",
    fontWeight: 700,
    padding: "8px 10px",
    cursor: "pointer",
  };
}

function pillStyle(kind: "priority" | "risk"): React.CSSProperties {
  const tone =
    kind === "priority"
      ? { bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.35)", color: "#bfdbfe" }
      : { bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.35)", color: "#fcd34d" };

  return {
    border: `1px solid ${tone.border}`,
    background: tone.bg,
    color: tone.color,
    borderRadius: 999,
    padding: "3px 8px",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
  };
}
