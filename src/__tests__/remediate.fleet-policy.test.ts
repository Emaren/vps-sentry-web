import { describe, expect, it } from "vitest";
import {
  applyFleetBlastRadiusSafeguards,
  buildFleetRolloutStages,
  hasFleetSelectorFilter,
  hostMatchesFleetSelector,
  mergeHostFleetPolicyMeta,
  normalizeFleetSelector,
  readHostFleetPolicyConfig,
  type FleetHostCandidate,
} from "@/lib/remediate/fleet-policy";

function mkHost(
  id: string,
  group: string | null,
  tags: string[],
  scopes: string[]
): FleetHostCandidate {
  const metaJson = mergeHostFleetPolicyMeta({
    currentMetaJson: null,
    patch: {
      group,
      tags,
      scopes,
      rolloutPaused: false,
      rolloutPriority: 0,
    },
  });
  return {
    id,
    name: id,
    enabled: true,
    lastSeenAt: new Date("2026-02-08T00:00:00.000Z"),
    metaJson,
    fleet: readHostFleetPolicyConfig(metaJson),
  };
}

describe("fleet policy helpers", () => {
  it("reads and merges host fleet policy metadata", () => {
    const merged = mergeHostFleetPolicyMeta({
      currentMetaJson: JSON.stringify({ remediationPolicy: { profile: "balanced" } }),
      patch: {
        group: "prod-core",
        tags: ["Web", "Primary"],
        scopes: ["internet-facing", "ssh"],
        rolloutPaused: true,
        rolloutPriority: 8,
      },
    });
    const fleet = readHostFleetPolicyConfig(merged);
    expect(fleet.group).toBe("prod-core");
    expect(fleet.tags).toEqual(["web", "primary"]);
    expect(fleet.scopes).toEqual(["internet-facing", "ssh"]);
    expect(fleet.rolloutPaused).toBe(true);
    expect(fleet.rolloutPriority).toBe(8);
  });

  it("matches hosts by selector filters", () => {
    const host = mkHost("h1", "prod", ["web", "eu"], ["internet-facing"]);
    const selector = normalizeFleetSelector({
      groups: ["prod"],
      tagsAll: ["web"],
      tagsAny: ["eu", "api"],
      scopesAll: ["internet-facing"],
      enabledOnly: true,
    });
    expect(hasFleetSelectorFilter(selector)).toBe(true);
    expect(hostMatchesFleetSelector(host, selector)).toBe(true);
    expect(
      hostMatchesFleetSelector(
        host,
        normalizeFleetSelector({ groups: ["staging"] })
      )
    ).toBe(false);
  });

  it("enforces blast-radius caps and reports rejected hosts", () => {
    const hosts = [
      mkHost("h1", "prod-a", ["web"], ["internet-facing"]),
      mkHost("h2", "prod-a", ["web"], ["internet-facing"]),
      mkHost("h3", "prod-b", ["api"], ["internet-facing"]),
      mkHost("h4", "prod-c", ["api"], ["internet-facing"]),
    ];

    const result = applyFleetBlastRadiusSafeguards({
      hosts,
      totalEnabledFleet: 10,
      maxHosts: 3,
      maxPerGroup: 1,
      maxPercentOfEnabledFleet: 50,
    });
    expect(result.accepted.map((x) => x.id)).toEqual(["h1", "h3", "h4"]);
    expect(result.rejected.some((x) => x.reason === "max_per_group")).toBe(true);
    expect(result.maxHostsEffective).toBe(3);
    expect(result.allowedByPercent).toBe(5);
  });

  it("builds staged rollout waves with group canary first", () => {
    const hosts = [
      mkHost("a-1", "a", ["x"], ["s"]),
      mkHost("a-2", "a", ["x"], ["s"]),
      mkHost("b-1", "b", ["x"], ["s"]),
      mkHost("b-2", "b", ["x"], ["s"]),
      mkHost("c-1", "c", ["x"], ["s"]),
    ];
    const waves = buildFleetRolloutStages(hosts, 2, "group_canary");
    expect(waves.length).toBeGreaterThanOrEqual(2);
    expect(waves[0]?.map((x) => x.id)).toEqual(["a-1", "b-1"]);
    expect(waves[1]?.map((x) => x.id)).toContain("c-1");
  });
});
