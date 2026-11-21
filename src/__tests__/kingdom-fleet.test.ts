import { describe, expect, it } from "vitest";
import { projectFleetStatus, FLEET_SCHEMA } from "@/lib/kingdom-os/fleet";

const NOW = new Date("2026-11-21T19:30:00.000Z");
const SHA = "a".repeat(64);

function current() {
  return {
    host: "ubuntu-4gb-hel1-11",
    ts: "2026-11-21T19:29:00.000Z",
    project_storage: {
      measured_at: "2026-11-21T19:29:00.000Z",
      ttl_seconds: 3600,
      host_filesystem: {
        path: "/", measured_at: "2026-11-21T19:29:00.000Z",
        total_bytes: 1000, used_bytes: 800, available_bytes: 200, used_percent: 80,
      },
      mounted_filesystems: [{
        mount_point: "/mnt/HC_Volume_105319120",
        measured_at: "2026-11-21T19:29:00.000Z",
        total_bytes: 2000, used_bytes: 1500, available_bytes: 500, used_percent: 75,
      }],
    },
    garbage_estimate: {
      measured_at: "2026-11-21T19:28:00.000Z",
      ttl_seconds: 600,
      safe_reclaimable_bytes: 0,
      guided_reclaimable_bytes: 1000,
      candidates: [
        { risk: "guided", path: "/var/www/AoE2HDBets/node_modules", bytes: 400, key: "guided_node_modules" },
        { risk: "guided", path: "/mnt/HC_Volume_105319120/archives", bytes: 600, key: "protected_archive" },
        { risk: "safe", path: "/var/cache/unknown", bytes: 99, key: "safe" },
      ],
    },
    alerts: [{ code: "host_disk_critical", severity: "critical", path: "/", detail: "root pressure" }],
    ports_public: [
      { proto: "tcp", port: 27656, proc: "wolochaind-main" },
      { proto: "udp", port: 68, proc: "systemd-networkd" },
      { proto: "tcp", port: 55555, proc: "unknown" },
    ],
    expected_public_ports: ["tcp:27656", "udp:68"],
    vitals: {
      cpu: { used_percent: 22 },
      memory: { used_percent: 44 },
    },
  };
}

describe("Kingdom OS fleet projection", () => {
  it("preserves independent root/volume capacity and source timestamps", () => {
    const p = projectFleetStatus(current(), SHA, NOW);
    expect(p.schema).toBe(FLEET_SCHEMA);
    expect(p.producer).toBe("VPSSentry");
    expect(p.sourceStatus.state).toBe("LIVE");
    expect(p.sourceStatus.sha256).toBe(SHA);
    expect(p.planes).toHaveLength(4);
    expect(p.planes[0].capacity?.availableBytes).toBe(200);
    expect(p.planes[1].capacity?.availableBytes).toBe(500);
    expect(p.planes[0].evidence.scope).toBe("hel1-root");
    expect(p.planes[1].evidence.scope).toBe("hel1-volume-105319120");
    expect(p.host.cpuUsedPercent).toBe(22);
    expect(p.host.memoryUsedPercent).toBe(44);
  });

  it("never invents M1 or Intel bytes from VPS data", () => {
    const p = projectFleetStatus(current(), SHA, NOW);
    for (const plane of p.planes.slice(2)) {
      expect(plane.capacity).toBeNull();
      expect(plane.evidence.state).toBe("UNVERIFIED");
      expect(plane.evidence.coverage).toBe("unavailable");
      expect(plane.evidence.identity).toBeNull();
      expect(plane.evidence.reason).toMatch(/No independently admitted signed/);
    }
  });

  it("separates root and volume guided candidates and never treats guided as safe", () => {
    const p = projectFleetStatus(current(), SHA, NOW);
    expect(p.reclaim.rootBytes).toBe(400);
    expect(p.reclaim.mountedVolumeBytes).toBe(600);
    expect(p.reclaim.unknownScopeBytes).toBe(0);
    expect(p.reclaim.safeNowBytes).toBe(0);
    expect(p.reclaim.totalGuidedBytes).toBe(1000);
    expect(p.reclaim.candidates).toHaveLength(2);
    expect(p.permissions).toEqual({
      readOnly: true, permitGeneration: false, rootMutation: false, financialAuthorized: false,
    });
  });

  it("explains known public listeners without hiding unexpected ports", () => {
    const p = projectFleetStatus(current(), SHA, NOW);
    expect(p.ports.map(x => x.allowed)).toEqual([true, true, false]);
    expect(p.ports[0].purpose).toMatch(/WoloChain/);
    expect(p.ports[1].purpose).toMatch(/DHCP/);
    expect(p.ports[2].port).toBe(55555);
    expect(p.alerts).toEqual([expect.objectContaining({
      id: "host_disk_critical:/", lifecycle: "DETECTED", severity: "critical",
    })]);
  });

  it("marks aged snapshots stale and does not invent recovered alert closures", () => {
    const v = current();
    v.ts = "2026-11-21T17:20:00.000Z";
    v.project_storage.measured_at = v.ts;
    v.project_storage.host_filesystem.measured_at = v.ts;
    v.project_storage.mounted_filesystems[0].measured_at = v.ts;
    v.garbage_estimate.measured_at = v.ts;
    const p = projectFleetStatus(v, SHA, NOW);
    expect(p.sourceStatus.state).toBe("STALE");
    expect(p.planes[0].evidence.state).toBe("STALE");
    expect(p.reclaim.evidence.state).toBe("STALE");
    expect(p.alerts).toHaveLength(1);
  });

  it("fails closed for invalid filesystem measurements and future timestamps", () => {
    const v = current();
    v.ts = "2026-11-22T19:30:00.000Z";
    v.project_storage.host_filesystem.used_bytes = 9999;
    const p = projectFleetStatus(v, SHA, NOW);
    expect(p.sourceStatus.state).toBe("UNVERIFIED");
    expect(p.planes[0].capacity).toBeNull();
    expect(p.planes[0].evidence.state).toBe("UNVERIFIED");
    expect(p.host.services).toBeNull();
    expect(p.host.timers).toBeNull();
    expect(p.host.sourceDrift).toBeNull();
  });
});
