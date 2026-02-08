import { describe, expect, it } from "vitest";
import { buildContainmentKit, renderContainmentKitScript } from "../lib/remediate/containment-kit";
import type { SecurityPosture } from "../lib/security-posture";
import type { RemediationAction } from "../lib/remediate/actions";

const baseAction: RemediationAction = {
  id: "lockdown-access-surface",
  priority: "P0",
  risk: "medium",
  title: "Lock Down SSH + Firewall Surface",
  why: "Critical config drift was detected.",
  sourceCodes: ["config_tamper"],
  commands: ["sudo ufw status verbose", "sudo nft list ruleset | sed -n '1,120p'"],
  rollbackNotes: ["Restore backup if needed."],
  requiresConfirm: true,
  confirmPhrase: "EXECUTE lockdown-access-surface",
};

function posture(overrides?: Partial<SecurityPosture>): SecurityPosture {
  return {
    score: 80,
    band: "critical",
    stage: "lockdown",
    nextMove: "Run lock-down now.",
    signalCount: 4,
    priorityCodes: ["config_tamper"],
    ...overrides,
  };
}

describe("containment kit", () => {
  it("builds critical profile for lockdown posture", () => {
    const kit = buildContainmentKit({
      hostName: "hel1-11",
      hostId: "h1",
      posture: posture(),
      actions: [baseAction],
      context: {
        publicPorts: [],
        unexpectedPublicPorts: [{ host: "157.180.114.124", port: 3333, proto: "tcp", proc: "python3" }],
      },
    });

    expect(kit.profile).toBe("critical");
    expect(kit.contain.some((line) => line.includes("Action: Lock Down SSH + Firewall Surface"))).toBe(true);
    expect(kit.contain.some((line) => line.includes("sudo ufw deny 3333/tcp"))).toBe(true);
  });

  it("falls back when no actions exist", () => {
    const kit = buildContainmentKit({
      hostName: "hel1-11",
      hostId: "h1",
      posture: posture({ score: 18, band: "low", stage: "observe" }),
      actions: [],
      context: { publicPorts: [], unexpectedPublicPorts: [] },
    });

    expect(kit.profile).toBe("standard");
    expect(kit.contain[0]).toContain("No mapped action set");
  });

  it("renders full script sections", () => {
    const kit = buildContainmentKit({
      hostName: "hel1-11",
      hostId: "h1",
      posture: posture(),
      actions: [baseAction],
      context: { publicPorts: [], unexpectedPublicPorts: [] },
    });
    const script = renderContainmentKitScript(kit);
    expect(script).toContain("# 1) Triage");
    expect(script).toContain("# 2) Contain");
    expect(script).toContain("# 3) Verify");
    expect(script).toContain("# 4) Recover");
  });
});
