import { describe, expect, it } from "vitest";
import { deriveThreatIndicators } from "../app/dashboard/_lib/derive";
import type { Status } from "../lib/status";

function baseStatus(): Status {
  return {
    host: "ubuntu-4gb-hel1-11",
    version: "1.0.0",
    ts: "2026-02-07T01:45:07.430775+00:00",
    alerts_count: 0,
    alerts: [],
    public_ports_count: 1,
    ports_public: [],
  };
}

describe("deriveThreatIndicators", () => {
  it("raises critical for stacked watched-file + firewall/user drift pattern", () => {
    const s: Status = {
      ...baseStatus(),
      alerts_count: 4,
      alerts: [
        { title: "User list changed", detail: "Added: postgres(uid=108)" },
        { title: "Watched files changed", detail: "Changed:\n/etc/systemd/system" },
        { title: "Firewall changed", detail: "Changed firewall keys" },
        { title: "Packages changed", detail: "Upgraded packages..." },
      ],
    };

    const out = deriveThreatIndicators(s);

    expect(out.some((x) => x.id === "stacked-hardening-surface-changes" && x.severity === "critical")).toBe(true);
    expect(out.some((x) => x.id === "runtime-coverage-gap" && x.severity === "warn")).toBe(true);
  });

  it("does not raise critical when stacked change pattern is absent", () => {
    const s: Status = {
      ...baseStatus(),
      alerts_count: 1,
      alerts: [{ title: "Packages changed", detail: "Only package updates" }],
      threat: {
        suspicious_processes: [],
        outbound_suspicious: [],
        persistence_hits: [],
      },
    };

    const out = deriveThreatIndicators(s);
    expect(out.some((x) => x.severity === "critical")).toBe(false);
  });
});
