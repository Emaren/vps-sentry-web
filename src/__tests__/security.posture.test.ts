import { describe, expect, it } from "vitest";
import { buildSecurityPosture, buildSecurityPostureFromSnapshots } from "../lib/security-posture";
import type { IncidentSignal } from "../lib/incident-signals";

describe("security posture scoring", () => {
  const now = new Date("2026-02-07T12:00:00.000Z");

  it("escalates to lockdown on high-risk active signals", () => {
    const signals: IncidentSignal[] = [
      {
        code: "config_tamper",
        severity: "critical",
        title: "Watched files changed",
        detail: "/etc/sudoers.d",
        ts: "2026-02-07T11:55:00.000Z",
        source: "alert",
        snapshotId: "s1",
      },
    ];

    const posture = buildSecurityPosture(signals, "fresh", now);
    expect(posture.score).toBeGreaterThanOrEqual(70);
    expect(posture.band).toBe("critical");
    expect(posture.stage).toBe("lockdown");
  });

  it("stays low for empty/noise signals with healthy heartbeat", () => {
    const posture = buildSecurityPosture([], "fresh", now);
    expect(posture.score).toBe(0);
    expect(posture.band).toBe("low");
    expect(posture.stage).toBe("observe");
  });

  it("applies heartbeat penalty when host is missing", () => {
    const posture = buildSecurityPosture([], "missing", now);
    expect(posture.score).toBe(20);
    expect(posture.band).toBe("guarded");
    expect(posture.stage).toBe("observe");
  });
});

describe("security posture from snapshots", () => {
  it("derives posture from timeline extraction", () => {
    const posture = buildSecurityPostureFromSnapshots(
      [
        {
          id: "a",
          ts: "2026-02-07T11:58:00.000Z",
          status: {
            alerts: [{ title: "Watched files changed", detail: "/etc/sudoers.d" }],
            unexpected_public_ports_count: 1,
          },
        },
      ],
      "fresh",
      { now: new Date("2026-02-07T12:00:00.000Z") }
    );

    expect(posture.priorityCodes).toContain("config_tamper");
    expect(posture.priorityCodes).toContain("unexpected_public_ports");
    expect(posture.stage).toBe("lockdown");
  });
});
