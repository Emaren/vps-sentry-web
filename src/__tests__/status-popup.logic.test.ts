import { describe, expect, it } from "vitest";
import { buildActionsNeeded, buildExplainText, buildFixSteps } from "../app/dashboard/_components/status-popup/logic";

describe("status-popup logic", () => {
  it("builds a clear layman explanation with summary reasons and top items", () => {
    const text = buildExplainText({
      summary: {
        needsAction: true,
        headline: "ACTION NEEDED",
        reasons: ["2 alert(s) detected.", "Public ports detected but allowlisted (1 total)."],
        items: [
          {
            id: "alerts",
            severity: "HIGH",
            title: "Alerts reported by the agent",
            summary: "Changes were detected and should be verified.",
            recommendedSteps: [],
          },
        ],
      },
      alertsCount: 2,
      publicPortsCount: 0,
      stale: false,
      actionsNeeded: ["Review 2 alerts below."],
      allowlistedTotal: 1,
      expectedPublicPorts: ["udp:68", "tcp:22", "tcp:80", "tcp:443"],
    });

    expect(text).toContain("plain-English readout");
    expect(text).toContain("Status: ACTION NEEDED");
    expect(text).toContain("Alerts: 2");
    expect(text).toContain("Unexpected public ports: 0");
    expect(text).toContain("allowlisted");
    expect(text).toContain("Why this was marked:");
    expect(text).toContain("[HIGH] Alerts reported by the agent");
    expect(text).toContain("Fix Now runs safe automations");
  });

  it("explains cpu hotspot alerts with operator-safe language", () => {
    const text = buildExplainText({
      summary: {
        needsAction: true,
        headline: "ACTION NEEDED",
        reasons: ["1 alert(s) detected."],
        items: [],
      },
      alertsCount: 1,
      publicPortsCount: 0,
      stale: false,
      actionsNeeded: ["Review 1 alert below."],
      allowlistedTotal: 1,
      expectedPublicPorts: ["udp:68", "tcp:22", "tcp:80", "tcp:443"],
      alertsPreview: [
        {
          title: "CPU hotspot detected",
          code: "cpu_hotspot",
          severity: "warn",
          detail: "Host CPU at 100.0% with process next (pid=2727801) using 93.0% CPU cap.",
        },
      ],
    });

    expect(text).toContain("[WARN] CPU hotspot detected");
    expect(text).toContain("single process is saturating CPU");
    expect(text).toContain("Evidence: Host CPU at 100.0%");
  });

  it("builds executable fix steps for allowlisted ports + alerts", () => {
    const steps = buildFixSteps({
      alertsCount: 2,
      publicPortsCount: 0,
      stale: false,
      allowlistedTotal: 1,
    });

    expect(steps.map((s) => s.id)).toEqual(["ports-allowlisted", "alerts", "report"]);
  });

  it("builds expected fix steps when unexpected ports and stale data exist", () => {
    const steps = buildFixSteps({
      alertsCount: 0,
      publicPortsCount: 2,
      stale: true,
      allowlistedTotal: null,
    });

    expect(steps.map((s) => s.id)).toEqual(["stale", "ports", "report"]);
  });

  it("adds queue follow-up step when remediation debt exists", () => {
    const steps = buildFixSteps({
      alertsCount: 0,
      publicPortsCount: 0,
      stale: false,
      allowlistedTotal: 1,
      queueQueuedCount: 2,
      queueDlqCount: 4,
    });

    expect(steps.map((s) => s.id)).toEqual(["ports-allowlisted", "queue-followup", "report"]);
  });

  it("adds runtime IOC containment step before alerts when IOC signals are present", () => {
    const steps = buildFixSteps({
      alertsCount: 2,
      publicPortsCount: 0,
      stale: false,
      allowlistedTotal: 1,
      alertsPreview: [
        {
          title: "Suspicious process IOC detected",
          code: "suspicious_process_ioc",
          severity: "critical",
          detail: "pid=1234 exe=/home/tony/.local/share/next",
        },
      ],
    });

    expect(steps.map((s) => s.id)).toEqual([
      "ports-allowlisted",
      "contain-runtime-ioc",
      "alerts",
      "report",
    ]);
  });

  it("includes queue follow-up guidance in actions list when backlog exists", () => {
    const actions = buildActionsNeeded({
      alertsCount: 0,
      publicPortsCount: 0,
      stale: false,
      allowlistedTotal: 1,
      queueQueuedCount: 3,
      queueDlqCount: 2,
    });

    expect(actions.some((line) => line.includes("Queue follow-up"))).toBe(true);
  });
});
