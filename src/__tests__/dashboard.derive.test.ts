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
        vitals: {
          cpu: { used_percent: 47.2, capacity_percent: 100, cores: 2 },
          memory: { used_percent: 61.1, total_mb: 4096, used_mb: 2500.5, available_mb: 1595.5 },
          processes: {
            sampled_count: 100,
            top: [
              {
                pid: 123,
                name: "node",
                cpu_share_percent: 44.4,
                cpu_capacity_percent: 22.2,
                memory_mb: 512.2,
                memory_capacity_percent: 12.5,
              },
            ],
            other: {
              name: "other-processes",
              cpu_share_percent: 55.6,
              cpu_capacity_percent: 27.8,
              memory_mb: 800.0,
              memory_capacity_percent: 19.5,
            },
            cpu_share_total_percent: 100,
          },
        },
      } as Status,
    });

    expect(typeof out.alertsCount).toBe("number");
    expect(typeof out.publicPortsCount).toBe("number");
    expect(out.headline === "ACTION NEEDED" || out.headline === "OK").toBe(true);
    expect(out.hasVitals).toBe(true);
    expect(out.cpuUsedPercent).toBe(47.2);
    expect(out.memoryUsedPercent).toBe(61.1);
    expect(out.vitalsProcesses.length).toBe(2);
  });
});
