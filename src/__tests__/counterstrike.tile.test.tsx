import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CounterstrikeTile from "@/app/dashboard/_components/CounterstrikeTile";

type CounterstrikeProps = React.ComponentProps<typeof CounterstrikeTile>;
type CounterstrikeSnapshot = NonNullable<CounterstrikeProps["initialSnapshot"]>;
type CounterstrikeRun = NonNullable<CounterstrikeSnapshot["last"]>;

function makeRun(overrides: Partial<CounterstrikeRun> = {}): CounterstrikeRun {
  return {
    runId: "run-1",
    playbook: "zap-01-miner-persistence-purge",
    playbookLabel: "IOC-1",
    playbookTitle: "Miner Persistence Purge",
    mode: "analyze",
    status: "analysis_only",
    startedAt: "2026-03-09T15:00:00.000Z",
    finishedAt: "2026-03-09T15:00:12.000Z",
    updatedAt: "2026-03-09T15:00:12.000Z",
    durationSeconds: 12,
    summary: "Would quarantine miner-style executables and scrub matching cron persistence.",
    host: "157.180.114.124",
    alertsCount: 2,
    evidenceCaptured: false,
    rollbackAvailable: false,
    consolePath: "/var/lib/vps-sentry/counterstrike-runs/run-1/console.log",
    evidenceDir: "/var/lib/vps-sentry/counterstrike-runs/run-1/evidence",
    recentLines: [
      "[15:00:01Z] Analyze-only pass complete.",
      "[15:00:02Z] Planned stop targets: 2 process(es).",
    ],
    errors: [],
    matchedCandidates: [
      {
        pid: 4102,
        user: "root",
        proc: "systemd-logind",
        exe: "/var/tmp/systemd-logind",
        reasons: ["writable path"],
      },
    ],
    plannedActions: {
      candidateCount: 2,
      stopPids: [4102, 4103],
      quarantinePaths: ["/var/tmp/systemd-logind", "/tmp/kdevtmpfsi"],
      cronRemovedLines: 1,
      cronChangedTargets: ["user:root"],
    },
    quarantinedPaths: [],
    cronRemovedLines: null,
    cronChangedTargets: [],
    armedBefore: {
      active: true,
      label: "armed",
      reason: "2 suspicious runtime candidate(s) matched the Counterstrike playbook.",
      candidateCount: 2,
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<CounterstrikeSnapshot> = {}): CounterstrikeSnapshot {
  return {
    ok: true,
    canRun: true,
    armed: {
      active: true,
      label: "armed",
      reason: "2 suspicious runtime candidate(s) matched the Counterstrike playbook.",
      candidateCount: 2,
    },
    running: null,
    last: makeRun(),
    ...overrides,
  };
}

describe("CounterstrikeTile", () => {
  it("renders planned response details for analyze and dry-run results", () => {
    const html = renderToStaticMarkup(
      <CounterstrikeTile
        canRun={true}
        initialSnapshot={makeSnapshot()}
        initialHistory={[
          makeRun({
            mode: "dry-run",
            status: "dry_run",
            startedAt: "2026-03-09T14:59:00.000Z",
            finishedAt: "2026-03-09T14:59:09.000Z",
            updatedAt: "2026-03-09T14:59:09.000Z",
            durationSeconds: 9,
            summary: "Dry run completed with a safe containment plan.",
            recentLines: [],
            matchedCandidates: [],
          }),
        ]}
      />
    );

    expect(html).toContain("Counterstrike");
    expect(html).toContain("Runtime IOC response playbooks");
    expect(html).toContain("Planned response");
    expect(html).toContain("Would stop 2 process(es), quarantine 2 executable(s), and scrub 1 cron line(s).");
    expect(html).toContain("targets 2");
    expect(html).toContain("Battlefeed");
    expect(html).toContain("Dry run completed with a safe containment plan.");
  });

  it("does not blame Counterstrike when a stale no-candidate run is standby now", () => {
    const html = renderToStaticMarkup(
      <CounterstrikeTile
        canRun={true}
        initialSnapshot={makeSnapshot({
          armed: {
            active: false,
            label: "standby",
            reason: "No miner-persistence candidates matched the current threat snapshot.",
            candidateCount: 0,
          },
          last: makeRun({
            status: "analysis_only",
            summary: "Analyzed host state. No safe containment candidates matched.",
            plannedActions: {
              candidateCount: 0,
              stopPids: [],
              quarantinePaths: [],
              cronRemovedLines: 0,
              cronChangedTargets: [],
            },
            matchedCandidates: [],
            armedBefore: {
              active: false,
              label: "standby",
              reason: "No miner-persistence candidates matched the current threat snapshot.",
              candidateCount: 0,
            },
          }),
        })}
      />
    );

    expect(html).not.toContain("Current Runtime Signal Still Active");
    expect(html).not.toContain("host remains red");
    expect(html).not.toContain("safe kill");
    expect(html).toContain("Runtime containment standby");
    expect(html).toContain("current threat snapshot has no runtime IOC candidates");
  });

  it("keeps the no-candidate blocker only when the current runtime signal is active", () => {
    const html = renderToStaticMarkup(
      <CounterstrikeTile
        canRun={true}
        initialSnapshot={makeSnapshot({
          last: makeRun({
            status: "analysis_only",
            summary: "Threat feed still reports suspicious runtime IOC activity, but no safe candidates matched.",
            plannedActions: {
              candidateCount: 0,
              stopPids: [],
              quarantinePaths: [],
              cronRemovedLines: 0,
              cronChangedTargets: [],
            },
            matchedCandidates: [],
          }),
        })}
      />
    );

    expect(html).toContain("Current Runtime Signal Still Active");
    expect(html).toContain("Current runtime IOC evidence is still present");
    expect(html).toContain("IOC-2");
  });
});
