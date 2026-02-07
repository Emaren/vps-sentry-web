import { describe, expect, it } from "vitest";
import { isWithinMinutes, readRemediationPolicy } from "../lib/remediate/policy";

describe("remediation policy helpers", () => {
  it("treats timestamps within window as valid", () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    const ts = new Date("2026-02-07T11:45:30.000Z");
    expect(isWithinMinutes(ts, 30, now)).toBe(true);
  });

  it("treats timestamps outside window as invalid", () => {
    const now = new Date("2026-02-07T12:00:00.000Z");
    const ts = new Date("2026-02-07T11:10:00.000Z");
    expect(isWithinMinutes(ts, 30, now)).toBe(false);
  });

  it("reads and clamps remediation policy env values", () => {
    const original = {
      dryRun: process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES,
      cooldown: process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES,
      perHour: process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR,
      dedupe: process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES,
    };

    process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES = "45";
    process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES = "0";
    process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR = "9999";
    process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES = "2";

    const policy = readRemediationPolicy();
    expect(policy.dryRunMaxAgeMinutes).toBe(45);
    expect(policy.executeCooldownMinutes).toBe(0);
    expect(policy.maxExecutePerHour).toBe(500);
    expect(policy.timelineDedupeWindowMinutes).toBe(2);

    process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES = original.dryRun;
    process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES = original.cooldown;
    process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR = original.perHour;
    process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES = original.dedupe;
  });
});
