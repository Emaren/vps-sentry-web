"use client";
// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/PortsSection.tsx

import React from "react";
import type { Status } from "@/lib/status";
import { fmt } from "@/lib/status";
import Box from "../Box";
import { thStyle, tdStyle } from "../../_lib/derive";

type PortItem = {
  proto: string;
  host: string;
  port: number;
  proc: string;
  pid: number;
  public?: boolean;
  sig?: string;
  [k: string]: any;
};

async function copyText(txt: string) {
  try {
    await navigator.clipboard.writeText(txt);
    return true;
  } catch {
    try {
      // eslint-disable-next-line no-alert
      prompt("Copy to clipboard:", txt);
      return true;
    } catch {
      return false;
    }
  }
}

async function post(endpoint: string) {
  const res = await fetch(endpoint, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function fmtPort(p: PortItem) {
  const proto = p?.proto ?? "tcp";
  const host = p?.host ?? "*";
  const port = typeof p?.port === "number" ? p.port : Number(p?.port ?? 0);
  const proc = p?.proc ?? "?";
  const pid = p?.pid ?? "?";
  return `${proto} ${host}:${port} (${proc} pid=${pid})`;
}

function badge(text: string, tone: "ok" | "warn" | "bad") {
  const bg =
    tone === "bad"
      ? "rgba(255,80,80,0.14)"
      : tone === "warn"
      ? "rgba(255,170,60,0.12)"
      : "rgba(120,255,160,0.10)";

  const border =
    tone === "bad"
      ? "1px solid rgba(255,80,80,0.30)"
      : tone === "warn"
      ? "1px solid rgba(255,170,60,0.26)"
      : "1px solid rgba(120,255,160,0.22)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        background: bg,
        border,
        fontSize: 12,
        fontWeight: 900,
        letterSpacing: 0.2,
      }}
    >
      {text}
    </span>
  );
}

function PortsTable(props: { ports: PortItem[] }) {
  const { ports } = props;

  const portRows: React.ReactNode[] = [];
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    portRows.push(
      <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <td style={tdStyle}>{p.proto}</td>
        <td style={tdStyle}>{p.host}</td>
        <td style={tdStyle}>{p.port}</td>
        <td style={tdStyle}>{p.proc}</td>
        <td style={tdStyle}>{p.pid}</td>
      </tr>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 540 }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.8 }}>
            <th style={thStyle}>Proto</th>
            <th style={thStyle}>Host</th>
            <th style={thStyle}>Port</th>
            <th style={thStyle}>Process</th>
            <th style={thStyle}>PID</th>
          </tr>
        </thead>
        <tbody>{portRows}</tbody>
      </table>
    </div>
  );
}

