"use client";
// /var/www/vps-sentry-web/src/app/dashboard/_components/ThreatSignals.tsx

import React from "react";
import Box from "./Box";
import { safeJson } from "@/lib/status";

type AnyObj = Record<string, any>;

function isObj(v: any): v is AnyObj {
  return v && typeof v === "object" && !Array.isArray(v);
}

function asArray(v: any): any[] | null {
  return Array.isArray(v) ? v : null;
}

function pickNum(v: any): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickStr(v: any): string | null {
  return typeof v === "string" && v.trim().length ? v.trim() : null;
}

function fmtCpu(v: any): string | null {
  const n = pickNum(v);
  if (n === null) return null;
  if (n <= 1) return `${Math.round(n * 100)}%`;
  // already percent-ish
  return `${Math.round(n)}%`;
}

function fmtMemBytes(v: any): string | null {
  const n = pickNum(v);
  if (n === null) return null;
  const b = n;
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (b >= gb) return `${(b / gb).toFixed(2)} GB`;
  if (b >= mb) return `${(b / mb).toFixed(2)} MB`;
  if (b >= kb) return `${(b / kb).toFixed(2)} KB`;
  return `${Math.round(b)} B`;
}

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
        opacity: 0.95,
      }}
    >
      {text}
    </span>
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

function renderNotReported() {
  return <div style={{ opacity: 0.75 }}>— not reported by agent yet</div>;
}

function renderNone() {
  return <div>✅ none</div>;
}

/**
 * Try to normalize "suspicious_processes" / "top_cpu" / etc into a readable table-like list.
 * We DO NOT assume a strict schema (agent may evolve).
 */
function normalizeRows(kind: string, arr: any[]): Array<{
  primary: string;
  secondary?: string;
  meta?: string[];
  raw?: any;
}> {
  const rows: Array<{ primary: string; secondary?: string; meta?: string[]; raw?: any }> = [];

  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];

    // string-only entry
    if (typeof x === "string") {
      rows.push({ primary: x.trim() || `item ${i + 1}`, raw: x });
      continue;
    }

    if (!isObj(x)) {
      rows.push({ primary: String(x), raw: x });
      continue;
    }

    // heuristics: common fields
    const pid = pickNum(x.pid) ?? pickNum(x.PID);
    const proc =
      pickStr(x.proc) ||
      pickStr(x.comm) ||
      pickStr(x.exe) ||
      pickStr(x.name) ||
      pickStr(x.process) ||
      pickStr(x.cmd) ||
      pickStr(x.command);

    const cmdline = pickStr(x.cmdline) || pickStr(x.command_line) || pickStr(x.args);
    const user = pickStr(x.user) || pickStr(x.username) || pickStr(x.uid);
    const path = pickStr(x.path) || pickStr(x.exe_path) || pickStr(x.binary);
    const cwd = pickStr(x.cwd);
    const ppid = pickNum(x.ppid);
    const cpu = fmtCpu(x.cpu ?? x.cpu_pct ?? x.pcpu);
    const mem = fmtMemBytes(x.rss_bytes ?? x.rss ?? x.mem_bytes);

    // network-ish fields
    const dst = pickStr(x.dst) || pickStr(x.remote) || pickStr(x.remote_addr) || pickStr(x.ip);
    const port = pickNum(x.port ?? x.remote_port ?? x.dst_port);
    const proto = pickStr(x.proto) || pickStr(x.protocol);
    const domain = pickStr(x.domain) || pickStr(x.host) || pickStr(x.hostname);
    const why = pickStr(x.reason) || pickStr(x.hit) || pickStr(x.match) || pickStr(x.note);

    // persistence-ish fields
    const unit = pickStr(x.unit) || pickStr(x.service);
    const file = pickStr(x.file) || pickStr(x.path) || pickStr(x.filename);
    const kind2 = pickStr(x.kind) || pickStr(x.type);

    // Primary line selection per block type
    let primary = proc || cmdline || path || file || domain || dst || `item ${i + 1}`;
    if (pid !== null && proc) primary = `${proc} (pid=${pid})`;
    if (kind === "Outbound suspicious (pool/stratum)" && (domain || dst)) {
      const target = domain || dst!;
      const pp = port !== null ? `:${port}` : "";
      const pr = proto ? `${proto} ` : "";
      primary = `${pr}${target}${pp}`;
    }
    if (kind.includes("Persistence") && (unit || file)) {
      primary = unit ? `${unit}` : `${file}`;
    }

    const meta: string[] = [];

    if (user) meta.push(`user: ${user}`);
    if (ppid !== null) meta.push(`ppid: ${ppid}`);
    if (cpu) meta.push(`cpu: ${cpu}`);
    if (mem) meta.push(`rss: ${mem}`);
    if (cwd) meta.push(`cwd: ${cwd}`);
    if (path && primary !== path) meta.push(`path: ${path}`);
    if (cmdline && primary !== cmdline && !primary.includes(cmdline)) meta.push(`cmd: ${cmdline}`);
    if (why) meta.push(`why: ${why}`);
    if (kind2 && !kind.includes(kind2)) meta.push(`type: ${kind2}`);

    const secondary =
      pickStr(x.summary) ||
      pickStr(x.detail) ||
      pickStr(x.description) ||
      (meta.length ? meta.join(" · ") : undefined);

    rows.push({ primary, secondary, meta: meta.length ? meta : undefined, raw: x });
  }

  return rows;
}

