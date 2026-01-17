// /var/www/vps-sentry-web/src/app/dashboard/page.tsx
import React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import DashboardActions from "./dashboard-actions";
import { prisma } from "@/lib/prisma";

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

  // Optional future fields (we render if present)
  threat?: {
    suspicious_processes?: unknown[];
    top_cpu?: unknown[];
    outbound_suspicious?: unknown[];
    persistence_hits?: unknown[];
  };
};

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

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) => (typeof val === "bigint" ? val.toString() : val),
      2
    );
  } catch {
    try {
      return String(v);
    } catch {
      return "[unprintable]";
    }
  }
}

async function getStatusEnvelope(): Promise<{
  ok: boolean;
  ts: string;
  last: Status;
  diff: unknown;
  raw: unknown;
}> {
  const base = await getBaseUrlFromHeaders();
  const res = await fetch(`${base}/api/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);

  const data = (await res.json()) as Status | StatusEnvelope;

  const env = data as StatusEnvelope;
  const maybeLast = env?.last;
  const rawLast = (maybeLast ?? (data as Status)) as Partial<Status> & Record<string, unknown>;

  const alerts = Array.isArray(rawLast.alerts) ? (rawLast.alerts as Alert[]) : [];
  const portsPublic = Array.isArray(rawLast.ports_public)
    ? (rawLast.ports_public as Port[])
    : [];

  const alertsCount =
    typeof rawLast.alerts_count === "number" ? rawLast.alerts_count : alerts.length;

  const publicPortsCount =
    typeof rawLast.public_ports_count === "number"
      ? rawLast.public_ports_count
      : portsPublic.length;

  const ts = (rawLast.ts as string) ?? env?.ts ?? new Date().toISOString();

  const last: Status = {
    host: (rawLast.host as string) ?? "—",
    version: (rawLast.version as string) ?? "—",
    ts,
    baseline_last_accepted_ts: rawLast.baseline_last_accepted_ts as string | undefined,
    alerts_count: alertsCount,
    alerts,
    public_ports_count: publicPortsCount,
    ports_public: portsPublic,
    auth: rawLast.auth as Status["auth"],
    threat: rawLast.threat as Status["threat"],
  };

  return {
    ok: Boolean(env?.ok ?? true),
    ts: env?.ts ?? ts,
    last,
    diff: env?.diff,
    raw: data,
  };
}

function fmt(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function fmtAny(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return fmt(v);
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === "bigint") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Date(n).toLocaleString();
  }
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toLocaleString();
  }
  return String(v);
}

function minutesAgo(ts?: string): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  return Math.round(diffMs / 60000);
}

async function getUserBilling(email?: string | null) {
  if (!email) return null;
  try {
    const u = await prisma.user.findUnique({
      where: { email },
      select: {
        plan: true,
        hostLimit: true,
        stripeCustomerId: true,
        subscriptionStatus: true,
        subscriptionId: true,
        currentPeriodEnd: true,
        createdAt: true,
        updatedAt: true,
      } as any,
    });
    return u as any;
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const env = await getStatusEnvelope();
  const s = env.last;

  const email = session.user?.email ?? null;
  const billing = await getUserBilling(email);

  const ageMin = minutesAgo(s.ts);
  const stale = typeof ageMin === "number" ? (ageMin >= 15 ? true : false) : false;

  const needsAction = s.alerts_count > 0 || s.public_ports_count > 0 || stale;

  // Build render arrays WITHOUT using .map()
  const alertCards: React.ReactNode[] = [];
  for (let i = 0; i < (s.alerts?.length ?? 0); i++) {
    const a = s.alerts[i];
    alertCards.push(
      <div key={i} style={boxStyle}>
        <div style={{ fontWeight: 700 }}>{a.title}</div>
        {a.detail ? (
          <pre style={preStyle}>{a.detail}</pre>
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

  // Threat / runtime placeholders (render if present, otherwise say "not reported")
  const threatBlocks: React.ReactNode[] = [];
  {
    const t = s.threat ?? {};
    const entries: Array<[string, unknown]> = [
      ["Suspicious processes", (t as any).suspicious_processes],
      ["Top CPU (new hogs)", (t as any).top_cpu],
      ["Outbound suspicious (pool/stratum)", (t as any).outbound_suspicious],
      ["Persistence hits (user/system)", (t as any).persistence_hits],
    ];

    for (let i = 0; i < entries.length; i++) {
      const label = entries[i][0];
      const value = entries[i][1];

      let body: React.ReactNode = (
        <div style={{ opacity: 0.75 }}>— not reported by agent yet</div>
      );

      if (Array.isArray(value)) {
        if (value.length === 0) {
          body = <div>✅ none</div>;
        } else {
          body = <pre style={preStyle}>{safeJson(value)}</pre>;
        }
      } else if (value !== undefined) {
        body = <pre style={preStyle}>{safeJson(value)}</pre>;
      }

      threatBlocks.push(
        <div key={i} style={boxStyle}>
          <div style={{ fontWeight: 800 }}>{label}</div>
          <div style={{ marginTop: 8 }}>{body}</div>
        </div>
      );
    }
  }

  // Diff rendering (raw for now)
  const diffBlock =
    env.diff !== undefined ? (
      <div style={boxStyle}>
        <div style={{ fontWeight: 800 }}>Changes / Diff (raw)</div>
        <pre style={preStyle}>{safeJson(env.diff)}</pre>
      </div>
    ) : (
      <div style={boxStyle}>
        <div style={{ fontWeight: 800 }}>Changes / Diff</div>
        <div style={{ marginTop: 8, opacity: 0.75 }}>
          — diff not present in /api/status response
        </div>
      </div>
    );

  // Raw payload (helps debugging quickly)
  const rawBlock = (
    <div style={boxStyle}>
      <div style={{ fontWeight: 800 }}>Raw /api/status payload (debug)</div>
      <pre style={preStyle}>{safeJson(env.raw)}</pre>
    </div>
  );

  return (
    <main style={mainStyle}>
      <div style={topRowStyle}>
        <div style={leftColStyle}>
          <h1 style={{ fontSize: 28, margin: 0 }}>VPS Sentry</h1>

          <div style={{ ...boxStyle, marginTop: 12 }}>
            <div style={{ fontWeight: 800 }}>
              Status:{" "}
              <span style={{ fontWeight: 900 }}>
                {needsAction ? "ACTION NEEDED" : "OK"}
              </span>
            </div>
            <div style={{ opacity: 0.85, marginTop: 8 }}>
              Host: <b>{s.host}</b> · Version: <b>{s.version}</b>
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Last run: <b>{fmt(s.ts)}</b>{" "}
              {typeof ageMin === "number" ? (
                <span style={{ opacity: 0.85 }}>
                  · Age: <b>{ageMin}m</b> {stale ? " (stale)" : ""}
                </span>
              ) : null}
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Baseline accepted: <b>{fmt(s.baseline_last_accepted_ts)}</b>
            </div>
            <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
              Signed in as <b>{session.user?.email ?? session.user?.name ?? "user"}</b>
            </div>
          </div>

          {billing ? (
            <div style={{ ...boxStyle, marginTop: 12 }}>
              <div style={{ fontWeight: 800 }}>Account</div>
              <div style={{ opacity: 0.85, marginTop: 8 }}>
                Plan: <b>{billing.plan ?? "—"}</b> · Host limit:{" "}
                <b>{billing.hostLimit ?? "—"}</b>
              </div>
              <div style={{ opacity: 0.85, marginTop: 6 }}>
                Subscription status: <b>{billing.subscriptionStatus ?? "—"}</b>
              </div>
              <div style={{ opacity: 0.85, marginTop: 6 }}>
                Current period end: <b>{fmtAny(billing.currentPeriodEnd)}</b>
              </div>
              <div style={{ opacity: 0.65, marginTop: 6, fontSize: 12 }}>
                Customer: <b>{billing.stripeCustomerId ?? "—"}</b> · Sub ID:{" "}
                <b>{billing.subscriptionId ?? "—"}</b>
              </div>
            </div>
          ) : (
            <div style={{ ...boxStyle, marginTop: 12 }}>
              <div style={{ fontWeight: 800 }}>Account</div>
              <div style={{ marginTop: 8, opacity: 0.75 }}>
                — billing record not found for this user yet
              </div>
            </div>
          )}

          <DashboardActions />
        </div>

        <div style={statsWrapStyle}>
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
            {/* ✅ on mobile: allow horizontal scroll instead of breaking layout */}
            <div style={{ width: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
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
          </div>
        )}
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Threat signals (runtime)</h2>
        <div style={{ display: "grid", gap: 10 }}>{threatBlocks}</div>
        <div style={{ marginTop: 8, opacity: 0.65, fontSize: 12 }}>
          These blocks show “— not reported” until the agent emits them into status.json.
        </div>
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Changes</h2>
        {diffBlock}
      </section>

      <section style={{ marginTop: 22 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>Debug</h2>
        {rawBlock}
      </section>

      <div style={{ marginTop: 18, opacity: 0.65, fontSize: 12 }}>
        Data source: /var/lib/vps-sentry/public/status.json · Envelope ok:{" "}
        <b>{env.ok ? "true" : "false"}</b> · Envelope ts: <b>{fmt(env.ts)}</b>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={statCardStyle}>
      <div style={{ opacity: 0.8, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

/**
 * ✅ “Raw but responsive”:
 * - clamp padding so it breathes on desktop but doesn’t crush mobile
 * - use flex-basis on columns/cards so they wrap cleanly on narrow screens
 * - prevent tables/pre blocks from blowing out width
 */
const mainStyle: React.CSSProperties = {
  padding: "clamp(14px, 4vw, 24px)",
  maxWidth: 980,
  margin: "0 auto",
  width: "100%",
};

const topRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "flex-start",
  width: "100%",
};

const leftColStyle: React.CSSProperties = {
  flex: "1 1 420px",
  minWidth: 280,
  maxWidth: "100%",
};

const statsWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  flex: "1 1 320px",
  minWidth: 260,
  maxWidth: "100%",
};

const boxStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 14,
  background: "rgba(255,255,255,0.03)",
  maxWidth: "100%",
};

const statCardStyle: React.CSSProperties = {
  ...boxStyle,
  flex: "1 1 160px", // ✅ wraps into 2-up/1-up depending on width
  minWidth: 140,
};

const thStyle: React.CSSProperties = { padding: "8px 6px" };
const tdStyle: React.CSSProperties = { padding: "10px 6px", verticalAlign: "top" };

const preStyle: React.CSSProperties = {
  marginTop: 10,
  whiteSpace: "pre-wrap",
  overflowX: "auto",
  WebkitOverflowScrolling: "touch",
  opacity: 0.9,
  maxWidth: "100%",
};