export default function PortsSection(props: { status: Status; snapshotTs: string }) {
  const { status: s, snapshotTs } = props;

  // Raw totals
  const totalCount = typeof (s as any).public_ports_count === "number" ? ((s as any).public_ports_count as number) : 0;
  const portsTotal: PortItem[] = Array.isArray((s as any).ports_public) ? ((s as any).ports_public as PortItem[]) : [];

  // Preferred actionable view (if agent emits it)
  const unexpectedCountMaybe =
    typeof (s as any).unexpected_public_ports_count === "number"
      ? ((s as any).unexpected_public_ports_count as number)
      : null;

  const portsUnexpected: PortItem[] | null = Array.isArray((s as any).ports_public_unexpected)
    ? ((s as any).ports_public_unexpected as PortItem[])
    : null;

  const expectedPublicPorts: string[] | null = Array.isArray((s as any).expected_public_ports)
    ? ((s as any).expected_public_ports as string[]).map((x) => String(x)).filter(Boolean)
    : null;

  const actionableCount = unexpectedCountMaybe ?? totalCount;
  const actionablePorts = portsUnexpected ?? portsTotal;

  const allowlistedCount =
    typeof totalCount === "number" && typeof actionableCount === "number" ? Math.max(0, totalCount - actionableCount) : 0;

  const allowlistedPorts: PortItem[] = (() => {
    if (!portsUnexpected) return [];
    const unexpectedSet = new Set(portsUnexpected.map((p) => `${p.proto}:${p.host}:${p.port}:${p.proc}:${p.pid}`));
    return portsTotal.filter((p) => !unexpectedSet.has(`${p.proto}:${p.host}:${p.port}:${p.proc}:${p.pid}`));
  })();

  const [toast, setToast] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const headlineBadge =
    actionableCount > 0 ? badge(`${actionableCount} UNEXPECTED`, "bad") : totalCount > 0 ? badge("ALLOWLISTED", "ok") : badge("OK", "ok");

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Public Listening Ports</h2>

      <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b>
      </div>

      <Box>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>Summary</div>
            {headlineBadge}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              style={btnSmall()}
              onClick={async () => {
                try {
                  setBusy("report");
                  await post("/api/ops/report-now");
                  setToast("Report triggered. Refresh in a few seconds.");
                } catch (e: any) {
                  setToast(`Failed: ${String(e?.message ?? e)}`);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "report" ? "Working…" : "Send report now"}
            </button>

            <button
              style={btnSmall()}
              onClick={async () => {
                const txt =
                  actionablePorts.length === 0
                    ? "No public listeners."
                    : actionablePorts.map((p) => fmtPort(p)).join("\n");
                const ok = await copyText(txt);
                setToast(ok ? "Ports copied." : "Copy failed.");
              }}
            >
              Copy actionable
            </button>

            <button
              style={btnSmall()}
              onClick={async () => {
                const txt =
                  portsTotal.length === 0 ? "No public listeners." : portsTotal.map((p) => fmtPort(p)).join("\n");
                const ok = await copyText(txt);
                setToast(ok ? "All ports copied." : "Copy failed.");
              }}
            >
              Copy all
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
          Total public listeners: <b>{totalCount}</b> · Unexpected/actionable: <b>{actionableCount}</b> · Allowlisted:{" "}
          <b>{allowlistedCount}</b>
        </div>

        {expectedPublicPorts?.length ? (
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
            Expected allowlist (agent): <b>{expectedPublicPorts.slice(0, 10).join(", ")}</b>
            {expectedPublicPorts.length > 10 ? ` (+${expectedPublicPorts.length - 10} more)` : ""}
          </div>
        ) : (
          <div style={{ marginTop: 6, opacity: 0.6, fontSize: 12 }}>
            Expected allowlist: <i>not reported by agent</i>
          </div>
        )}
      </Box>

      {/* Unexpected/actionable ports */}
      {actionableCount === 0 ? (
        <div style={{ marginTop: 10 }}>
          <Box>✅ No unexpected public listeners detected.</Box>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Box>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ fontWeight: 900 }}>Unexpected (actionable)</div>
              {badge("REVIEW", "bad")}
            </div>

            <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
              These ports are reachable from the internet and are *not* in your allowlist (or the agent couldn’t map allowlist → ports). Treat as suspicious until proven expected.
            </div>

            <div style={{ marginTop: 10 }}>
              <PortsTable ports={actionablePorts} />
            </div>
          </Box>
        </div>
      )}

      {/* Allowlisted ports (optional) */}
      {allowlistedPorts.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <Box>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ fontWeight: 900 }}>Allowlisted (informational)</div>
              {badge("OK", "ok")}
            </div>

            <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
              These are public listeners but considered expected/allowlisted by your configuration.
            </div>

            <div style={{ marginTop: 10 }}>
              <PortsTable ports={allowlistedPorts} />
            </div>
          </Box>
        </div>
      ) : null}

      {toast ? (
        <div style={{ marginTop: 10 }}>
          <Box>
            <div style={{ fontWeight: 900 }}>Notice</div>
            <div style={{ marginTop: 6, opacity: 0.8 }}>{toast}</div>
          </Box>
        </div>
      ) : null}
    </section>
  );
}

function btnSmall(): React.CSSProperties {
  return {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    padding: "8px 10px",
    fontWeight: 900,
    cursor: "pointer",
    color: "inherit",
    fontSize: 12,
  };
}
