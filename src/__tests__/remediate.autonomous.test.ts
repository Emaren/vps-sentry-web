import { describe, expect, it } from "vitest";
import {
  canaryPercentForTier,
  isAutoExecutableTier,
  normalizeApprovalRiskThreshold,
  normalizeRemediationAutoTier,
  riskRequiresApproval,
  shouldSelectCanary,
  stableCanaryBucket,
} from "@/lib/remediate/autonomous";

describe("remediation autonomous helpers", () => {
  it("normalizes auto tiers and approval thresholds", () => {
    expect(normalizeRemediationAutoTier("GUARDED_AUTO")).toBe("guarded_auto");
    expect(normalizeRemediationAutoTier("unknown")).toBe("safe_auto");
    expect(normalizeApprovalRiskThreshold("high", "medium")).toBe("high");
    expect(normalizeApprovalRiskThreshold("invalid", "medium")).toBe("medium");
  });

  it("checks tier executability and risk approval thresholds", () => {
    expect(isAutoExecutableTier("safe_auto", "guarded_auto")).toBe(true);
    expect(isAutoExecutableTier("guarded_auto", "safe_auto")).toBe(false);
    expect(isAutoExecutableTier("observe", "risky_manual")).toBe(false);

    expect(riskRequiresApproval("low", "medium")).toBe(false);
    expect(riskRequiresApproval("medium", "medium")).toBe(true);
    expect(riskRequiresApproval("high", "none")).toBe(false);
  });

  it("derives canary rollout and deterministic host/action buckets", () => {
    expect(canaryPercentForTier("safe_auto", 25)).toBe(100);
    expect(canaryPercentForTier("guarded_auto", 25)).toBe(25);
    expect(canaryPercentForTier("observe", 25)).toBe(0);

    const b1 = stableCanaryBucket("host-a::action-a");
    const b2 = stableCanaryBucket("host-a::action-a");
    expect(b1).toBe(b2);

    expect(shouldSelectCanary("host-a", "action-a", 0)).toEqual({
      bucket: 99,
      selected: false,
    });
    expect(shouldSelectCanary("host-a", "action-a", 100)).toEqual({
      bucket: 0,
      selected: true,
    });
  });
});