function RowsList(props: { rows: ReturnType<typeof normalizeRows>; max?: number }) {
  const { rows, max = 12 } = props;
  const top = rows.slice(0, max);
  const more = rows.length - top.length;

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      {top.map((r, idx) => (
        <div
          key={idx}
          style={{
            padding: "10px 10px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ fontWeight: 900, lineHeight: 1.25 }}>{r.primary}</div>
          {r.secondary ? (
            <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12, lineHeight: 1.35 }}>{r.secondary}</div>
          ) : null}
        </div>
      ))}

      {more > 0 ? (
        <div style={{ opacity: 0.7, fontSize: 12 }}>…and {more} more</div>
      ) : null}
    </div>
  );
}

export default function ThreatSignals({ threat }: { threat?: any }) {
  const t = threat ?? {};

  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const tmr = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(tmr);
  }, [toast]);

  const entries: Array<[string, unknown]> = [
    ["Suspicious processes", (t as any).suspicious_processes],
    ["Top CPU (new hogs)", (t as any).top_cpu],
    ["Outbound suspicious (pool/stratum)", (t as any).outbound_suspicious],
    ["Persistence hits (user/system)", (t as any).persistence_hits],
  ];

  const blocks: React.ReactNode[] = [];

  for (let i = 0; i < entries.length; i++) {
    const label = entries[i][0];
    const value = entries[i][1];

    // Determine status badge
    let tone: "ok" | "warn" | "bad" = "ok";
    let badgeText = "OK";

    const arr = asArray(value);
    if (value === undefined) {
      tone = "warn";
      badgeText = "NOT REPORTED";
    } else if (arr) {
      if (arr.length === 0) {
        tone = "ok";
        badgeText = "NONE";
      } else {
        tone = label.includes("Outbound") || label.includes("Persistence") ? "bad" : "warn";
        badgeText = `${arr.length} HIT${arr.length === 1 ? "" : "S"}`;
      }
    } else {
      // object or scalar
      tone = "warn";
      badgeText = "REPORTED";
    }

    let body: React.ReactNode = renderNotReported();

    if (arr) {
      if (arr.length === 0) body = renderNone();
      else {
        const rows = normalizeRows(label, arr);
        body = (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <button
                style={btnSmall()}
                onClick={async () => {
                  const txt = rows.map((r) => `${r.primary}${r.secondary ? `\n${r.secondary}` : ""}`).join("\n\n---\n\n");
                  const ok = await copyText(txt);
                  setToast(ok ? `${label}: copied.` : "Copy failed.");
                }}
              >
                Copy
              </button>
              <details style={{ marginLeft: "auto" }}>
                <summary style={{ cursor: "pointer", fontWeight: 900, opacity: 0.85 }}>Raw JSON</summary>
                <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
                  {safeJson(arr)}
                </pre>
              </details>
            </div>

            <RowsList rows={rows} />
          </>
        );
      }
    } else if (value !== undefined) {
      body = (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button
              style={btnSmall()}
              onClick={async () => {
                const ok = await copyText(safeJson(value));
                setToast(ok ? `${label}: copied.` : "Copy failed.");
              }}
            >
              Copy
            </button>
          </div>

          <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", opacity: 0.9 }}>
            {safeJson(value)}
          </pre>
        </>
      );
    }

    blocks.push(
      <Box key={i}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>{label}</div>
          {badge(badgeText, tone)}
        </div>
        <div style={{ marginTop: 8 }}>{body}</div>
      </Box>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {blocks}

      {toast ? (
        <Box>
          <div style={{ fontWeight: 900 }}>Notice</div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>{toast}</div>
        </Box>
      ) : null}
    </div>
  );
}
