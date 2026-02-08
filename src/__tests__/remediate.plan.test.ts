import { describe, expect, it } from "vitest";
import type { IncidentSignal } from "../lib/incident-signals";
import { buildRemediationActions } from "../lib/remediate/actions";
import { buildRemediationPlanFromSnapshots } from "../lib/remediate";
import { deriveRemediationContextFromStatus } from "../lib/remediate/context";

describe("remediation actions", () => {
  it("returns lock-down playbook for config tamper signals", () => {
    const signals: IncidentSignal[] = [
      {
        code: "config_tamper",
        severity: "critical",
        title: "Watched files changed",
        detail: "/etc/sudoers.d",
        ts: "2026-02-07T01:45:00.000Z",
        snapshotId: "snap-1",
        source: "alert",
      },
    ];

    const actions = buildRemediationActions(signals);
    expect(actions[0]?.id).toBe("lockdown-access-surface");
    expect(actions[0]?.priority).toBe("P0");
    expect(actions[0]?.commands.length).toBeGreaterThan(2);
    expect(actions[0]?.confirmPhrase).toBe("EXECUTE lockdown-access-surface");
  });

  it("returns generic forensics action for unknown signal codes", () => {
    const signals: IncidentSignal[] = [
      {
        code: "unknown_signal",
        severity: "medium",
        title: "Unknown signal",
        ts: "2026-02-07T01:45:00.000Z",
        snapshotId: "snap-2",
        source: "alert",
      },
    ];

    const actions = buildRemediationActions(signals);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("collect-forensics-first");
  });

  it("injects host-specific unexpected port deny rules", () => {
    const signals: IncidentSignal[] = [
      {
        code: "unexpected_public_ports",
        severity: "high",
        title: "Unexpected public ports detected",
        ts: "2026-02-07T01:45:00.000Z",
        snapshotId: "snap-3",
        source: "ports",
      },
    ];

    const context = deriveRemediationContextFromStatus({
      ports_public: [
        { host: "157.180.114.124", port: 68, proto: "udp", proc: "systemd-network" },
        { host: "157.180.114.124", port: 3333, proto: "tcp", proc: "python3" },
      ],
      expected_public_ports: ["udp:68"],
      unexpected_public_ports_count: 1,
    });
    const actions = buildRemediationActions(signals, context);
    const quarantine = actions.find((a) => a.id === "quarantine-unexpected-listener");
    expect(quarantine).toBeTruthy();
    expect(quarantine?.commands.some((c) => c.includes("sudo ufw deny 3333/tcp"))).toBe(true);
  });
});

describe("remediation plan builder", () => {
  it("builds timeline-backed action plan from snapshots", () => {
    const plan = buildRemediationPlanFromSnapshots([
      {
        id: "a",
        ts: "2026-02-07T01:00:00.000Z",
        status: {
          alerts: [{ title: "Packages changed", detail: "~ nodejs 20.19 -> 20.20" }],
          auth: { ssh_failed_password: 3, ssh_invalid_user: 0 },
        },
      },
      {
        id: "b",
        ts: "2026-02-07T00:58:00.000Z",
        status: {
          alerts: [{ title: "Packages changed", detail: "~ nodejs 20.19 -> 20.20" }],
        },
      },
    ]);

    expect(plan.timelineCount).toBeGreaterThan(0);
    expect(plan.topCodes).toContain("package_drift");
    expect(plan.actions.some((a) => a.id === "verify-system-drift")).toBe(true);
    expect(plan.context.publicPorts).toHaveLength(0);
  });
});
