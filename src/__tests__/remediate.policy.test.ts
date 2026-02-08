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
      maxRetryAttempts: process.env.VPS_REMEDIATE_MAX_RETRY_ATTEMPTS,
      retryBackoffSeconds: process.env.VPS_REMEDIATE_RETRY_BACKOFF_SECONDS,
      retryBackoffMaxSeconds: process.env.VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS,
      timeoutMs: process.env.VPS_REMEDIATE_COMMAND_TIMEOUT_MS,
      maxBufferBytes: process.env.VPS_REMEDIATE_MAX_BUFFER_BYTES,
      queueAutoDrain: process.env.VPS_REMEDIATE_QUEUE_AUTODRAIN,
      autonomousEnabled: process.env.VPS_REMEDIATE_AUTONOMOUS_ENABLED,
      autonomousMaxTier: process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_TIER,
      autonomousPerCycle: process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_CYCLE,
      autonomousPerHour: process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_HOUR,
      approvalRiskThreshold: process.env.VPS_REMEDIATE_APPROVAL_RISK_THRESHOLD,
      canaryRolloutPercent: process.env.VPS_REMEDIATE_CANARY_ROLLOUT_PERCENT,
      canaryRequireChecks: process.env.VPS_REMEDIATE_CANARY_REQUIRE_CHECKS,
      autoRollback: process.env.VPS_REMEDIATE_AUTO_ROLLBACK,
    };

    process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES = "45";
    process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES = "0";
    process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR = "9999";
    process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES = "2";
    process.env.VPS_REMEDIATE_MAX_QUEUE_PER_HOST = "3";
    process.env.VPS_REMEDIATE_MAX_QUEUE_TOTAL = "900";
    process.env.VPS_REMEDIATE_QUEUE_TTL_MINUTES = "95";
    process.env.VPS_REMEDIATE_MAX_RETRY_ATTEMPTS = "6";
    process.env.VPS_REMEDIATE_RETRY_BACKOFF_SECONDS = "20";
    process.env.VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS = "900";
    process.env.VPS_REMEDIATE_COMMAND_TIMEOUT_MS = "25000";
    process.env.VPS_REMEDIATE_MAX_BUFFER_BYTES = "750000";
    process.env.VPS_REMEDIATE_QUEUE_AUTODRAIN = "0";
    process.env.VPS_REMEDIATE_AUTONOMOUS_ENABLED = "1";
    process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_TIER = "guarded_auto";
    process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_CYCLE = "3";
    process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_HOUR = "22";
    process.env.VPS_REMEDIATE_APPROVAL_RISK_THRESHOLD = "high";
    process.env.VPS_REMEDIATE_CANARY_ROLLOUT_PERCENT = "35";
    process.env.VPS_REMEDIATE_CANARY_REQUIRE_CHECKS = "0";
    process.env.VPS_REMEDIATE_AUTO_ROLLBACK = "0";

    const policy = readRemediationPolicy();
    expect(policy.dryRunMaxAgeMinutes).toBe(45);
    expect(policy.executeCooldownMinutes).toBe(0);
    expect(policy.maxExecutePerHour).toBe(500);
    expect(policy.timelineDedupeWindowMinutes).toBe(2);
    expect(policy.maxQueuePerHost).toBe(3);
    expect(policy.maxQueueTotal).toBe(900);
    expect(policy.queueTtlMinutes).toBe(95);
    expect(policy.maxRetryAttempts).toBe(6);
    expect(policy.retryBackoffSeconds).toBe(20);
    expect(policy.retryBackoffMaxSeconds).toBe(900);
    expect(policy.commandTimeoutMs).toBe(25000);
    expect(policy.maxBufferBytes).toBe(750000);
    expect(policy.queueAutoDrain).toBe(false);
    expect(policy.autonomousEnabled).toBe(true);
    expect(policy.autonomousMaxTier).toBe("guarded_auto");
    expect(policy.autonomousMaxQueuedPerCycle).toBe(3);
    expect(policy.autonomousMaxQueuedPerHour).toBe(22);
    expect(policy.approvalRiskThreshold).toBe("high");
    expect(policy.canaryRolloutPercent).toBe(35);
    expect(policy.canaryRequireChecks).toBe(false);
    expect(policy.autoRollback).toBe(false);

    process.env.VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES = original.dryRun;
    process.env.VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES = original.cooldown;
    process.env.VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR = original.perHour;
    process.env.VPS_SIGNAL_DEDUPE_WINDOW_MINUTES = original.dedupe;
    process.env.VPS_REMEDIATE_MAX_QUEUE_PER_HOST = original.queuePerHost;
    process.env.VPS_REMEDIATE_MAX_QUEUE_TOTAL = original.queueTotal;
    process.env.VPS_REMEDIATE_QUEUE_TTL_MINUTES = original.queueTtl;
    process.env.VPS_REMEDIATE_MAX_RETRY_ATTEMPTS = original.maxRetryAttempts;
    process.env.VPS_REMEDIATE_RETRY_BACKOFF_SECONDS = original.retryBackoffSeconds;
    process.env.VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS = original.retryBackoffMaxSeconds;
    process.env.VPS_REMEDIATE_COMMAND_TIMEOUT_MS = original.timeoutMs;
    process.env.VPS_REMEDIATE_MAX_BUFFER_BYTES = original.maxBufferBytes;
    process.env.VPS_REMEDIATE_QUEUE_AUTODRAIN = original.queueAutoDrain;
    process.env.VPS_REMEDIATE_AUTONOMOUS_ENABLED = original.autonomousEnabled;
    process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_TIER = original.autonomousMaxTier;
    process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_CYCLE = original.autonomousPerCycle;
    process.env.VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_HOUR = original.autonomousPerHour;
    process.env.VPS_REMEDIATE_APPROVAL_RISK_THRESHOLD = original.approvalRiskThreshold;
    process.env.VPS_REMEDIATE_CANARY_ROLLOUT_PERCENT = original.canaryRolloutPercent;
    process.env.VPS_REMEDIATE_CANARY_REQUIRE_CHECKS = original.canaryRequireChecks;
    process.env.VPS_REMEDIATE_AUTO_ROLLBACK = original.autoRollback;
  });
});
