import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/status";
import {
  classifyHeartbeat,
  heartbeatLabel,
  readHeartbeatConfig,
} from "@/lib/host-heartbeat";
import {
  buildSecurityPostureFromSnapshots,
  type ContainmentStage,
  type ThreatBand,
} from "@/lib/security-posture";
import { readHostFleetPolicyConfig } from "@/lib/remediate/fleet-policy";
import SiteThemeControls from "@/app/_components/SiteThemeControls";
import NoobTip from "@/app/dashboard/_components/NoobTip";
import { requireViewerAccess } from "@/lib/rbac";
import { hasRequiredRole, roleLabel } from "@/lib/rbac-policy";

export const dynamic = "force-dynamic";

type CountMapBundle = {
  openByHost: Map<string, number>;
  incidentByHost: Map<string, number>;
  queueByHost: Map<string, number>;
  queueDlqByHost: Map<string, number>;
  queueApprovalByHost: Map<string, number>;
  activeKeysByHost: Map<string, number>;
  expiringKeysByHost: Map<string, number>;
};

type HostDerived = {
  id: string;
  name: string;
  slug: string | null;
  enabled: boolean;
  agentVersion: string | null;
  latest: {
    ts: Date;
    alertsCount: number;
    publicPortsCount: number;
  } | null;
  posture: ReturnType<typeof buildSecurityPostureFromSnapshots>;
  heartbeat: ReturnType<typeof classifyHeartbeat>;
  fleet: ReturnType<typeof readHostFleetPolicyConfig>;
  counts: {
    snapshots: number;
    apiKeys: number;
    openBreaches: number;
    incidentsActive: number;
    queuePending: number;
    queueDlq: number;
    queueApprovalPending: number;
    keysActive: number;
    keysExpiringSoon: number;
  };
};

