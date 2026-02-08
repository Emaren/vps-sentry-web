import { describe, expect, it } from "vitest";
import { readCommandGuardPolicy } from "../lib/remediate/guard";
import { readRemediationPolicy } from "../lib/remediate/policy";
import {
  mergeHostRemediationPolicyMeta,
  readHostRemediationPolicyConfig,
  resolveHostRemediationPolicy,
} from "../lib/remediate/host-policy";

describe("host remediation policy profiles", () => {
  it("defaults to balanced profile when host meta has no policy", () => {
    const globalPolicy = readRemediationPolicy();
    const globalGuardPolicy = readCommandGuardPolicy();

    const resolved = resolveHostRemediationPolicy({
      metaJson: null,
      globalPolicy,
      globalGuardPolicy,
    });

    expect(resolved.profile).toBe("balanced");
    expect(resolved.policy.maxExecutePerHour).toBe(globalPolicy.maxExecutePerHour);
    expect(resolved.guardPolicy.maxCommandsPerAction).toBe(
      globalGuardPolicy.maxCommandsPerAction
    );
  });

  it("applies strict profile defaults and host overrides", () => {
    const globalPolicy = readRemediationPolicy();
    const globalGuardPolicy = readCommandGuardPolicy();

    const metaJson = JSON.stringify({
      remediationPolicy: {
        profile: "strict",
        overrides: {
          maxExecutePerHour: 4,
          queueTtlMinutes: 75,
        },
        guardOverrides: {
          maxCommandLength: 420,
        },
      },
    });

    const resolved = resolveHostRemediationPolicy({
      metaJson,
      globalPolicy,
      globalGuardPolicy,
    });

    expect(resolved.profile).toBe("strict");
    expect(resolved.policy.executeCooldownMinutes).toBeGreaterThanOrEqual(10);
    expect(resolved.policy.maxExecutePerHour).toBe(4);
    expect(resolved.policy.queueTtlMinutes).toBe(75);
    expect(resolved.guardPolicy.maxCommandLength).toBe(420);
    expect(resolved.guardPolicy.enforceAllowlist).toBe(true);
  });

  it("merges and re-reads remediation policy meta", () => {
    const merged = mergeHostRemediationPolicyMeta({
      currentMetaJson: JSON.stringify({ region: "hel1" }),
      profile: "rapid",
      overrides: {
        maxQueuePerHost: 9,
        commandTimeoutMs: 33000,
      },
      guardOverrides: {
        maxCommandsPerAction: 28,
      },
    });

    const config = readHostRemediationPolicyConfig(merged);
    expect(config.profile).toBe("rapid");
    expect(config.overrides.maxQueuePerHost).toBe(9);
    expect(config.overrides.commandTimeoutMs).toBe(33000);
    expect(config.guardOverrides.maxCommandsPerAction).toBe(28);
  });
});
