import React from "react";
import { fmt } from "@/lib/status";
import Box from "../Box";
import NoobTip from "../NoobTip";
import PanelStateBanner from "../PanelStateBanner";
import type {
  DashboardOpsSnapshot,
  DashboardProtectionWin,
} from "../../_lib/types";

function toneClass(tone: DashboardProtectionWin["tone"]): string {
  if (tone === "bad") return "dashboard-chip dashboard-chip-bad";
  if (tone === "warn") return "dashboard-chip dashboard-chip-warn";
  return "dashboard-chip dashboard-chip-ok";
}

function categoryLabel(category: DashboardProtectionWin["category"]): string {
  if (category === "neutralized") return "threat neutralized";
  if (category === "recovered") return "service recovered";
  if (category === "hardening") return "auto hardened";
  return "automation win";
}

export default function ProtectionRecordSection(props: {
  ops: DashboardOpsSnapshot;
  snapshotTs: string;
}) {
  const { ops, snapshotTs } = props;
  const protection = ops.protection;
  const health = ops.panelHealth.protection;

  return (
    <section style={{ marginTop: 18 }}>
      <div className="dashboard-card-title-row">
        <h2 style={{ fontSize: 18, margin: 0 }}>
          <NoobTip text="A running ledger of real saves: neutralized threats, recoveries, and successful protective actions.">
            Confirmed Saves
          </NoobTip>
        </h2>
      </div>
      <div style={{ color: "var(--dash-meta)", fontSize: 12, marginTop: 8 }}>
        As-of: <b>{fmt(snapshotTs)}</b> · This is the confidence surface: proof that VPS Sentry is not just watching, but winning.
      </div>

      <PanelStateBanner health={health} />

      {health.status === "error" ||
      health.status === "loading" ||
      health.status === "forbidden" ||
      !protection ? null : (
        <>
          <Box className="dashboard-protection-hero" style={{ marginTop: 10 }}>
            <div className="dashboard-protection-hero-head">
              <div className="dashboard-protection-hero-copy">
                <div className="dashboard-protection-hero-kicker">protection record</div>
                <div className="dashboard-protection-hero-headline">{protection.headline}</div>
                <div className="dashboard-protection-hero-subline">{protection.subline}</div>
              </div>
              <div className="dashboard-protection-hero-meta">
                <span className="dashboard-chip dashboard-chip-ok">confirmed saves {protection.counts.total}</span>
                {protection.mostRecentAtIso ? (
                  <span className="dashboard-chip">latest {fmt(protection.mostRecentAtIso)}</span>
                ) : null}
              </div>
            </div>

            <div className="dashboard-chip-row" style={{ marginTop: 10 }}>
              <span className="dashboard-chip dashboard-chip-bad">
                neutralized {protection.counts.neutralized}
              </span>
              <span className="dashboard-chip dashboard-chip-ok">
                recovered {protection.counts.recovered}
              </span>
              <span className="dashboard-chip dashboard-chip-ok">
                auto hardened {protection.counts.hardening}
              </span>
              <span className="dashboard-chip">
                automation wins {protection.counts.remediation}
              </span>
            </div>
          </Box>

          <div className="dashboard-protection-grid">
            <Box className="dashboard-protection-feed">
              <div className="dashboard-card-title-row">
                <div style={{ fontWeight: 800 }}>Victory log</div>
                <span className="dashboard-chip">scrollback</span>
              </div>

              {protection.recent.length === 0 ? (
                <div className="dashboard-support-empty" style={{ marginTop: 10 }}>
                  No confirmed wins logged yet.
                </div>
              ) : (
                <div className="dashboard-protection-list">
                  {protection.recent.map((entry) => (
                    <div key={entry.id} className="dashboard-protection-entry">
                      <div className="dashboard-protection-entry-head">
                        <span className={toneClass(entry.tone)}>{categoryLabel(entry.category)}</span>
                        <div className="dashboard-protection-entry-time">{fmt(entry.occurredAt)}</div>
                      </div>
                      <div className="dashboard-protection-entry-title">{entry.title}</div>
                      <div className="dashboard-protection-entry-summary">{entry.summary}</div>
                      <div className="dashboard-chip-row" style={{ marginTop: 8 }}>
                        {entry.hostName ? <span className="dashboard-chip">{entry.hostName}</span> : null}
                        <span className="dashboard-chip">{entry.source}</span>
                        {entry.evidenceLabel ? (
                          <span className="dashboard-chip">{entry.evidenceLabel}</span>
                        ) : null}
                        {entry.repeatCount > 1 ? (
                          <span className="dashboard-chip">x{entry.repeatCount}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Box>

            <Box className="dashboard-protection-sidecard">
              <div className="dashboard-card-title-row">
                <div style={{ fontWeight: 800 }}>Why operators trust this</div>
                <span className="dashboard-chip">comfort + proof</span>
              </div>
              <div className="dashboard-support-note" style={{ marginTop: 10 }}>
                Operators remember saves more than scans. This panel turns invisible protection into a readable operating history: what was caught, what was recovered, and what protection actually landed.
              </div>
              <div className="dashboard-support-note" style={{ marginTop: 10 }}>
                The goal is simple: when you open VPS Sentry, you should immediately feel both current safety and earned confidence.
              </div>
              <div className="dashboard-chip-row" style={{ marginTop: 12 }}>
                <span className="dashboard-chip dashboard-chip-ok">real evidence</span>
                <span className="dashboard-chip">scrollable wins</span>
                <span className="dashboard-chip">one-line summary</span>
              </div>
            </Box>
          </div>
        </>
      )}
    </section>
  );
}
