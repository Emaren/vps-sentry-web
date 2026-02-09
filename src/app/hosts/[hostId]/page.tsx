import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/status";
import { classifyHeartbeat, heartbeatLabel, readHeartbeatConfig } from "@/lib/host-heartbeat";
import { buildIncidentTimeline } from "@/lib/incident-signals";
import { buildRemediationPlanFromSnapshots } from "@/lib/remediate";
import { isWithinMinutes, readRemediationPolicy } from "@/lib/remediate/policy";
import { readCommandGuardPolicy } from "@/lib/remediate/guard";
import { resolveHostRemediationPolicy } from "@/lib/remediate/host-policy";
import { readHostFleetPolicyConfig } from "@/lib/remediate/fleet-policy";
import { buildSecurityPostureFromSnapshots, type ContainmentStage, type ThreatBand } from "@/lib/security-posture";
import { buildContainmentKit, renderContainmentKitScript } from "@/lib/remediate/containment-kit";
import CopyCodeBlock from "@/app/get-vps-sentry/CopyCodeBlock";
import SiteThemeControls from "@/app/_components/SiteThemeControls";
import NoobTip from "@/app/dashboard/_components/NoobTip";
import PanelStateBanner from "@/app/dashboard/_components/PanelStateBanner";
import type { DashboardPanelHealth } from "@/app/dashboard/_lib/types";
import { panelEmpty, panelError, panelReady } from "@/app/dashboard/_lib/panel-health";
import { requireViewerAccess } from "@/lib/rbac";
import { hasRequiredRole, roleLabel } from "@/lib/rbac-policy";
import { hostKeyScopeSummary, parseHostKeyScopes } from "@/lib/host-keys";
import RemediationConsole from "./RemediationConsole";

export const dynamic = "force-dynamic";

