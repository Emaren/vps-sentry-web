"use client";

import React from "react";
import { hasRequiredRole, type AppRole } from "@/lib/rbac-policy";
import { boxStyle, subtleText, tinyText } from "@/app/dashboard/_styles";
import { ACTION_DECK, type DeckAbility } from "@/lib/actions/ability-catalog";

type AbilityResult = {
  ranAt: string;
  ok: boolean;
  status: number;
  bodyPreview: string;
};

type StatsResponse = {
  ok: boolean;
  counts?: Record<string, number>;
};

type RowEntry =
  | {
      kind: "single";
      id: string;
      title: string;
      summary: string;
      requiredRole: AppRole;
      ability: DeckAbility;
    }
  | {
      kind: "pair";
      id: string;
      title: string;
      summary: string;
      requiredRole: AppRole;
      zipAbility: DeckAbility;
      tgzAbility: DeckAbility;
    };

const buttonStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
  background: "var(--dash-btn-bg-strong, rgba(255,255,255,0.06))",
  color: "inherit",
  fontWeight: 800,
};

const disabledButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.55,
  cursor: "not-allowed",
};

function getScriptName(ability: DeckAbility): string | null {
  if (!ability.id.startsWith("script-")) return null;
  const script = ability.body?.script;
  return typeof script === "string" ? script : null;
}

function buildRows(): RowEntry[] {
  const rows: RowEntry[] = [];
  const scriptByName = new Map<string, DeckAbility>();
  const used = new Set<string>();

  for (const ability of ACTION_DECK) {
    const script = getScriptName(ability);
    if (!script) {
      rows.push({
        kind: "single",
        id: ability.id,
        title: ability.title,
        summary: ability.summary,
        requiredRole: ability.requiredRole,
        ability,
      });
      continue;
    }
    scriptByName.set(script, ability);
  }

  for (const [script, ability] of scriptByName.entries()) {
    if (used.has(ability.id)) continue;
    if (script.endsWith("-tgz")) continue;

    const tgzScript = `${script}-tgz`;
    const tgzAbility = scriptByName.get(tgzScript);
    if (tgzAbility && !used.has(tgzAbility.id)) {
      used.add(ability.id);
      used.add(tgzAbility.id);
      const title = ability.title.replace(/\s+ZIP$/i, "");
      rows.push({
        kind: "pair",
        id: `pair-${script}`,
        title,
        summary: ability.summary.replace(/\s+as\s+ZIP\+SHA\.\s*$/i, ""),
        requiredRole: ability.requiredRole,
        zipAbility: ability,
        tgzAbility,
      });
      continue;
    }

    used.add(ability.id);
    rows.push({
      kind: "single",
      id: ability.id,
      title: ability.title,
      summary: ability.summary,
      requiredRole: ability.requiredRole,
      ability,
    });
  }

  for (const ability of ACTION_DECK) {
    if (used.has(ability.id)) continue;
    if (!ability.id.startsWith("script-")) continue;
    rows.push({
      kind: "single",
      id: ability.id,
      title: ability.title,
      summary: ability.summary,
      requiredRole: ability.requiredRole,
      ability,
    });
  }

  return rows;
}

const ACTION_ROWS: RowEntry[] = buildRows();

async function parseResponseBody(res: Response): Promise<string> {
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => null);
    if (!data) return "(empty JSON body)";
    return JSON.stringify(data, null, 2);
  }
  return (await res.text().catch(() => "")) || "(empty body)";
}

function previewBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= 2400) return trimmed || "(empty)";
  return `${trimmed.slice(0, 2400)}\n... [truncated]`;
}

