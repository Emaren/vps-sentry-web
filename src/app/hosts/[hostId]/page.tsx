import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmt } from "@/lib/status";
import { classifyHeartbeat, heartbeatLabel, readHeartbeatConfig } from "@/lib/host-heartbeat";
import { buildIncidentTimeline } from "@/lib/incident-signals";
import { buildRemediationPlanFromSnapshots } from "@/lib/remediate";
import { isWithinMinutes, readRemediationPolicy } from "@/lib/remediate/policy";
import { buildSecurityPostureFromSnapshots, type ContainmentStage, type ThreatBand } from "@/lib/security-posture";
import { buildContainmentKit, renderContainmentKitScript } from "@/lib/remediate/containment-kit";
import CopyCodeBlock from "@/app/get-vps-sentry/CopyCodeBlock";
import RemediationConsole from "./RemediationConsole";

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
  const remediationPolicy = readRemediationPolicy();
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

  return (
    <main style={{ padding: 16, maxWidth: 1060, margin: "0 auto" }}>
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
              Viewing details for {host.name}
            </p>
            <p style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>
              Host ID: <code>{host.id}</code>
            </p>
            <p className="app-header-meta">
              Heartbeat target every {heartbeat.expectedMinutes}m · stale at {heartbeat.staleAfterMinutes}m · missing at{" "}
              {heartbeat.missingAfterMinutes}m
            </p>
            {host.slug ? (
              <p style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>
                Slug: <code>{host.slug}</code>
              </p>
            ) : null}
          </div>
        </div>
        <div className="app-header-actions">
          <Link href="/dashboard" className="app-header-btn">
            Dashboard
          </Link>
          <Link href="/billing" className="app-header-btn">
            Billing
          </Link>
          <Link href="/get-vps-sentry" className="app-header-btn">
            Install guide
          </Link>
          <Link href="/hosts/new" className="app-header-btn">
            Add host
          </Link>
          <Link href="/hosts" className="app-header-btn">
            Back to hosts
          </Link>
        </div>
      </div>

      <section style={topHostCardStyle()}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{host.name}</div>
            <div style={{ marginTop: 4, opacity: 0.72, fontSize: 12 }}>{host.slug ? `/${host.slug}` : host.id}</div>
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
          </div>
        </div>
      </section>

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

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Security Command Center</h2>
        <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
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
          <span style={{ opacity: 0.7, fontSize: 12 }}>Signals: {posture.signalCount}</span>
        </div>
        <div style={{ marginTop: 10, lineHeight: 1.5 }}>
          <strong>Next move:</strong> {posture.nextMove}
        </div>
        {posture.priorityCodes.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.78 }}>
            Priority signal codes: {posture.priorityCodes.join(", ")}
          </div>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <a href="#response-playbook" style={btnStyle()}>
            Jump to response playbook
          </a>
        </div>
      </section>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Emergency Containment Kit</h2>
        <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
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

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Incident Timeline</h2>
        <div style={{ opacity: 0.7, marginTop: 6, fontSize: 12 }}>
          Correlated from recent snapshots with duplicate-noise collapsing
          (window {remediationPolicy.timelineDedupeWindowMinutes}m).
        </div>
        {timeline.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.7 }}>No incident signals in recent snapshots.</div>
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
                <div style={{ marginTop: 6, opacity: 0.8, fontSize: 12 }}>
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
        <h2 style={h2Style()}>Response Playbook (Safe)</h2>
        <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12 }}>
          Dry-run first, then confirm phrase to execute. Every run is logged to host history.
        </div>
        <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
          Dry-run freshness window: {remediationPolicy.dryRunMaxAgeMinutes} minute(s)
        </div>
        {remediationPlan.context.unexpectedPublicPorts.length > 0 ? (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.82 }}>
            Detected unexpected public ports:{" "}
            {remediationPlan.context.unexpectedPublicPorts
              .map((p) => `${p.proto}:${p.port}${p.proc ? ` (${p.proc})` : ""}`)
              .join(", ")}
          </div>
        ) : null}
        {remediationPlan.topCodes.length > 0 ? (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            Top recent signal codes: {remediationPlan.topCodes.join(", ")}
          </div>
        ) : null}
        <RemediationConsole
          hostId={host.id}
          actions={remediations}
          dryRunWindowMinutes={remediationPolicy.dryRunMaxAgeMinutes}
          initialDryRunReadyActionIds={dryRunReadyActionIds}
        />
      </section>

      <section style={sectionStyle()}>
        <h2 style={h2Style()}>Remediation Runs</h2>
        {host.remediationRuns.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.7 }}>No remediation runs yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {host.remediationRuns.map((run) => (
              <div key={run.id} style={breachCardStyle()}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>
                    {run.action.title} <span style={{ opacity: 0.72 }}>({run.action.key})</span>
                  </div>
                  <span style={severityPill(run.state === "failed" ? "high" : run.state === "running" ? "medium" : "info")}>
                    {run.state}
                  </span>
                </div>
                <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
                  Requested: {fmt(run.requestedAt.toISOString())}
                  {run.requestedBy?.email ? ` by ${run.requestedBy.email}` : ""}
                </div>
                <div style={{ marginTop: 4, opacity: 0.75, fontSize: 12 }}>
                  Started: {fmt(run.startedAt ? run.startedAt.toISOString() : undefined)} · Finished:{" "}
                  {fmt(run.finishedAt ? run.finishedAt.toISOString() : undefined)}
                </div>
                <div style={{ marginTop: 4, opacity: 0.75, fontSize: 12 }}>
                  Mode: {parseRunMode(run.paramsJson)}
                </div>
                {run.error ? (
                  <pre style={{ marginTop: 8, whiteSpace: "pre-wrap", color: "#fecaca" }}>{run.error}</pre>
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
    background: "rgba(255,255,255,0.06)",
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

function topHostCardStyle(): React.CSSProperties {
  return {
    marginTop: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    background: "rgba(255,255,255,0.02)",
  };
}

function statusBadgeStyle(tone: "ok" | "warn" | "bad"): React.CSSProperties {
  const palette =
    tone === "ok"
      ? { bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.35)", color: "#bbf7d0" }
      : tone === "warn"
      ? { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)", color: "#fcd34d" }
      : { bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)", color: "#fecaca" };

  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: 40,
    padding: "0 12px",
    border: `1px solid ${palette.border}`,
    borderRadius: 999,
    background: palette.bg,
    color: palette.color,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
    whiteSpace: "nowrap",
  };
}

function severityPill(severity: "critical" | "high" | "medium" | "low" | "info"): React.CSSProperties {
  const tone =
    severity === "critical"
      ? { bg: "rgba(239,68,68,0.14)", border: "rgba(239,68,68,0.35)", color: "#fecaca" }
      : severity === "high"
      ? { bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.35)", color: "#fcd34d" }
      : severity === "medium"
      ? { bg: "rgba(59,130,246,0.14)", border: "rgba(59,130,246,0.35)", color: "#bfdbfe" }
      : severity === "low"
      ? { bg: "rgba(156,163,175,0.12)", border: "rgba(156,163,175,0.35)", color: "#e5e7eb" }
      : { bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.35)", color: "#bbf7d0" };

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