export default async function HostDetailPage(props: { params: Promise<{ hostId: string }> }) {
  const heartbeatConfig = readHeartbeatConfig();
  const access = await requireViewerAccess();
  if (!access.ok) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: access.identity.userId },
    select: {
      id: true,
      hostLimit: true,
      _count: {
        select: {
          hosts: true,
        },
      },
    },
  });
  if (!user) redirect("/login");
  const canManageHosts = hasRequiredRole(access.identity.role, "admin");
  const canRunRemediation = hasRequiredRole(access.identity.role, "ops");

  const { hostId } = await props.params;
  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: user.id },
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      metaJson: true,
      agentVersion: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      apiKeys: {
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          prefix: true,
          version: true,
          label: true,
          scopeJson: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
          revokedReason: true,
          expiresAt: true,
          rotatedFromKeyId: true,
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
          statusJson: true,
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
      remediationRuns: {
        orderBy: { requestedAt: "desc" },
        take: 15,
        select: {
          id: true,
          state: true,
          requestedAt: true,
          startedAt: true,
          finishedAt: true,
          output: true,
          error: true,
          paramsJson: true,
          action: {
            select: {
              key: true,
              title: true,
            },
          },
          requestedBy: {
            select: {
              email: true,
            },
          },
        },
      },
      incidentRuns: {
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          workflowId: true,
          title: true,
          severity: true,
          state: true,
          assigneeEmail: true,
          ackDueAt: true,
          nextEscalationAt: true,
          escalationCount: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!host) {
    return (
      <main className="dashboard-shell dashboard-main">
        <h1 style={{ fontSize: 28, margin: 0 }}>Host not found</h1>
        <div style={{ marginTop: 12 }}>
          <Link href="/hosts" style={btnStyle()}>
            Back to hosts
          </Link>
        </div>
      </main>
    );
  }

  const now = new Date();
  const keyExpirySoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const keyStaleCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    queueQueuedCount,
    queueRunningCount,
    queueDlqCount,
    queueApprovalPendingCount,
    incidentStateRows,
    incidentAckOverdueCount,
    incidentEscalationDueCount,
    keyActiveCount,
    keyExpiringSoonCount,
    keyStaleCount,
  ] = await Promise.all([
    prisma.remediationRun.count({
      where: {
        hostId: host.id,
        state: "queued",
        paramsJson: { contains: "\"mode\":\"execute\"" },
      },
    }),
    prisma.remediationRun.count({
      where: {
        hostId: host.id,
        state: "running",
        paramsJson: { contains: "\"mode\":\"execute\"" },
      },
    }),
    prisma.remediationRun.count({
      where: {
        hostId: host.id,
        state: "failed",
        paramsJson: { contains: "\"dlq\":true" },
      },
    }),
    prisma.remediationRun.count({
      where: {
        hostId: host.id,
        state: "queued",
        AND: [
          { paramsJson: { contains: "\"mode\":\"execute\"" } },
          { paramsJson: { contains: "\"required\":true" } },
          { paramsJson: { contains: "\"status\":\"pending\"" } },
        ],
      },
    }),
    prisma.incidentWorkflowRun.groupBy({
      by: ["state"],
      where: { hostId: host.id },
      _count: { _all: true },
    }),
    prisma.incidentWorkflowRun.count({
      where: {
        hostId: host.id,
        state: "open",
        ackDueAt: { lte: now },
      },
    }),
    prisma.incidentWorkflowRun.count({
      where: {
        hostId: host.id,
        state: { in: ["open", "acknowledged"] },
        nextEscalationAt: { lte: now },
      },
    }),
    prisma.hostApiKey.count({
      where: {
        hostId: host.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    prisma.hostApiKey.count({
      where: {
        hostId: host.id,
        revokedAt: null,
        expiresAt: { gt: now, lte: keyExpirySoon },
      },
    }),
    prisma.hostApiKey.count({
      where: {
        hostId: host.id,
        revokedAt: null,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          {
            OR: [
              { lastUsedAt: { lt: keyStaleCutoff } },
              { AND: [{ lastUsedAt: null }, { createdAt: { lt: keyStaleCutoff } }] },
            ],
          },
        ],
      },
    }),
  ]);

  const countIncidentState = (state: string) => {
    const row = incidentStateRows.find((x) => x.state === state);
    return row?._count._all ?? 0;
  };
  const incidentOpenCount = countIncidentState("open");
  const incidentAcknowledgedCount = countIncidentState("acknowledged");
  const incidentResolvedCount = countIncidentState("resolved");
  const incidentClosedCount = countIncidentState("closed");
  const incidentActiveCount = incidentOpenCount + incidentAcknowledgedCount;

  const latest = host.snapshots[0] ?? null;
  const heartbeat = classifyHeartbeat(host.lastSeenAt, now, heartbeatConfig);
  const timelineInput = host.snapshots
    .map((s) => {
      try {
        const status = JSON.parse(s.statusJson);
        if (!status || typeof status !== "object") return null;
        return { id: s.id, ts: s.ts, status: status as Record<string, unknown> };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; ts: Date; status: Record<string, unknown> } => Boolean(x));
  const remediationPolicyResolved = resolveHostRemediationPolicy({
    metaJson: host.metaJson,
    globalPolicy: readRemediationPolicy(),
    globalGuardPolicy: readCommandGuardPolicy(),
  });
  const fleetPolicy = readHostFleetPolicyConfig(host.metaJson);
  const remediationPolicy = remediationPolicyResolved.policy;
  const timelineResult = buildIncidentTimeline(timelineInput, {
    dedupeWindowMinutes: remediationPolicy.timelineDedupeWindowMinutes,
  });
  const timeline = timelineResult.timeline.slice(0, 20);
  const remediationPlan = buildRemediationPlanFromSnapshots(timelineInput, {
    dedupeWindowMinutes: remediationPolicy.timelineDedupeWindowMinutes,
  });
  const posture = buildSecurityPostureFromSnapshots(timelineInput, heartbeat.state, {
    dedupeWindowMinutes: remediationPolicy.timelineDedupeWindowMinutes,
  });
  const remediations = remediationPlan.actions.slice(0, 4);
  const containmentKit = buildContainmentKit({
    hostName: host.name,
    hostId: host.id,
    posture,
    actions: remediations,
    context: remediationPlan.context,
  });
  const fullContainmentScript = renderContainmentKitScript(containmentKit);
  const dryRunReadyActionIds = Array.from(
    new Set(
      host.remediationRuns
        .filter(
          (r) =>
            r.state === "succeeded" &&
            r.paramsJson?.includes("\"mode\":\"dry-run\"") &&
            isWithinMinutes(r.requestedAt, remediationPolicy.dryRunMaxAgeMinutes)
        )
        .map((r) => r.action.key)
    )
  );
  const heartbeatTone: "ok" | "warn" | "bad" =
    heartbeat.state === "fresh"
      ? "ok"
      : heartbeat.state === "delayed"
      ? "warn"
      : "bad";
  const threatTone: "ok" | "warn" | "bad" =
    posture.band === "critical" || posture.band === "elevated"
      ? "bad"
      : posture.band === "guarded"
      ? "warn"
      : "ok";
  const containmentTone: "ok" | "warn" | "bad" =
    posture.stage === "lockdown" || posture.stage === "contain"
      ? "bad"
      : posture.stage === "watch"
      ? "warn"
      : "ok";
  const queueBacklog = queueQueuedCount + queueRunningCount;
  const timelineSummary = timelineResult.summary;
  const timelineTopCodes = Object.entries(timelineSummary.byCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const snapshotParseFailures = Math.max(0, host.snapshots.length - timelineInput.length);
  const remediationRunSummary = host.remediationRuns.reduce(
    (acc, run) => {
      if (run.state === "queued") acc.queued += 1;
      else if (run.state === "running") acc.running += 1;
      else if (run.state === "succeeded") acc.succeeded += 1;
      else if (run.state === "failed") acc.failed += 1;
      return acc;
    },
    { queued: 0, running: 0, succeeded: 0, failed: 0 }
  );
  const latestSnapshotAgeMinutes =
    latest ? Math.max(0, Math.round((now.getTime() - latest.ts.getTime()) / 60000)) : null;
  const hostAgeDays = Math.max(
    0,
    Math.round((now.getTime() - host.createdAt.getTime()) / (24 * 60 * 60 * 1000))
  );
  const panelHealth: Record<
    | "summary"
    | "fleetPolicy"
    | "apiKeys"
    | "snapshots"
    | "openBreaches"
    | "timeline"
    | "incidentRuns"
    | "remediationRuns",
    DashboardPanelHealth
  > = {
    summary: panelReady("Host summary connected."),
    fleetPolicy: panelReady("Fleet policy connected."),
    apiKeys:
      host.apiKeys.length > 0
        ? panelReady(`Key ledger connected (${host.apiKeys.length} key records).`)
        : panelEmpty("Key ledger connected; no keys found."),
    snapshots:
      host.snapshots.length > 0
        ? panelReady(`Snapshot ledger connected (${host.snapshots.length} snapshots).`)
        : panelEmpty("Snapshot ledger connected; no snapshots ingested yet."),
    openBreaches:
      host.breaches.length > 0
        ? panelReady(`Breach ledger connected (${host.breaches.length} open breach records).`)
        : panelEmpty("Breach ledger connected; no open breaches."),
    timeline:
      timeline.length > 0
        ? panelReady(`Timeline correlation connected (${timeline.length} events).`)
        : snapshotParseFailures > 0 && host.snapshots.length > 0
        ? panelError(
            `Timeline correlation failed to parse ${snapshotParseFailures} snapshot payload(s).`
          )
        : panelEmpty("Timeline correlation connected; no recent incident signals."),
    incidentRuns:
      host.incidentRuns.length > 0
        ? panelReady(`Incident workflow ledger connected (${host.incidentRuns.length} runs).`)
        : panelEmpty("Incident workflow ledger connected; no runs yet."),
    remediationRuns:
      host.remediationRuns.length > 0
        ? panelReady(`Remediation ledger connected (${host.remediationRuns.length} runs).`)
        : panelEmpty("Remediation ledger connected; no runs yet."),
  };
  const sectionLinks = [
    { href: "#summary", label: "Summary" },
    { href: "#security-command-center", label: "Security" },
    { href: "#incident-timeline", label: "Timeline" },
    { href: "#response-playbook", label: "Playbook" },
    { href: "#incident-workflow", label: "Incidents" },
    { href: "#remediation-runs", label: "Remediation" },
    { href: "#api-keys", label: "Keys" },
    { href: "#snapshots", label: "Snapshots" },
  ];

  return (
    <main className="dashboard-shell dashboard-main">
      <div className="app-header">
        <div className="app-header-brand">
          <Link
            href="/"
            aria-label="VPS Sentry home"
            className="app-header-logo-link"
          >
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
              {user._count.hosts} host(s) configured · host limit {user.hostLimit ?? 1}
            </p>
            <p className="app-header-meta">
              Heartbeat target every {heartbeat.expectedMinutes}m · stale at {heartbeat.staleAfterMinutes}m · missing at{" "}
              {heartbeat.missingAfterMinutes}m
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
            <Link href="/hosts" className="app-header-btn">
              Back to hosts
            </Link>
            <SiteThemeControls variant="inline" />
          </div>
        </div>
      </div>

      <section style={topHostCardStyle()}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{host.name}</div>
            <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
              {host.slug ? `/${host.slug}` : host.id}
            </div>
          </div>
          <div
            className="host-status-badge-row"
            style={{ minHeight: 34 }}
          >
            <span style={statusBadgeStyle(threatTone)}>Threat {posture.score} ({posture.band})</span>
            <span style={statusBadgeStyle(containmentTone)}>
              Containment: {containmentStageLabel(posture.stage)}
            </span>
            <span style={statusBadgeStyle(host.enabled ? "ok" : "warn")}>
              {host.enabled ? "Enabled" : "Disabled"}
            </span>
            <span style={statusBadgeStyle(heartbeatTone)}>{heartbeatLabel(heartbeat)}</span>
            <span style={statusBadgeStyle(host.breaches.length > 0 ? "bad" : "ok")}>
              Open breaches: {host.breaches.length}
            </span>
            <span style={statusBadgeStyle(incidentActiveCount > 0 ? "warn" : "ok")}>
              Incidents: {incidentActiveCount}
            </span>
            <span style={statusBadgeStyle(queueBacklog > 0 ? "warn" : "ok")}>
              Queue: {queueBacklog}
            </span>
            {queueApprovalPendingCount > 0 ? (
              <span style={statusBadgeStyle("warn")}>Approvals: {queueApprovalPendingCount}</span>
            ) : null}
            {queueDlqCount > 0 ? (
              <span style={statusBadgeStyle("bad")}>DLQ: {queueDlqCount}</span>
            ) : null}
            <span style={statusBadgeStyle(keyActiveCount > 0 ? "ok" : "warn")}>
              Active keys: {keyActiveCount}
            </span>
            {keyExpiringSoonCount > 0 ? (
              <span style={statusBadgeStyle("warn")}>Keys expiring: {keyExpiringSoonCount}</span>
            ) : null}
          </div>
        </div>
      </section>

      <section style={sectionStyle()}>
        <SectionHeading
          title="Operator Navigator"
          tip="Quick jump links plus immediate host-health framing so you can orient in one glance."
        />
        <div className="dashboard-chip-row" style={{ marginTop: 10 }}>
          <span className={latestSnapshotAgeMinutes !== null && latestSnapshotAgeMinutes <= heartbeatConfig.expectedMinutes * 2 ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
            latest snapshot age {latestSnapshotAgeMinutes !== null ? `${latestSnapshotAgeMinutes}m` : "—"}
          </span>
          <span className={hostAgeDays >= 30 ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip"}>
            host age {hostAgeDays}d
          </span>
          <span className={timelineSummary.total > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
            timeline signals {timelineSummary.total}
          </span>
          <span className={remediationRunSummary.failed > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
            remediation failures {remediationRunSummary.failed}
          </span>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sectionLinks.map((link) => (
            <a key={link.href} href={link.href} style={{ ...btnStyle(), fontSize: 12, padding: "8px 10px" }}>
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <section style={sectionStyle()}>
        <SectionHeading
          title="Host Mission Control"
          tip="Operator-grade runtime view: incident workflow timers, remediation queue state, and key lifecycle health."
        />

        <div className="dashboard-mission-grid host-mission-grid" style={{ marginTop: 10 }}>
          <div style={subPanelStyle()}>
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>
                <NoobTip text="Assignment + acknowledgement + escalation state for this specific host.">
                  Incident Workflow Engine
                </NoobTip>
              </div>
            </div>
            <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
              <span className={incidentOpenCount > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
                open {incidentOpenCount}
              </span>
              <span
                className={
                  incidentAcknowledgedCount > 0
                    ? "dashboard-chip dashboard-chip-warn"
                    : "dashboard-chip dashboard-chip-ok"
                }
              >
                ack {incidentAcknowledgedCount}
              </span>
              <span
                className={
                  incidentAckOverdueCount > 0
                    ? "dashboard-chip dashboard-chip-bad"
                    : "dashboard-chip dashboard-chip-ok"
                }
              >
                ack overdue {incidentAckOverdueCount}
              </span>
              <span
                className={
                  incidentEscalationDueCount > 0
                    ? "dashboard-chip dashboard-chip-warn"
                    : "dashboard-chip dashboard-chip-ok"
                }
              >
                escalation due {incidentEscalationDueCount}
              </span>
            </div>
            <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
              resolved: <b>{incidentResolvedCount}</b> · closed: <b>{incidentClosedCount}</b>
            </div>
          </div>

          <div style={subPanelStyle()}>
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>
                <NoobTip text="Execution backlog, pending approvals, and DLQ risk for automated actions on this host.">
                  Remediation Queue Runtime
                </NoobTip>
              </div>
            </div>
            <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
              <span className={queueQueuedCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
                queued {queueQueuedCount}
              </span>
              <span className={queueRunningCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
                running {queueRunningCount}
              </span>
              <span
                className={
                  queueApprovalPendingCount > 0
                    ? "dashboard-chip dashboard-chip-warn"
                    : "dashboard-chip dashboard-chip-ok"
                }
              >
                approvals {queueApprovalPendingCount}
              </span>
              <span className={queueDlqCount > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
                dlq {queueDlqCount}
              </span>
            </div>
            <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
              Dry-run freshness gate: <b>{remediationPolicy.dryRunMaxAgeMinutes}m</b> · queue cap:{" "}
              <b>{remediationPolicy.maxQueuePerHost}</b>
            </div>
          </div>

          <div style={subPanelStyle()}>
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>
                <NoobTip text="Active, expiring, and stale keys for this host's API ingest auth surface.">
                  Key Lifecycle
                </NoobTip>
              </div>
            </div>
            <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
              <span className={keyActiveCount > 0 ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
                active {keyActiveCount}
              </span>
              <span
                className={
                  keyExpiringSoonCount > 0
                    ? "dashboard-chip dashboard-chip-warn"
                    : "dashboard-chip dashboard-chip-ok"
                }
              >
                expiring soon {keyExpiringSoonCount}
              </span>
              <span className={keyStaleCount > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
                stale {keyStaleCount}
              </span>
            </div>
            <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
              total keys tracked: <b>{host.apiKeys.length}</b> (latest table window)
            </div>
            <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
              rotation pressure: <b>{keyExpiringSoonCount}</b> expiring soon · <b>{keyStaleCount}</b>{" "}
              stale
            </div>
          </div>

          <div style={subPanelStyle()}>
            <div className="dashboard-card-title-row">
              <div style={{ fontWeight: 800 }}>
                <NoobTip text="Severity distribution from deduped timeline plus remediation run outcomes.">
                  Signal + Run Mix
                </NoobTip>
              </div>
            </div>
            <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
              <span className={timelineSummary.bySeverity.critical > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
                critical {timelineSummary.bySeverity.critical}
              </span>
              <span className={timelineSummary.bySeverity.high > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
                high {timelineSummary.bySeverity.high}
              </span>
              <span className="dashboard-chip">medium {timelineSummary.bySeverity.medium}</span>
              <span className="dashboard-chip">low/info {timelineSummary.bySeverity.low + timelineSummary.bySeverity.info}</span>
            </div>
            <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
              <span className={remediationRunSummary.succeeded > 0 ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip"}>
                succeeded {remediationRunSummary.succeeded}
              </span>
              <span className={remediationRunSummary.running > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip"}>
                running {remediationRunSummary.running}
              </span>
              <span className={remediationRunSummary.queued > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip"}>
                queued {remediationRunSummary.queued}
              </span>
              <span className={remediationRunSummary.failed > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
                failed {remediationRunSummary.failed}
              </span>
            </div>
            <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
              top signal codes:{" "}
              {timelineTopCodes.length > 0
                ? timelineTopCodes.map(([code, count]) => `${code}(${count})`).join(", ")
                : "none"}
            </div>
          </div>
        </div>
      </section>

      <section id="summary" style={sectionStyle()}>
        <SectionHeading
          title="Summary"
          tip="Core heartbeat and snapshot health for this host."
        />
        <PanelStateBanner health={panelHealth.summary} />
        <div style={{ marginTop: 8, marginBottom: 4, color: "var(--dash-meta)", fontSize: 12 }}>
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

      <section id="fleet-policy" style={sectionStyle()}>
        <SectionHeading
          title="Fleet Policy"
          tip="Group/tag/scope routing and rollout priority controls that decide blast radius."
        />
        <PanelStateBanner health={panelHealth.fleetPolicy} />
        <div style={{ ...gridStyle(), marginTop: 8 }}>
          <Stat label="Group" value={fleetPolicy.group ?? "—"} />
          <Stat
            label="Tags"
            value={fleetPolicy.tags.length ? fleetPolicy.tags.join(", ") : "—"}
          />
          <Stat
            label="Scopes"
            value={fleetPolicy.scopes.length ? fleetPolicy.scopes.join(", ") : "—"}
          />
          <Stat
            label="Rollout"
            value={fleetPolicy.rolloutPaused ? "Paused" : "Active"}
          />
          <Stat
            label="Rollout priority"
            value={String(fleetPolicy.rolloutPriority)}
          />
        </div>
      </section>

      <section id="ingest-endpoint" style={sectionStyle()}>
        <SectionHeading
          title="Ingest Endpoint"
          tip="Where this host posts status snapshots using host API key authentication."
        />
        <p style={{ color: "var(--dash-muted)", marginTop: 6 }}>
          Send snapshots to this endpoint with a host API token in <code>Authorization: Bearer ...</code>.
        </p>
        <pre style={preStyle()}>
          <code>{`POST /api/hosts/${host.id}/status`}</code>
        </pre>
      </section>

      <section id="api-keys" style={sectionStyle()}>
        <SectionHeading
          title="API Keys"
          tip="Scoped keys for host ingest with rotation, expiry, revocation, and usage tracking."
        />
        <PanelStateBanner health={panelHealth.apiKeys} />
        <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
          Scoped keys now support rotation, expiry, revocation reason, and explicit versioning.
        </div>
        {host.apiKeys.length === 0 ? (
          <div style={{ color: "var(--dash-meta)" }}>No keys found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle()}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--dash-meta)" }}>
                  <th style={thStyle}>Prefix</th>
                  <th style={thStyle}>Version</th>
                  <th style={thStyle}>Label</th>
                  <th style={thStyle}>Scopes</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Last used</th>
                  <th style={thStyle}>Expires</th>
                  <th style={thStyle}>Revoked</th>
                  <th style={thStyle}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {host.apiKeys.map((k) => (
                  <tr key={k.id} style={{ borderTop: "1px solid var(--dash-soft-border, rgba(255,255,255,0.08))" }}>
                    <td style={tdStyle}>{k.prefix}</td>
                    <td style={tdStyle}>{k.version}</td>
                    <td style={tdStyle}>{k.label ?? "—"}</td>
                    <td style={tdStyle}>{hostKeyScopeSummary(parseHostKeyScopes(k.scopeJson))}</td>
                    <td style={tdStyle}>{fmt(k.createdAt.toISOString())}</td>
                    <td style={tdStyle}>{fmt(k.lastUsedAt ? k.lastUsedAt.toISOString() : undefined)}</td>
                    <td style={tdStyle}>{fmt(k.expiresAt ? k.expiresAt.toISOString() : undefined)}</td>
                    <td style={tdStyle}>{fmt(k.revokedAt ? k.revokedAt.toISOString() : undefined)}</td>
                    <td style={tdStyle}>{k.revokedReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="snapshots" style={sectionStyle()}>
        <SectionHeading
          title="Recent Snapshots"
          tip="Latest status payloads from the agent: alert and exposure history."
        />
        <PanelStateBanner health={panelHealth.snapshots} />
        {host.snapshots.length === 0 ? (
          <div style={{ color: "var(--dash-meta)" }}>No snapshots ingested yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle()}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--dash-meta)" }}>
                  <th style={thStyle}>Timestamp</th>
                  <th style={thStyle}>OK</th>
                  <th style={thStyle}>Alerts</th>
                  <th style={thStyle}>Unexpected Ports</th>
                </tr>
              </thead>
              <tbody>
                {host.snapshots.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--dash-soft-border, rgba(255,255,255,0.08))" }}>
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

      <section id="open-breaches" style={sectionStyle()}>
        <SectionHeading
          title="Open Breaches"
          tip="Confirmed breach records that are still unresolved."
        />
        <PanelStateBanner health={panelHealth.openBreaches} />
        {host.breaches.length === 0 ? (
          <div style={{ color: "var(--dash-meta)" }}>No open breaches.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {host.breaches.map((b) => (
              <div key={b.id} style={breachCardStyle()}>
                <div style={{ fontWeight: 800 }}>
                  {b.title}{" "}
                  <span style={{ color: "var(--dash-meta)", fontWeight: 500 }}>({b.severity})</span>
                </div>
                {b.detail ? <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{b.detail}</pre> : null}
                <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
                  Opened: {fmt(b.openedTs.toISOString())}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="security-command-center" style={sectionStyle()}>
        <SectionHeading
          title="Security Command Center"
          tip="Fused security posture from signal stack + containment state + recommended next move."
        />
        <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
          Ultimate-vision preview: combined risk scoring + containment stage from recent incidents and heartbeat health.
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          <span style={threatPillStyle(posture.band)}>Threat {posture.score} · {posture.band}</span>
          <span style={containmentPillStyle(posture.stage)}>
            Containment stage: {containmentStageLabel(posture.stage)}
          </span>
          <span style={{ color: "var(--dash-meta)", fontSize: 12 }}>Signals: {posture.signalCount}</span>
        </div>
        <div style={{ marginTop: 10, lineHeight: 1.5 }}>
          <strong>Next move:</strong> {posture.nextMove}
        </div>
        {posture.priorityCodes.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--dash-meta)" }}>
            Priority signal codes: {posture.priorityCodes.join(", ")}
          </div>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <a href="#response-playbook" style={btnStyle()}>
            Jump to response playbook
          </a>
        </div>
      </section>

      <section id="containment-kit" style={sectionStyle()}>
        <SectionHeading
          title="Emergency Containment Kit"
          tip="Pre-baked command kit generated from current host posture for fast triage/contain/verify/recover."
        />
        <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
          Human-confirmed runbook generated from this host risk posture and top response actions.
        </div>
        <div style={{ marginTop: 8, lineHeight: 1.5 }}>
          <strong>Profile:</strong> {containmentKit.profile} · {containmentKit.headline}
        </div>
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>1) Triage</div>
            <CopyCodeBlock text={containmentKit.triage.join("\n")} />
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>2) Contain</div>
            <CopyCodeBlock text={containmentKit.contain.join("\n")} />
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>3) Verify</div>
            <CopyCodeBlock text={containmentKit.verify.join("\n")} />
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>4) Recover</div>
            <CopyCodeBlock text={containmentKit.recover.join("\n")} />
          </div>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Copy Full Script</div>
            <CopyCodeBlock text={fullContainmentScript} />
          </div>
        </div>
      </section>

      <section id="incident-timeline" style={sectionStyle()}>
        <SectionHeading
          title="Incident Timeline"
          tip="Signal history collapsed for duplicates so you can see the highest-value sequence."
        />
        <PanelStateBanner health={panelHealth.timeline} />
        <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
          Correlated from recent snapshots with duplicate-noise collapsing
          (window {remediationPolicy.timelineDedupeWindowMinutes}m).
        </div>
        <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
          <span className={timelineSummary.bySeverity.critical > 0 ? "dashboard-chip dashboard-chip-bad" : "dashboard-chip dashboard-chip-ok"}>
            critical {timelineSummary.bySeverity.critical}
          </span>
          <span className={timelineSummary.bySeverity.high > 0 ? "dashboard-chip dashboard-chip-warn" : "dashboard-chip dashboard-chip-ok"}>
            high {timelineSummary.bySeverity.high}
          </span>
          <span className="dashboard-chip">medium {timelineSummary.bySeverity.medium}</span>
          <span className="dashboard-chip">low {timelineSummary.bySeverity.low}</span>
          <span className="dashboard-chip">info {timelineSummary.bySeverity.info}</span>
        </div>
        {timeline.length === 0 ? (
          <div style={{ marginTop: 10, color: "var(--dash-meta)" }}>
            No incident signals in recent snapshots.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {timeline.map((item, idx) => (
              <div key={`${item.snapshotId ?? "na"}-${idx}`} style={breachCardStyle()}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{item.title}</div>
                  <span style={severityPill(item.severity)}>
                    {item.severity}
                  </span>
                </div>
                <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                  {item.code} · {item.source} · {fmt(item.ts)}
                </div>
                {item.detail ? (
                  <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{item.detail}</pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="response-playbook" style={sectionStyle()}>
        <SectionHeading
          title="Response Playbook (Safe)"
          tip="Dry-run gating plus approval-safe execution for response actions."
        />
        <div style={{ color: "var(--dash-meta)", marginTop: 6, fontSize: 12 }}>
          Dry-run first, then confirm phrase to execute. Every run is logged to host history.
        </div>
        <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
          Host policy profile: <strong>{remediationPolicyResolved.profile}</strong> · queue cap {remediationPolicy.maxQueuePerHost}/host
        </div>
        <div style={{ marginTop: 8, color: "var(--dash-meta)", fontSize: 12 }}>
          Dry-run freshness window: {remediationPolicy.dryRunMaxAgeMinutes} minute(s)
        </div>
        {remediationPlan.context.unexpectedPublicPorts.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--dash-muted)" }}>
            Detected unexpected public ports:{" "}
            {remediationPlan.context.unexpectedPublicPorts
              .map((p) => `${p.proto}:${p.port}${p.proc ? ` (${p.proc})` : ""}`)
              .join(", ")}
          </div>
        ) : null}
        {remediationPlan.topCodes.length > 0 ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--dash-meta)" }}>
            Top recent signal codes: {remediationPlan.topCodes.join(", ")}
          </div>
        ) : null}
        {canRunRemediation ? (
          <RemediationConsole
            hostId={host.id}
            actions={remediations}
            dryRunWindowMinutes={remediationPolicy.dryRunMaxAgeMinutes}
            initialDryRunReadyActionIds={dryRunReadyActionIds}
          />
        ) : (
          <div style={{ marginTop: 10, color: "var(--dash-meta)" }}>
            Read-only role. Ops/admin/owner role required to run remediation actions.
          </div>
        )}
      </section>

      <section id="incident-workflow" style={sectionStyle()}>
        <SectionHeading
          title="Incident Workflow Runs"
          tip="Workflow-run records for this host, including escalation timing and assignment."
        />
        <PanelStateBanner health={panelHealth.incidentRuns} />
        {host.incidentRuns.length === 0 ? (
          <div style={{ marginTop: 10, color: "var(--dash-meta)" }}>
            No incident workflow runs yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {host.incidentRuns.map((incident) => (
              <div key={incident.id} style={breachCardStyle()}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>
                    {incident.title}{" "}
                    <span style={{ color: "var(--dash-meta)", fontWeight: 500 }}>
                      ({incident.workflowId})
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={severityPill(incident.severity)}>{incident.severity}</span>
                    <span
                      style={severityPill(
                        incident.state === "open"
                          ? "high"
                          : incident.state === "acknowledged"
                            ? "medium"
                            : "info"
                      )}
                    >
                      {incident.state}
                    </span>
                  </div>
                </div>
                <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                  Created: {fmt(incident.createdAt.toISOString())} · Updated:{" "}
                  {fmt(incident.updatedAt.toISOString())}
                </div>
                <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
                  Assignee: {incident.assigneeEmail ?? "—"} · Escalations: {incident.escalationCount}
                </div>
                <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
                  Ack due: {fmt(incident.ackDueAt ? incident.ackDueAt.toISOString() : undefined)} ·
                  Next escalation:{" "}
                  {fmt(
                    incident.nextEscalationAt ? incident.nextEscalationAt.toISOString() : undefined
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="remediation-runs" style={sectionStyle()}>
        <SectionHeading
          title="Remediation Runs"
          tip="Execution history for manual or autonomous remediation actions on this host."
        />
        <PanelStateBanner health={panelHealth.remediationRuns} />
        {host.remediationRuns.length === 0 ? (
          <div style={{ marginTop: 10, color: "var(--dash-meta)" }}>No remediation runs yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {host.remediationRuns.map((run) => (
              <div key={run.id} style={breachCardStyle()}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>
                    {run.action.title}{" "}
                    <span style={{ color: "var(--dash-meta)" }}>({run.action.key})</span>
                  </div>
                  <span style={severityPill(run.state === "failed" ? "high" : run.state === "running" || run.state === "queued" ? "medium" : "info")}>
                    {run.state}
                  </span>
                </div>
                <div style={{ marginTop: 6, color: "var(--dash-meta)", fontSize: 12 }}>
                  Requested: {fmt(run.requestedAt.toISOString())}
                  {run.requestedBy?.email ? ` by ${run.requestedBy.email}` : ""}
                </div>
                <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
                  Started: {fmt(run.startedAt ? run.startedAt.toISOString() : undefined)} · Finished:{" "}
                  {fmt(run.finishedAt ? run.finishedAt.toISOString() : undefined)}
                </div>
                <div style={{ marginTop: 4, color: "var(--dash-meta)", fontSize: 12 }}>
                  Mode: {parseRunMode(run.paramsJson)}
                </div>
                {run.error ? (
                  <pre
                    style={{
                      marginTop: 8,
                      whiteSpace: "pre-wrap",
                      color: "var(--dash-sev-critical-text, #fecaca)",
                    }}
                  >
                    {run.error}
                  </pre>
                ) : null}
                {run.output ? (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700 }}>Output</summary>
                    <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{run.output}</pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SectionHeading(props: { title: string; tip: string }) {
  return (
    <div className="dashboard-card-title-row">
      <h2 style={h2Style()}>
        <NoobTip text={props.tip}>{props.title}</NoobTip>
      </h2>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--dash-soft-border, rgba(255,255,255,0.10))",
        borderRadius: 10,
        padding: "8px 10px",
        background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--dash-meta, rgba(255,255,255,0.72))" }}>{props.label}</div>
      <div style={{ marginTop: 4, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}

function btnStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background: "var(--dash-btn-bg, rgba(255,255,255,0.06))",
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
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function h2Style(): React.CSSProperties {
  return { fontSize: 18, margin: 0 };
}

function gridStyle(): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
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
    border: "1px solid var(--dash-btn-border, rgba(255,255,255,0.15))",
    background: "color-mix(in srgb, var(--dash-card-bg, rgba(255,255,255,0.03)) 88%, transparent 12%)",
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
    border: "1px solid var(--dash-soft-border, rgba(255,255,255,0.10))",
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function topHostCardStyle(): React.CSSProperties {
  return {
    marginTop: 16,
    border: "1px solid var(--dash-card-border, rgba(255,255,255,0.12))",
    borderRadius: 12,
    padding: 12,
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function subPanelStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--dash-soft-border, rgba(255,255,255,0.10))",
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--dash-card-bg, rgba(255,255,255,0.02))",
  };
}

function statusBadgeStyle(tone: "ok" | "warn" | "bad"): React.CSSProperties {
  const palette =
    tone === "ok"
      ? {
          bg: "var(--dash-sev-ok-bg, rgba(34,197,94,0.14))",
          border: "var(--dash-sev-ok-border, rgba(34,197,94,0.35))",
          color: "var(--dash-sev-ok-text, #bbf7d0)",
        }
      : tone === "warn"
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

  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: 34,
    padding: "0 8px",
    border: `1px solid ${palette.border}`,
    borderRadius: 999,
    background: palette.bg,
    color: palette.color,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function severityPill(severity: "critical" | "high" | "medium" | "low" | "info"): React.CSSProperties {
  const tone =
    severity === "critical"
      ? {
          bg: "var(--dash-sev-critical-bg, rgba(239,68,68,0.14))",
          border: "var(--dash-sev-critical-border, rgba(239,68,68,0.35))",
          color: "var(--dash-sev-critical-text, #fecaca)",
        }
      : severity === "high"
      ? {
          bg: "var(--dash-sev-high-bg, rgba(245,158,11,0.14))",
          border: "var(--dash-sev-high-border, rgba(245,158,11,0.35))",
          color: "var(--dash-sev-high-text, #fcd34d)",
        }
      : severity === "medium"
      ? {
          bg: "var(--dash-sev-medium-bg, rgba(59,130,246,0.14))",
          border: "var(--dash-sev-medium-border, rgba(59,130,246,0.35))",
          color: "var(--dash-sev-medium-text, #bfdbfe)",
        }
      : severity === "low"
      ? {
          bg: "var(--dash-sev-low-bg, rgba(156,163,175,0.12))",
          border: "var(--dash-sev-low-border, rgba(156,163,175,0.35))",
          color: "var(--dash-sev-low-text, #e5e7eb)",
        }
      : {
          bg: "var(--dash-sev-ok-bg, rgba(34,197,94,0.12))",
          border: "var(--dash-sev-ok-border, rgba(34,197,94,0.35))",
          color: "var(--dash-sev-ok-text, #bbf7d0)",
        };

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

function threatPillStyle(band: ThreatBand): React.CSSProperties {
  if (band === "critical") return severityPill("critical");
  if (band === "elevated") return severityPill("high");
  if (band === "guarded") return severityPill("medium");
  return severityPill("info");
}

function containmentPillStyle(stage: ContainmentStage): React.CSSProperties {
  if (stage === "lockdown") return severityPill("critical");
  if (stage === "contain") return severityPill("high");
  if (stage === "watch") return severityPill("medium");
  return severityPill("info");
}

function containmentStageLabel(stage: ContainmentStage): string {
  if (stage === "lockdown") return "Lockdown";
  if (stage === "contain") return "Contain";
  if (stage === "watch") return "Watch";
  return "Observe";
}

function parseRunMode(paramsJson: string | null): string {
  if (!paramsJson) return "unknown";
  try {
    const parsed = JSON.parse(paramsJson) as { mode?: unknown };
    if (typeof parsed.mode === "string" && parsed.mode.trim()) return parsed.mode;
  } catch {
    // ignore malformed params
  }
  return "unknown";
}
