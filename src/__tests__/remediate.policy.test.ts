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
      queuePerHost: process.env.VPS_REMEDIATE_MAX_QUEUE_PER_HOST,
      queueTotal: process.env.VPS_REMEDIATE_MAX_QUEUE_TOTAL,
      queueTtl: process.env.VPS_REMEDIATE_QUEUE_TTL_MINUTES,
      timeoutMs: process.env.VPS_REMEDIATE_COMMAND_TIMEOUT_MS,
      maxBufferBytes: process.env.VPS_REMEDIATE_MAX_BUFFER_BYTES,
      queueAutoDrain: process.env.VPS_REMEDIATE_QUEUE_AUTODRAIN,
    };

    process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES = "45";
    process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES = "0";
    process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR = "9999";
    process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES = "2";
    process.env.VPS_REMEDIATE_MAX_QUEUE_PER_HOST = "3";
    process.env.VPS_REMEDIATE_MAX_QUEUE_TOTAL = "900";
    process.env.VPS_REMEDIATE_QUEUE_TTL_MINUTES = "95";
    process.env.VPS_REMEDIATE_COMMAND_TIMEOUT_MS = "25000";
    process.env.VPS_REMEDIATE_MAX_BUFFER_BYTES = "750000";
    process.env.VPS_REMEDIATE_QUEUE_AUTODRAIN = "0";

    const policy = readRemediationPolicy();
    expect(policy.dryRunMaxAgeMinutes).toBe(45);
    expect(policy.executeCooldownMinutes).toBe(0);
    expect(policy.maxExecutePerHour).toBe(500);
    expect(policy.timelineDedupeWindowMinutes).toBe(2);
    expect(policy.maxQueuePerHost).toBe(3);
    expect(policy.maxQueueTotal).toBe(900);
    expect(policy.queueTtlMinutes).toBe(95);
    expect(policy.commandTimeoutMs).toBe(25000);
    expect(policy.maxBufferBytes).toBe(750000);
    expect(policy.queueAutoDrain).toBe(false);

    process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES = original.dryRun;
    process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES = original.cooldown;
    process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR = original.perHour;
    process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES = original.dedupe;
    process.env.VPS_REMEDIATE_MAX_QUEUE_PER_HOST = original.queuePerHost;
    process.env.VPS_REMEDIATE_MAX_QUEUE_TOTAL = original.queueTotal;
    process.env.VPS_REMEDIATE_QUEUE_TTL_MINUTES = original.queueTtl;
    process.env.VPS_REMEDIATE_COMMAND_TIMEOUT_MS = original.timeoutMs;
    process.env.VPS_REMEDIATE_MAX_BUFFER_BYTES = original.maxBufferBytes;
    process.env.VPS_REMEDIATE_QUEUE_AUTODRAIN = original.queueAutoDrain;
  });
});