export default async function HostsPage() {
  const heartbeatConfig = readHeartbeatConfig();
  const access = await requireViewerAccess();
  if (!access.ok) redirect("/login");
  const canManageHosts = hasRequiredRole(access.identity.role, "admin");

  const user = await prisma.user.findUnique({
    where: { id: access.identity.userId },
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
          metaJson: true,
          agentVersion: true,
          lastSeenAt: true,
          snapshots: {
            orderBy: { ts: "desc" },
            take: 12,
            select: {
              id: true,
              ts: true,
              alertsCount: true,
              publicPortsCount: true,
              statusJson: true,
            },
          },
          _count: {
            select: {
              snapshots: true,
              apiKeys: true,
            },
          },
        },
      },
    },
  });

  if (!user) redirect("/login");

  const now = new Date();
  const hostIds = user.hosts.map((h) => h.id);
  const runtime = await getHostCountMaps(hostIds, now);

  const derivedHosts: HostDerived[] = user.hosts.map((h) => {
    const timelineInput = h.snapshots
      .map((s) => {
        try {
          const status = JSON.parse(s.statusJson);
          if (!status || typeof status !== "object") return null;
          return { id: s.id, ts: s.ts, status: status as Record<string, unknown> };
        } catch {
          return null;
        }
      })
      .filter(
        (x): x is { id: string; ts: Date; status: Record<string, unknown> } => Boolean(x)
      );

    const heartbeat = classifyHeartbeat(h.lastSeenAt, now, heartbeatConfig);
    const posture = buildSecurityPostureFromSnapshots(timelineInput, heartbeat.state, {
      dedupeWindowMinutes: 30,
      now,
    });
    const latest = h.snapshots[0]
      ? {
          ts: h.snapshots[0].ts,
          alertsCount: h.snapshots[0].alertsCount,
          publicPortsCount: h.snapshots[0].publicPortsCount,
        }
      : null;
    const fleet = readHostFleetPolicyConfig(h.metaJson);

    return {
      id: h.id,
      name: h.name,
      slug: h.slug,
      enabled: h.enabled,
      agentVersion: h.agentVersion,
      latest,
      posture,
      heartbeat,
      fleet,
      counts: {
        snapshots: h._count.snapshots,
        apiKeys: h._count.apiKeys,
        openBreaches: runtime.openByHost.get(h.id) ?? 0,
        incidentsActive: runtime.incidentByHost.get(h.id) ?? 0,
        queuePending: runtime.queueByHost.get(h.id) ?? 0,
        queueDlq: runtime.queueDlqByHost.get(h.id) ?? 0,
        queueApprovalPending: runtime.queueApprovalByHost.get(h.id) ?? 0,
        keysActive: runtime.activeKeysByHost.get(h.id) ?? 0,
        keysExpiringSoon: runtime.expiringKeysByHost.get(h.id) ?? 0,
      },
    };
  });

  const summary = derivedHosts.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.enabled) acc.enabled += 1;
      if (item.heartbeat.state === "delayed") acc.delayed += 1;
      if (item.heartbeat.state === "missing") acc.missing += 1;
      if (item.posture.band === "critical" || item.posture.band === "elevated") {
        acc.elevatedThreat += 1;
      }
      if (item.posture.stage === "contain" || item.posture.stage === "lockdown") {
        acc.containmentActive += 1;
      }
      if (item.counts.openBreaches > 0) acc.withBreaches += 1;
      if (item.counts.incidentsActive > 0) acc.withIncidents += 1;
      if (item.counts.queuePending > 0 || item.counts.queueApprovalPending > 0) {
        acc.withQueue += 1;
      }
      if (item.counts.queueDlq > 0) acc.withDlq += 1;
      acc.activeKeys += item.counts.keysActive;
      if (item.counts.keysExpiringSoon > 0) acc.withExpiringKeys += 1;
      return acc;
    },
    {
      total: 0,
      enabled: 0,
      delayed: 0,
      missing: 0,
      elevatedThreat: 0,
      containmentActive: 0,
      withBreaches: 0,
      withIncidents: 0,
      withQueue: 0,
      withDlq: 0,
      activeKeys: 0,
      withExpiringKeys: 0,
    }
  );

  const hostLimit = user.hostLimit ?? 1;
  const capacityPct = hostLimit > 0 ? Math.min(999, (summary.total / hostLimit) * 100) : 0;

  return (
    <main className="dashboard-shell dashboard-main">
      <div className="app-header">
        <div className="app-header-brand">
          <Link href="/" aria-label="VPS Sentry home" className="app-header-logo-link">
            <Image
              src="/vps-sentry-logo.png"
              alt="VPS Sentry logo"
              width={52}
              height={52}
              priority
              className="app-header-logo"
            />
          </Link>
          <div className="app-header-copy">
            <h1 className="app-header-title">Hosts</h1>
            <p className="app-header-subtitle">
              {summary.total} host(s) configured · host limit {hostLimit}
            </p>
            <p className="app-header-meta">
              Heartbeat target every {heartbeatConfig.expectedMinutes}m · stale at{" "}
              {heartbeatConfig.staleAfterMinutes}m · missing at{" "}
              {heartbeatConfig.missingAfterMinutes}m
            </p>
            <p className="app-header-meta">Role: {roleLabel(access.identity.role)}</p>
          </div>
        </div>
        <div className="app-header-actions app-header-actions-with-theme">
          <div className="app-header-actions-row">
            <Link href="/dashboard" className="app-header-btn">
              Dashboard
            </Link>
            <Link href="/billing" className="app-header-btn">
              Billing
            </Link>
            <Link href="/get-vps-sentry" className="app-header-btn">
              Install guide
            </Link>
            {canManageHosts ? (
              <Link href="/hosts/new" className="app-header-btn">
                Add host
              </Link>
            ) : null}
          </div>
          <div className="app-header-actions-theme-row">
            <SiteThemeControls variant="inline" />
          </div>
        </div>
      </div>

      <section style={{ ...cardStyle(), marginTop: 14 }}>
        <div className="dashboard-card-title-row">
          <h2 style={h2Style()}>
            <NoobTip text="Fleet-wide pulse: threat, incidents, remediation queue, key health, and capacity usage.">
              Fleet Mission Control
            </NoobTip>
          </h2>
        </div>

        <div className="dashboard-chip-row" style={{ marginTop: 10 }}>
          <span className="dashboard-chip">capacity {summary.total}/{hostLimit}</span>
          <span className={summary.total >= hostLimit ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
            usage {capacityPct.toFixed(0)}%
          </span>
          <span className={summary.enabled === summary.total ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
            enabled {summary.enabled}
          </span>
        </div>

        <div style={overviewGridStyle()}>
          <FleetStat label="Threat Elevated Hosts" value={String(summary.elevatedThreat)} tone={summary.elevatedThreat > 0 ? "bad" : "ok"} />
          <FleetStat label="Containment Active Hosts" value={String(summary.containmentActive)} tone={summary.containmentActive > 0 ? "warn" : "ok"} />
          <FleetStat label="Hosts With Open Breaches" value={String(summary.withBreaches)} tone={summary.withBreaches > 0 ? "bad" : "ok"} />
          <FleetStat label="Hosts With Active Incidents" value={String(summary.withIncidents)} tone={summary.withIncidents > 0 ? "warn" : "ok"} />
          <FleetStat label="Hosts With Queue Backlog" value={String(summary.withQueue)} tone={summary.withQueue > 0 ? "warn" : "ok"} />
          <FleetStat label="Hosts With DLQ Runs" value={String(summary.withDlq)} tone={summary.withDlq > 0 ? "bad" : "ok"} />
          <FleetStat label="Delayed Heartbeats" value={String(summary.delayed)} tone={summary.delayed > 0 ? "warn" : "ok"} />
          <FleetStat label="Missing Heartbeats" value={String(summary.missing)} tone={summary.missing > 0 ? "bad" : "ok"} />
          <FleetStat label="Active Host Keys (total)" value={String(summary.activeKeys)} tone={summary.activeKeys > 0 ? "ok" : "warn"} />
          <FleetStat label="Hosts With Keys Expiring Soon" value={String(summary.withExpiringKeys)} tone={summary.withExpiringKeys > 0 ? "warn" : "ok"} />
        </div>
      </section>

      {derivedHosts.length === 0 ? (
        <div style={emptyStateStyle()}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>No hosts yet</div>
          <div style={{ color: "var(--dash-muted)", lineHeight: 1.5 }}>
            Create your first host to generate a token and ingest endpoint.
          </div>
          {canManageHosts ? (
            <div style={{ marginTop: 12 }}>
              <Link href="/hosts/new" style={btnStyle(false)}>
                Create first host
              </Link>
            </div>
          ) : (
            <div style={{ marginTop: 12, color: "var(--dash-meta)" }}>
              Read-only role: ask an admin/owner to create hosts.
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {derivedHosts.map((h) => {
            const heartbeatTone: "ok" | "warn" | "bad" =
              h.heartbeat.state === "fresh"
                ? "ok"
                : h.heartbeat.state === "delayed"
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
                    <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
                      {h.slug ? `/${h.slug}` : h.id}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      rowGap: 8,
                      justifyContent: "flex-end",
                      alignItems: "center",
                      minHeight: 40,
                    }}
                  >
                    <Badge
                      tone={toneFromThreatBand(h.posture.band)}
                      text={`Threat ${h.posture.score} (${h.posture.band})`}
                    />
                    <Badge
                      tone={toneFromContainmentStage(h.posture.stage)}
                      text={`Containment: ${containmentStageLabel(h.posture.stage)}`}
                    />
                    <Badge tone={h.enabled ? "ok" : "warn"} text={h.enabled ? "Enabled" : "Disabled"} />
                    <Badge tone={heartbeatTone} text={heartbeatLabel(h.heartbeat)} />
                    <Badge
                      tone={h.counts.openBreaches > 0 ? "bad" : "ok"}
                      text={`Open breaches: ${h.counts.openBreaches}`}
                    />
                    <Badge
                      tone={h.counts.incidentsActive > 0 ? "warn" : "ok"}
                      text={`Incidents: ${h.counts.incidentsActive}`}
                    />
                    <Badge
                      tone={h.counts.queuePending > 0 ? "warn" : "ok"}
                      text={`Queue: ${h.counts.queuePending}`}
                    />
                    {h.counts.queueApprovalPending > 0 ? (
                      <Badge tone="warn" text={`Approvals: ${h.counts.queueApprovalPending}`} />
                    ) : null}
                    {h.counts.queueDlq > 0 ? <Badge tone="bad" text={`DLQ: ${h.counts.queueDlq}`} /> : null}
                    {h.fleet.group ? <Badge tone="warn" text={`Group: ${h.fleet.group}`} /> : null}
                    {h.fleet.rolloutPaused ? <Badge tone="warn" text="Rollout paused" /> : null}
                  </div>
                </div>

                <div style={gridStyle()}>
                  <Stat label="Latest snapshot" value={h.latest ? fmt(String(h.latest.ts)) : "—"} />
                  <Stat label="Alerts (latest)" value={h.latest ? String(h.latest.alertsCount) : "—"} />
                  <Stat
                    label="Unexpected ports (latest)"
                    value={h.latest ? String(h.latest.publicPortsCount) : "—"}
                  />
                  <Stat label="Priority signal" value={h.posture.priorityCodes[0] ?? "—"} />
                  <Stat label="Agent version" value={h.agentVersion ?? "—"} />
                  <Stat label="Tags" value={h.fleet.tags.length ? h.fleet.tags.join(", ") : "—"} />
                  <Stat label="Scopes" value={h.fleet.scopes.length ? h.fleet.scopes.join(", ") : "—"} />
                  <Stat label="Snapshots total" value={String(h.counts.snapshots)} />
                  <Stat label="API keys total" value={String(h.counts.apiKeys)} />
                  <Stat label="Active keys" value={String(h.counts.keysActive)} />
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
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

async function getHostCountMaps(hostIds: string[], now: Date): Promise<CountMapBundle> {
  const empty: CountMapBundle = {
    openByHost: new Map<string, number>(),
    incidentByHost: new Map<string, number>(),
    queueByHost: new Map<string, number>(),
    queueDlqByHost: new Map<string, number>(),
    queueApprovalByHost: new Map<string, number>(),
    activeKeysByHost: new Map<string, number>(),
    expiringKeysByHost: new Map<string, number>(),
  };

  if (hostIds.length === 0) return empty;

  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [
    openBreaches,
    activeIncidents,
    queuePending,
    queueDlq,
    queueApprovals,
    activeKeys,
    expiringKeys,
  ] = await Promise.all([
    prisma.breach.groupBy({
      by: ["hostId"],
      where: { hostId: { in: hostIds }, state: "open" },
      _count: { _all: true },
    }),
    prisma.incidentWorkflowRun.groupBy({
      by: ["hostId"],
      where: {
        hostId: { in: hostIds },
        state: { in: ["open", "acknowledged"] },
      },
      _count: { _all: true },
    }),
    prisma.remediationRun.groupBy({
      by: ["hostId"],
      where: {
        hostId: { in: hostIds },
        state: { in: ["queued", "running"] },
        paramsJson: { contains: "\"mode\":\"execute\"" },
      },
      _count: { _all: true },
    }),
    prisma.remediationRun.groupBy({
      by: ["hostId"],
      where: {
        hostId: { in: hostIds },
        state: "failed",
        paramsJson: { contains: "\"dlq\":true" },
      },
      _count: { _all: true },
    }),
    prisma.remediationRun.groupBy({
      by: ["hostId"],
      where: {
        hostId: { in: hostIds },
        state: "queued",
        AND: [
          { paramsJson: { contains: "\"mode\":\"execute\"" } },
          { paramsJson: { contains: "\"required\":true" } },
          { paramsJson: { contains: "\"status\":\"pending\"" } },
        ],
      },
      _count: { _all: true },
    }),
    prisma.hostApiKey.groupBy({
      by: ["hostId"],
      where: {
        hostId: { in: hostIds },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _count: { _all: true },
    }),
    prisma.hostApiKey.groupBy({
      by: ["hostId"],
      where: {
        hostId: { in: hostIds },
        revokedAt: null,
        expiresAt: { gt: now, lte: soon },
      },
      _count: { _all: true },
    }),
  ]);

  const toMap = (rows: Array<{ hostId: string | null; _count: { _all: number } }>) => {
    const out = new Map<string, number>();
    for (const row of rows) {
      if (!row.hostId) continue;
      out.set(row.hostId, row._count._all);
    }
    return out;
  };

  return {
    openByHost: toMap(openBreaches),
    incidentByHost: toMap(activeIncidents),
    queueByHost: toMap(queuePending),
    queueDlqByHost: toMap(queueDlq),
    queueApprovalByHost: toMap(queueApprovals),
    activeKeysByHost: toMap(activeKeys),
    expiringKeysByHost: toMap(expiringKeys),
  };
}

function FleetStat(props: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const toneColor =
    props.tone === "ok"
      ? "var(--dash-sev-ok-text)"
      : props.tone === "warn"
        ? "var(--dash-sev-high-text)"
        : props.tone === "bad"
          ? "var(--dash-sev-critical-text)"
          : "var(--dash-fg)";

  return (
    <div style={statCardStyle()}>
      <div style={{ fontSize: 11, color: "var(--dash-meta)" }}>{props.label}</div>
      <div style={{ marginTop: 4, fontWeight: 800, color: toneColor, fontSize: 24 }}>
        {props.value}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div style={statCardStyle()}>
      <div style={{ fontSize: 11, color: "var(--dash-meta)" }}>{props.label}</div>
      <div style={{ marginTop: 4, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}

function Badge(props: { tone: "ok" | "warn" | "bad"; text: string }) {
  const tone =
    props.tone === "ok"
      ? {
          bg: "var(--dash-sev-ok-bg, rgba(34,197,94,0.14))",
          border: "var(--dash-sev-ok-border, rgba(34,197,94,0.35))",
          color: "var(--dash-sev-ok-text, #bbf7d0)",
        }
      : props.tone === "warn"
        ? {
            bg: "var(--dash-sev-high-bg, rgba(245,158,11,0.12))",
            border: "var(--dash-sev-high-border, rgba(245,158,11,0.35))",
            color: "var(--dash-sev-high-text, #fcd34d)",
          }
        : {
            bg: "var(--dash-sev-critical-bg, rgba(239,68,68,0.12))",
            border: "var(--dash-sev-critical-border, rgba(239,68,68,0.35))",
            color: "var(--dash-sev-critical-text, #fecaca)",
          };

  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 34,
        padding: "0 11px",
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

function toneFromThreatBand(band: ThreatBand): "ok" | "warn" | "bad" {
  if (band === "critical" || band === "elevated") return "bad";
  if (band === "guarded") return "warn";
  return "ok";
}

function toneFromContainmentStage(stage: ContainmentStage): "ok" | "warn" | "bad" {
  if (stage === "lockdown" || stage === "contain") return "bad";
  if (stage === "watch") return "warn";
  return "ok";
}

function containmentStageLabel(stage: ContainmentStage): string {
  if (stage === "lockdown") return "Lockdown";
  if (stage === "contain") return "Contain";
  if (stage === "watch") return "Watch";
  return "Observe";
}

function h2Style(): React.CSSProperties {
  return { fontSize: 18, margin: 0 };
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background: disabled
      ? "color-mix(in srgb, var(--dash-btn-bg, rgba(255,255,255,0.06)) 75%, transparent 25%)"
      : "var(--dash-btn-bg, rgba(255,255,255,0.06))",
    color: "inherit",
    textDecoration: "none",
    fontWeight: 700,
    display: "inline-block",
    opacity: disabled ? 0.6 : 1,
  };
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    borderRadius: 12,
    padding: 12,
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function emptyStateStyle(): React.CSSProperties {
  return {
    marginTop: 14,
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    borderRadius: 12,
    padding: "14px 16px",
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function statCardStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--dash-soft-border, rgba(255,255,255,0.10))",
    borderRadius: 10,
    padding: "8px 10px",
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function overviewGridStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    marginTop: 10,
  };
}

function gridStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
    marginTop: 12,
  };
}