function renderResult(result: AbilityResult | undefined) {
  if (!result) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: result.ok ? "var(--site-sev-ok-text)" : "var(--site-sev-critical-text)",
        }}
      >
        {result.ok ? "Last run OK" : "Last run failed"} ({result.status}) at {result.ranAt}
      </div>
      <pre
        style={{
          marginTop: 6,
          marginBottom: 0,
          fontSize: 12,
          maxHeight: 150,
          overflow: "auto",
          background: "var(--site-input-bg, rgba(255,255,255,0.03))",
          border: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
          borderRadius: 8,
          padding: 8,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {result.bodyPreview}
      </pre>
    </div>
  );
}

export default function ActionsConsole(props: { userRole: AppRole; signedInAs: string }) {
  const { userRole, signedInAs } = props;
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<Record<string, AbilityResult>>({});
  const [runCounts, setRunCounts] = React.useState<Record<string, number>>({});

  const sortedRows = React.useMemo(() => {
    const rowScore = (row: RowEntry): number => {
      if (row.kind === "pair") {
        return (runCounts[row.zipAbility.id] ?? 0) + (runCounts[row.tgzAbility.id] ?? 0);
      }
      return runCounts[row.ability.id] ?? 0;
    };
    return [...ACTION_ROWS].sort((a, b) => {
      const diff = rowScore(b) - rowScore(a);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });
  }, [runCounts]);

  const refreshStats = React.useCallback(async () => {
    const res = await fetch("/api/ops/actions/stats", { cache: "no-store" });
    const data: StatsResponse = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !data.ok) return;
    setRunCounts(data.counts ?? {});
  }, []);

  React.useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  async function trackRun(abilityId: string, ok: boolean, status: number) {
    await fetch("/api/ops/actions/track-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ abilityId, ok, status }),
    }).catch(() => undefined);
  }

  async function runAbility(ability: DeckAbility) {
    if (!hasRequiredRole(userRole, ability.requiredRole)) return;

    setBusyId(ability.id);
    let runOk = false;
    let runStatus = 0;
    try {
      const res = await fetch(ability.path, {
        method: ability.method,
        headers:
          ability.method === "POST"
            ? {
                "content-type": "application/json",
              }
            : undefined,
        body: ability.method === "POST" ? JSON.stringify(ability.body ?? {}) : undefined,
      });
      runOk = res.ok;
      runStatus = res.status;
      const rawBody = await parseResponseBody(res);
      setResults((prev) => ({
        ...prev,
        [ability.id]: {
          ranAt: new Date().toLocaleString(),
          ok: res.ok,
          status: res.status,
          bodyPreview: previewBody(rawBody),
        },
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setResults((prev) => ({
        ...prev,
        [ability.id]: {
          ranAt: new Date().toLocaleString(),
          ok: false,
          status: 0,
          bodyPreview: message || "Unknown client error",
        },
      }));
    } finally {
      await trackRun(ability.id, runOk, runStatus);
      setRunCounts((prev) => ({
        ...prev,
        [ability.id]: (prev[ability.id] ?? 0) + 1,
      }));
      setBusyId(null);
    }
  }

  return (
    <section style={{ marginTop: 10 }}>
      <div style={{ ...boxStyle, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Action Deck</div>
        <div style={subtleText}>
          Signed in as <strong>{signedInAs}</strong>. Each action runs a guarded VPS Sentry API ability; this page
          does not execute arbitrary shell commands.
        </div>
        <div style={{ ...tinyText, marginTop: 8 }}>Sorted by most-run first.</div>
      </div>

      <div
        style={{
          ...boxStyle,
          padding: 0,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))" }}>
              <th style={{ textAlign: "left", padding: 12 }}>Ability</th>
              <th style={{ textAlign: "left", padding: 12 }}>Command</th>
              <th style={{ textAlign: "left", padding: 12 }}>Role</th>
              <th style={{ textAlign: "left", padding: 12 }}>Times Run</th>
              <th style={{ textAlign: "left", padding: 12 }}>Run</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              if (row.kind === "pair") {
                const allowed = hasRequiredRole(userRole, row.requiredRole);
                const zipBusy = busyId === row.zipAbility.id;
                const tgzBusy = busyId === row.tgzAbility.id;
                const zipCount = runCounts[row.zipAbility.id] ?? 0;
                const tgzCount = runCounts[row.tgzAbility.id] ?? 0;
                const total = zipCount + tgzCount;

                return (
                  <tr
                    key={row.id}
                    style={{
                      borderTop: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
                      verticalAlign: "top",
                    }}
                  >
                    <td style={{ padding: 12 }}>
                      <div style={{ fontWeight: 800 }}>{row.title}</div>
                      <div style={{ ...tinyText, marginTop: 5 }}>{row.summary} (ZIP + TGZ)</div>
                      {renderResult(results[row.zipAbility.id])}
                      {renderResult(results[row.tgzAbility.id])}
                    </td>
                    <td style={{ padding: 12 }}>
                      <code>POST</code>
                      <div style={{ marginTop: 4 }}>
                        <code>/api/ops/actions/run-script</code>
                      </div>
                      <div style={{ ...tinyText, marginTop: 6 }}>
                        ZIP: <code>{JSON.stringify(row.zipAbility.body)}</code>
                      </div>
                      <div style={{ ...tinyText, marginTop: 4 }}>
                        TGZ: <code>{JSON.stringify(row.tgzAbility.body)}</code>
                      </div>
                    </td>
                    <td style={{ padding: 12 }}>
                      <code>{row.requiredRole}</code>
                    </td>
                    <td style={{ padding: 12 }}>
                      <div style={{ fontWeight: 700 }}>{total}</div>
                      <div style={tinyText}>zip {zipCount} / tgz {tgzCount}</div>
                    </td>
                    <td style={{ padding: 12 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => void runAbility(row.zipAbility)}
                          disabled={!allowed || busyId !== null}
                          style={!allowed || busyId !== null ? disabledButtonStyle : buttonStyle}
                        >
                          {zipBusy ? "ZIP..." : "ZIP"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runAbility(row.tgzAbility)}
                          disabled={!allowed || busyId !== null}
                          style={!allowed || busyId !== null ? disabledButtonStyle : buttonStyle}
                        >
                          {tgzBusy ? "TGZ..." : "TGZ"}
                        </button>
                      </div>
                      {!allowed ? (
                        <div style={{ ...tinyText, marginTop: 6 }}>Needs {row.requiredRole} role.</div>
                      ) : null}
                    </td>
                  </tr>
                );
              }

              const allowed = hasRequiredRole(userRole, row.requiredRole);
              const isBusy = busyId === row.ability.id;
              const result = results[row.ability.id];
              const count = runCounts[row.ability.id] ?? 0;

              return (
                <tr
                  key={row.id}
                  style={{
                    borderTop: "1px solid var(--dash-card-border, rgba(255,255,255,0.10))",
                    verticalAlign: "top",
                  }}
                >
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 800 }}>{row.title}</div>
                    <div style={{ ...tinyText, marginTop: 5 }}>{row.summary}</div>
                    {renderResult(result)}
                  </td>
                  <td style={{ padding: 12 }}>
                    <code>{row.ability.method}</code>
                    <div style={{ marginTop: 4 }}>
                      <code>{row.ability.path}</code>
                    </div>
                    {row.ability.body ? (
                      <pre
                        style={{
                          marginTop: 8,
                          marginBottom: 0,
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {JSON.stringify(row.ability.body)}
                      </pre>
                    ) : null}
                  </td>
                  <td style={{ padding: 12 }}>
                    <code>{row.requiredRole}</code>
                  </td>
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 700 }}>{count}</div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <button
                      type="button"
                      onClick={() => void runAbility(row.ability)}
                      disabled={!allowed || busyId !== null}
                      style={!allowed || busyId !== null ? disabledButtonStyle : buttonStyle}
                    >
                      {isBusy ? "Running..." : "Run"}
                    </button>
                    {!allowed ? (
                      <div style={{ ...tinyText, marginTop: 6 }}>Needs {row.requiredRole} role.</div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
