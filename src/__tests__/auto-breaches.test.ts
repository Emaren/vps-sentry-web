import { describe, expect, it, vi } from "vitest";
import {
  collectAutoBreachCandidates,
  reconcileAutoBreachesForHost,
  shouldPromoteSignalToBreach,
} from "@/lib/auto-breaches";

describe("auto breaches", () => {
  it("promotes only serious breach-like signals from snapshots", () => {
    const candidates = collectAutoBreachCandidates({
      snapshotId: "snap_1",
      ts: "2026-03-12T01:00:00.000Z",
      status: {
        alerts: [
          {
            title: "/etc/sudoers changed",
            detail: "tamper detected",
            severity: "critical",
          },
          {
            title: "Packages changed",
            detail: "routine deploy drift",
            severity: "warn",
          },
        ],
        auth: {
          ssh_failed_password: 14,
          ssh_invalid_user: 7,
        },
        unexpected_public_ports_count: 1,
      },
    });

    expect(candidates.map((row) => row.code).sort()).toEqual([
      "config_tamper",
      "unexpected_public_ports",
    ]);
    expect(
      shouldPromoteSignalToBreach({
        code: "ssh_failed_password",
        severity: "high",
        title: "Failed SSH passwords detected",
        detail: "Count: 14",
        ts: "2026-03-12T01:00:00.000Z",
        snapshotId: "snap_1",
        source: "auth",
      })
    ).toBe(false);
  });

  it("opens new auto breaches and fixes stale ones without touching manual rows", async () => {
    const prisma = {
      breach: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "auto-open-firewall",
            code: "firewall_drift",
            title: "Firewall changed",
            detail: "ufw changed",
            severity: "warn",
            state: "open",
            evidenceJson: JSON.stringify({
              managedBy: "host-status-auto-breach",
              version: 1,
              key: "firewall_drift",
              snapshotId: "snap_old",
              snapshotTs: "2026-03-12T00:30:00.000Z",
              lastObservedTs: "2026-03-12T00:30:00.000Z",
              signal: {
                code: "firewall_drift",
                severity: "high",
                title: "Firewall changed",
                detail: "ufw changed",
                source: "alert",
              },
            }),
          },
          {
            id: "manual-open",
            code: "manual_case",
            title: "Manual breach",
            detail: "operator created",
            severity: "critical",
            state: "open",
            evidenceJson: JSON.stringify({
              source: "manual",
            }),
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: "created_breach" }),
        update: vi.fn().mockResolvedValue({ id: "updated_breach" }),
      },
    };

    const result = await reconcileAutoBreachesForHost({
      prisma,
      hostId: "host_1",
      snapshotId: "snap_2",
      ts: "2026-03-12T01:00:00.000Z",
      status: {
        unexpected_public_ports_count: 2,
      },
    });

    expect(result).toEqual({
      opened: 1,
      fixed: 1,
      active: 1,
      suppressed: 0,
    });
    expect(prisma.breach.create).toHaveBeenCalledTimes(1);
    expect(prisma.breach.update).toHaveBeenCalledTimes(1);
    expect(prisma.breach.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "auto-open-firewall" },
        data: expect.objectContaining({
          state: "fixed",
        }),
      })
    );
  });

  it("respects ignored auto breaches and suppresses re-opening them", async () => {
    const prisma = {
      breach: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "ignored-config",
            code: "config_tamper",
            title: "Config tamper",
            detail: "/etc/sudoers changed",
            severity: "critical",
            state: "ignored",
            evidenceJson: JSON.stringify({
              managedBy: "host-status-auto-breach",
              version: 1,
              key: "config_tamper",
              snapshotId: "snap_old",
              snapshotTs: "2026-03-12T00:30:00.000Z",
              lastObservedTs: "2026-03-12T00:30:00.000Z",
              signal: {
                code: "config_tamper",
                severity: "critical",
                title: "Config tamper",
                detail: "/etc/sudoers changed",
                source: "alert",
              },
            }),
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: "created_breach" }),
        update: vi.fn().mockResolvedValue({ id: "updated_breach" }),
      },
    };

    const result = await reconcileAutoBreachesForHost({
      prisma,
      hostId: "host_1",
      snapshotId: "snap_3",
      ts: "2026-03-12T01:05:00.000Z",
      status: {
        alerts: [
          {
            title: "/etc/sudoers changed",
            detail: "tamper detected",
            severity: "critical",
          },
        ],
      },
    });

    expect(result).toEqual({
      opened: 0,
      fixed: 0,
      active: 1,
      suppressed: 1,
    });
    expect(prisma.breach.create).not.toHaveBeenCalled();
    expect(prisma.breach.update).not.toHaveBeenCalled();
  });
});
