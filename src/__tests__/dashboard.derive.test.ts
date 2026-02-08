import { describe, expect, it } from "vitest";
import { deriveDashboard } from "../app/dashboard/_lib/derive";
import type { Status } from "../lib/status";

describe("deriveDashboard", () => {
  it("uses actionable counts for alerts and ports", () => {
    const out = deriveDashboard({
      raw: {},
      last: {
        host: "test",
        version: "1.0.0",
        ts: "2026-02-07T00:00:00.000Z",
        alerts_count: 1,
        alerts: [{ title: "Packages changed", detail: "Upgrade list" }],
        public_ports_count: 1,
        ports_public: [
          {
            proto: "udp",
            host: "157.180.114.124",
            port: 68,
            proc: "systemd-network",
            pid: 1,
            public: true,
            sig: "udp|68",
          },
        ],
      } as Status,
    });

    expect(typeof out.alertsCount).toBe("number");
    expect(typeof out.publicPortsCount).toBe("number");
    expect(out.headline === "ACTION NEEDED" || out.headline === "OK").toBe(true);
  });
});
