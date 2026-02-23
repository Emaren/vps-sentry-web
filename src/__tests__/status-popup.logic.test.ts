import { describe, expect, it } from "vitest";
import { buildExplainText, buildFixSteps } from "../app/dashboard/_components/status-popup/logic";

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
});
