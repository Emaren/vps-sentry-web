import { describe, expect, it } from "vitest";
import {
  buildIncidentTimeline,
  extractSignalsFromStatus,
} from "../lib/incident-signals";

describe("incident signal extraction", () => {
  it("classifies high-impact config tamper from alerts", () => {
    const signals = extractSignalsFromStatus({
      snapshotId: "s1",
      ts: "2026-02-07T06:00:00.000Z",
      status: {
        alerts: [
          {
            title: "Watched files changed",
            detail: "Changed:\n/home/tony/.ssh/authorized_keys\n/etc/sudoers.d",
          },
        ],
      },
    });

    expect(signals.some((s) => s.code === "config_tamper" && s.severity === "critical")).toBe(true);
  });

  it("adds auth and unexpected ports signals", () => {
    const signals = extractSignalsFromStatus({
      snapshotId: "s2",
      ts: "2026-02-07T06:05:00.000Z",
      status: {
        auth: {
          ssh_failed_password: 7,
          ssh_invalid_user: 2,
        },
        unexpected_public_ports_count: 2,
      },
    });

    expect(signals.some((s) => s.code === "ssh_failed_password")).toBe(true);
    expect(signals.some((s) => s.code === "ssh_invalid_user")).toBe(true);
    expect(signals.some((s) => s.code === "unexpected_public_ports")).toBe(true);
  });
});

describe("incident timeline correlation", () => {
  it("dedupes repeated signals in short window", () => {
    const sameAlert = {
      alerts: [{ title: "Packages changed", detail: "upgrade" }],
    };

    const result = buildIncidentTimeline([
      { id: "a", ts: "2026-02-07T06:00:00.000Z", status: sameAlert },
      { id: "b", ts: "2026-02-07T05:50:00.000Z", status: sameAlert },
      { id: "c", ts: "2026-02-07T03:00:00.000Z", status: sameAlert },
    ]);

    // first two collapse (within 30m), third remains
    const packageSignals = result.timeline.filter((s) => s.code === "package_drift");
    expect(packageSignals.length).toBe(2);
    expect(result.summary.total).toBeGreaterThanOrEqual(2);
  });
});
