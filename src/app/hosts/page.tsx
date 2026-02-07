import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/status";
import { classifyHeartbeat, heartbeatLabel, readHeartbeatConfig } from "@/lib/host-heartbeat";

export const dynamic = "force-dynamic";

export default async function HostsPage() {
  const heartbeatConfig = readHeartbeatConfig();
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      hostLimit: true,
      hosts: {
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          enabled: true,
          agentVersion: true,
          lastSeenAt: true,
          updatedAt: true,
          snapshots: {
            orderBy: { ts: "desc" },
            take: 1,
            select: {
              id: true,
              ts: true,
              ok: true,
              alertsCount: true,
              publicPortsCount: true,
            },
          },
          _count: {
            select: {
              snapshots: true,
              breaches: true,
              apiKeys: true,
            },
          },
        },
      },
    },
  });

  if (!user) redirect("/login");

  const hostIds = user.hosts.map((h) => h.id);
  const openBreaches = hostIds.length
    ? await prisma.breach.groupBy({
        by: ["hostId"],
        where: { hostId: { in: hostIds }, state: "open" },
        _count: { _all: true },
      })
    : [];

  const openByHost = new Map<string, number>();
  for (const row of openBreaches) openByHost.set(row.hostId, row._count._all);

  return (
    <main style={{ padding: 16, maxWidth: 1060, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>Hosts</h1>
          <p style={{ opacity: 0.78, marginTop: 10 }}>
            {user.hosts.length} host(s) configured · host limit {user.hostLimit ?? 1}
          </p>
          <p style={{ opacity: 0.62, marginTop: 6, fontSize: 12 }}>
            Heartbeat target every {heartbeatConfig.expectedMinutes}m · stale at{" "}
            {heartbeatConfig.staleAfterMinutes}m · missing at {heartbeatConfig.missingAfterMinutes}m
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Link href="/get-vps-sentry" style={btnStyle(false)}>
            Install guide
          </Link>
          <Link href="/hosts/new" style={btnStyle(false)}>
            Add host
          </Link>
        </div>
      </div>

      {user.hosts.length === 0 ? (
        <div style={emptyStateStyle()}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>No hosts yet</div>
          <div style={{ opacity: 0.85, lineHeight: 1.5 }}>
            Create your first host to generate a token and ingest endpoint.
          </div>
          <div style={{ marginTop: 12 }}>
            <Link href="/hosts/new" style={btnStyle(false)}>
              Create first host
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {user.hosts.map((h) => {
            const latest = h.snapshots[0] ?? null;
            const openCount = openByHost.get(h.id) ?? 0;
            const heartbeat = classifyHeartbeat(h.lastSeenAt, new Date(), heartbeatConfig);
            const heartbeatTone: "ok" | "warn" | "bad" =
              heartbeat.state === "fresh"
                ? "ok"
                : heartbeat.state === "delayed"
                ? "warn"
                : "bad";

            return (
              <div key={h.id} style={cardStyle()}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>{h.name}</div>
                    <div style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}>
                      {h.slug ? `/${h.slug}` : h.id}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "stretch",
                    }}
                  >
                    <Badge tone={h.enabled ? "ok" : "warn"} text={h.enabled ? "Enabled" : "Disabled"} />
                    <Badge tone={heartbeatTone} text={heartbeatLabel(heartbeat)} />
                    <Badge tone={openCount > 0 ? "bad" : "ok"} text={`Open breaches: ${openCount}`} />
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  <Stat label="Latest Snapshot" value={latest ? fmt(String(latest.ts)) : "—"} />
                  <Stat label="Alerts (latest)" value={latest ? String(latest.alertsCount) : "—"} />
                  <Stat label="Unexpected Ports" value={latest ? String(latest.publicPortsCount) : "—"} />
                  <Stat label="Agent version" value={h.agentVersion ?? "—"} />
                  <Stat label="Snapshots total" value={String(h._count.snapshots)} />
                  <Stat label="API keys total" value={String(h._count.apiKeys)} />
                </div>

                <div style={{ marginTop: 12 }}>
                  <Link href={`/hosts/${h.id}`} style={btnStyle(false)}>
                    Open details
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
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

function Badge(props: { tone: "ok" | "warn" | "bad"; text: string }) {
  const tone =
    props.tone === "ok"
      ? { bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.35)", color: "#bbf7d0" }
      : props.tone === "warn"
      ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)", color: "#fcd34d" }
      : { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)", color: "#fecaca" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 40,
        padding: "0 12px",
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {props.text}
    </span>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: disabled ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
    color: "inherit",
    textDecoration: "none",
    fontWeight: 700,
    display: "inline-block",
    opacity: disabled ? 0.6 : 1,
  };
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    background: "rgba(255,255,255,0.02)",
  };
}

function emptyStateStyle(): React.CSSProperties {
  return {
    marginTop: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: "14px 16px",
    background: "rgba(255,255,255,0.02)",
  };
}
