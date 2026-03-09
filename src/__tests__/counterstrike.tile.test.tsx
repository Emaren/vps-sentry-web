import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CounterstrikeTile from "@/app/dashboard/_components/CounterstrikeTile";

describe("CounterstrikeTile", () => {
  it("renders planned response details for analyze and dry-run results", () => {
    const html = renderToStaticMarkup(
      <CounterstrikeTile
        canRun={true}
        initialSnapshot={{
          ok: true,
          canRun: true,
          armed: {
            active: true,
            label: "armed",
            reason: "2 suspicious runtime candidate(s) matched the Counterstrike playbook.",
            candidateCount: 2,
          },
          running: null,
          last: {
            runId: "run-1",
            playbookLabel: "Zap! #1",
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
          },
        }}
        initialHistory={[
          {
            runId: "run-1",
            playbookLabel: "Zap! #1",
            playbookTitle: "Miner Persistence Purge",
            mode: "dry-run",
            status: "dry_run",
            startedAt: "2026-03-09T14:59:00.000Z",
            finishedAt: "2026-03-09T14:59:09.000Z",
            updatedAt: "2026-03-09T14:59:09.000Z",
            durationSeconds: 9,
            summary: "Dry run completed with a safe containment plan.",
            host: "157.180.114.124",
            alertsCount: 2,
            evidenceCaptured: false,
            rollbackAvailable: false,
            consolePath: "/var/lib/vps-sentry/counterstrike-runs/run-1/console.log",
            evidenceDir: "/var/lib/vps-sentry/counterstrike-runs/run-1/evidence",
            recentLines: [],
            errors: [],
            matchedCandidates: [],
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
          },
        ]}
      />
    );

    expect(html).toContain("Counterstrike");
    expect(html).toContain("Planned response");
    expect(html).toContain("Would stop 2 process(es), quarantine 2 executable(s), and scrub 1 cron line(s).");
    expect(html).toContain("targets 2");
    expect(html).toContain("Battlefeed");
    expect(html).toContain("Dry run completed with a safe containment plan.");
  });
});
