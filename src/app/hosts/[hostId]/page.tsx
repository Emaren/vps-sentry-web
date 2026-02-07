import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/status";
import { classifyHeartbeat, heartbeatLabel, readHeartbeatConfig } from "@/lib/host-heartbeat";

export const dynamic = "force-dynamic";

export default async function HostDetailPage(props: { params: Promise<{ hostId: string }> }) {
  const heartbeatConfig = readHeartbeatConfig();
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) redirect("/login");

  const { hostId } = await props.params;
  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: user.id },
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      agentVersion: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      apiKeys: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          prefix: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      snapshots: {
        orderBy: { ts: "desc" },
        take: 20,
        select: {
          id: true,
          ts: true,
          ok: true,
          alertsCount: true,
          publicPortsCount: true,
          createdAt: true,
        },
      },
      breaches: {
        where: { state: "open" },
        orderBy: { openedTs: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          detail: true,
          severity: true,
          openedTs: true,
        },
      },
    },
  });

  if (!host) {
    return (
      <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, margin: 0 }}>Host not found</h1>
        <div style={{ marginTop: 12 }}>
          <Link href="/hosts" style={btnStyle()}>
            Back to hosts
          </Link>
        </div>
      </main>
    );
  }

  const latest = host.snapshots[0] ?? null;
  const heartbeat = classifyHeartbeat(host.lastSeenAt, new Date(), heartbeatConfig);

  return (
    <main style={{ padding: 16, maxWidth: 1060, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>{host.name}</h1>
          <p style={{ opacity: 0.75, marginTop: 8 }}>
            Host ID: <code>{host.id}</code>
          </p>
          {host.slug ? (
            <p style={{ opacity: 0.7, marginTop: 4 }}>
              Slug: <code>{host.slug}</code>
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/hosts/new" style={btnStyle()}>
            Add another host
          </Link>
          <Link href="/hosts" style={btnStyle()}>
            Back to hosts
          </Link>
        </div>
      </div>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Summary</h2>
        <div style={{ marginTop: 8, marginBottom: 4, opacity: 0.75, fontSize: 12 }}>
          Heartbeat target every {heartbeat.expectedMinutes}m · stale at {heartbeat.staleAfterMinutes}m · missing at{" "}
          {heartbeat.missingAfterMinutes}m
        </div>
        <div style={gridStyle()}>
          <Stat label="Enabled" value={host.enabled ? "true" : "false"} />
          <Stat label="Heartbeat" value={heartbeatLabel(heartbeat)} />
          <Stat label="Last seen" value={fmt(host.lastSeenAt ? host.lastSeenAt.toISOString() : undefined)} />
          <Stat label="Agent version" value={host.agentVersion ?? "—"} />
          <Stat label="Created" value={fmt(host.createdAt.toISOString())} />
          <Stat label="Updated" value={fmt(host.updatedAt.toISOString())} />
          <Stat label="Open breaches" value={String(host.breaches.length)} />
          <Stat label="Latest alerts" value={latest ? String(latest.alertsCount) : "—"} />
          <Stat label="Latest unexpected ports" value={latest ? String(latest.publicPortsCount) : "—"} />
        </div>
      </section>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Ingest Endpoint</h2>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          Send snapshots to this endpoint with a host API token in <code>Authorization: Bearer ...</code>.
        </p>
        <pre style={preStyle()}>
          <code>{`POST /api/hosts/${host.id}/status`}</code>
        </pre>
      </section>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>API Keys</h2>
        {host.apiKeys.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No keys found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle()}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.78 }}>
                  <th style={thStyle}>Prefix</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Last used</th>
                  <th style={thStyle}>Revoked</th>
                </tr>
              </thead>
              <tbody>
                {host.apiKeys.map((k) => (
                  <tr key={k.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <td style={tdStyle}>{k.prefix}</td>
                    <td style={tdStyle}>{fmt(k.createdAt.toISOString())}</td>
                    <td style={tdStyle}>{fmt(k.lastUsedAt ? k.lastUsedAt.toISOString() : undefined)}</td>
                    <td style={tdStyle}>{fmt(k.revokedAt ? k.revokedAt.toISOString() : undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Recent Snapshots</h2>
        {host.snapshots.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No snapshots ingested yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle()}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.78 }}>
                  <th style={thStyle}>Timestamp</th>
                  <th style={thStyle}>OK</th>
                  <th style={thStyle}>Alerts</th>
                  <th style={thStyle}>Unexpected Ports</th>
                </tr>
              </thead>
              <tbody>
                {host.snapshots.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <td style={tdStyle}>{fmt(s.ts.toISOString())}</td>
                    <td style={tdStyle}>{s.ok ? "true" : "false"}</td>
                    <td style={tdStyle}>{s.alertsCount}</td>
                    <td style={tdStyle}>{s.publicPortsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Open Breaches</h2>
        {host.breaches.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No open breaches.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {host.breaches.map((b) => (
              <div key={b.id} style={breachCardStyle()}>
                <div style={{ fontWeight: 800 }}>
                  {b.title} <span style={{ opacity: 0.7, fontWeight: 500 }}>({b.severity})</span>
                </div>
                {b.detail ? <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{b.detail}</pre> : null}
                <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>
                  Opened: {fmt(b.openedTs.toISOString())}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 10,
        padding: "8px 10px",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.7 }}>{props.label}</div>
      <div style={{ marginTop: 4, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.05)",
    color: "inherit",
    fontWeight: 700,
    textDecoration: "none",
    display: "inline-block",
  };
}

function sectionStyle(): React.CSSProperties {
  return {
    marginTop: 16,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.02)",
  };
}

function h2Style(): React.CSSProperties {
  return { fontSize: 18, margin: 0 };
}

function gridStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
    marginTop: 10,
  };
}

function preStyle(): React.CSSProperties {
  return {
    marginTop: 8,
    marginBottom: 0,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.03)",
    overflowX: "auto",
  };
}

function tableStyle(): React.CSSProperties {
  return { width: "100%", borderCollapse: "collapse", minWidth: 520 };
}

const thStyle: React.CSSProperties = { padding: "8px 6px" };
const tdStyle: React.CSSProperties = { padding: "10px 6px", verticalAlign: "top" };

function breachCardStyle(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
  };
}
