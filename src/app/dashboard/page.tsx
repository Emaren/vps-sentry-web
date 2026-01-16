import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import DashboardActions from "./dashboard-actions";

export const dynamic = "force-dynamic";

type Alert = { title: string; detail?: string };
type Port = {
  proto: string;
  host: string;
  port: number;
  proc: string;
  pid: number;
  public: boolean;
  sig: string;
};

type Status = {
  host: string;
  version: string;
  ts: string;
  baseline_last_accepted_ts?: string;
  alerts_count: number;
  alerts: Alert[];
  public_ports_count: number;
  ports_public: Port[];
  auth?: {
    new_ssh_accepts_count: number;
    ssh_failed_password: number;
    ssh_invalid_user: number;
  };
};

// /api/status returns an envelope like: { ok: true, last: {...}, diff: {...}, ts: "..." }
type StatusEnvelope = {
  ok?: boolean;
  ts?: string;
  last?: Partial<Status> & Record<string, unknown>;
  diff?: unknown;
};

async function getBaseUrlFromHeaders(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3035";
}

async function getStatus(): Promise<Status> {
  const base = await getBaseUrlFromHeaders();
  const res = await fetch(`${base}/api/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);

  const data = (await res.json()) as Status | StatusEnvelope;

  const maybeLast = (data as StatusEnvelope)?.last;
  const raw = (maybeLast ?? (data as Status)) as Partial<Status> & Record<string, unknown>;

  const alerts = Array.isArray(raw.alerts) ? (raw.alerts as Alert[]) : [];
  const portsPublic = Array.isArray(raw.ports_public) ? (raw.ports_public as Port[]) : [];

  const alertsCount =
    typeof raw.alerts_count === "number" ? raw.alerts_count : alerts.length;

  const publicPortsCount =
    typeof raw.public_ports_count === "number" ? raw.public_ports_count : portsPublic.length;

  return {
    host: (raw.host as string) ?? "—",
    version: (raw.version as string) ?? "—",
    ts: (raw.ts as string) ?? (data as StatusEnvelope)?.ts ?? new Date().toISOString(),
    baseline_last_accepted_ts: raw.baseline_last_accepted_ts as string | undefined,
    alerts_count: alertsCount,
    alerts,
    public_ports_count: publicPortsCount,
    ports_public: portsPublic,
    auth: raw.auth as Status["auth"],
  };
}

function fmt(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const s = await getStatus();

  // Build render arrays WITHOUT using .map()
  const alertCards: React.ReactNode[] = [];
  for (let i = 0; i < (s.alerts?.length ?? 0); i++) {
    const a = s.alerts[i];
    alertCards.push(
      <div key={i} style={boxStyle}>
        <div style={{ fontWeight: 700 }}>{a.title}</div>
        {a.detail ? (
          <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: 0.9 }}>{a.detail}</pre>
        ) : null}
      </div>
    );
  }

  const portRows: React.ReactNode[] = [];
  for (let i = 0; i < (s.ports_public?.length ?? 0); i++) {
    const p = s.ports_public[i];
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
    <main style={{ padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>VPS Sentry</h1>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Host: <b>{s.host}</b> · Version: <b>{s.version}</b>
          </div>
          <div style={{ opacity: 0.8, marginTop: 6 }}>
            Last run: <b>{fmt(s.ts)}</b> · Baseline accepted: <b>{fmt(s.baseline_last_accepted_ts)}</b>
          </div>
          <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
            Signed in as <b>{session.user?.email ?? session.user?.name ?? "user"}</b>
          </div>
          <DashboardActions />

        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <StatCard label="Alerts" value={s.alerts_count} />
          <StatCard label="Public Ports" value={s.public_ports_count} />
          <StatCard label="SSH Failed" value={s.auth?.ssh_failed_password ?? 0} />
          <StatCard label="Invalid User" value={s.auth?.ssh_invalid_user ?? 0} />
        </div>
      </div>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Alerts</h2>
        {s.alerts_count === 0 ? (
          <div style={boxStyle}>✅ No alerts.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>{alertCards}</div>
        )}
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Public Listening Ports</h2>
        {s.public_ports_count === 0 ? (
          <div style={boxStyle}>✅ No public listeners detected.</div>
        ) : (
          <div style={boxStyle}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
        )}
      </section>

      <div style={{ marginTop: 18, opacity: 0.65, fontSize: 12 }}>
        Data source: /var/lib/vps-sentry/public/status.json
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ ...boxStyle, minWidth: 140 }}>
      <div style={{ opacity: 0.8, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
};

const thStyle: React.CSSProperties = { padding: "8px 6px" };
const tdStyle: React.CSSProperties = { padding: "10px 6px", verticalAlign: "top" };
