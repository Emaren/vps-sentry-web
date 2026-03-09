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
        project_storage: {
          measured_at: "2026-02-07T00:00:00.000Z",
          ttl_seconds: 3600,
          projects: {
            "vps-sentry": {
              disk_bytes: 123456789,
              apparent_bytes: 130000000,
              file_count: 4200,
              largest_dirs: [{ label: "VPSSentry/vps-sentry-web/node_modules", disk_bytes: 45678901 }],
            },
          },
        },
        garbage_estimate: {
          schema_version: 1,
          measured_at: "2026-02-07T00:05:00.000Z",
          ttl_seconds: 600,
          reclaimable_bytes_total: 812646400,
          safe_reclaimable_bytes: 812646400,
          buckets: [
            {
              key: "tmp_stale",
              label: "Stale /tmp files",
              bytes: 268435456,
              count: 12,
            },
          ],
          top_paths: [
            {
              path: "/tmp/tmp.drDlZXOgOZ",
              bytes: 269484032,
              bucket: "tmp_stale",
            },
          ],
          running_cleanup: false,
          cleanup_progress: {
            started_at: "2026-02-07T00:05:30.000Z",
            updated_at: "2026-02-07T00:05:36.000Z",
            phase: "reclaiming",
            current_label: "VS Code cached VSIX downloads",
            current_target: "/root/.vscode-server/data/CachedExtensionVSIXs",
            current_command: "rm -rf /root/.vscode-server/data/CachedExtensionVSIXs",
            completed_steps: 1,
            total_steps: 3,
            errors_count: 0,
            eta_seconds: 12,
            recent_lines: [
              "$ scan safe garbage candidates",
              "$ rm -rf /root/.vscode-server/data/CachedExtensionVSIXs",
            ],
          },
          last_cleanup_result: {
            ok: true,
            started_at: "2026-02-07T00:04:00.000Z",
            finished_at: "2026-02-07T00:04:12.000Z",
            freed_bytes_estimated: 693000000,
            freed_bytes_actual: 680000000,
            deleted_count: 14,
            buckets: [
              {
                key: "tmp_stale",
                label: "Stale /tmp files",
                estimated_bytes: 693000000,
                deleted_count: 14,
              },
            ],
            errors: [],
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
    expect((out.canonicalStatus as Status).project_storage).toBeDefined();
    expect(out.garbageEstimate?.safeReclaimableBytes).toBe(812646400);
    expect(out.garbageEstimate?.lastCleanupResult?.freedBytesActual).toBe(680000000);
    expect(out.garbageEstimate?.cleanupProgress?.currentLabel).toBe("VS Code cached VSIX downloads");
    expect(out.garbageEstimate?.cleanupProgress?.totalSteps).toBe(3);
  });
});
