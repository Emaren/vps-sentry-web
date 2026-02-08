import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canRunIncidentAction,
  computeIncidentTimers,
  incidentTimerPolicyForSeverity,
  normalizeIncidentSeverity,
  normalizeIncidentStateFilter,
  normalizePostmortemActionItems,
  normalizePostmortemStatus,
  parsePostmortemActionItems,
  serializePostmortemActionItems,
} from "@/lib/ops/incident-engine";

const TIMER_ENV_KEYS = [
  "VPS_INCIDENT_ACK_MINUTES_CRITICAL",
  "VPS_INCIDENT_ACK_MINUTES_HIGH",
  "VPS_INCIDENT_ACK_MINUTES_MEDIUM",
  "VPS_INCIDENT_ESCALATE_EVERY_MINUTES_CRITICAL",
  "VPS_INCIDENT_ESCALATE_EVERY_MINUTES_HIGH",
  "VPS_INCIDENT_ESCALATE_EVERY_MINUTES_MEDIUM",
] as const;

const originalEnv = new Map<string, string | undefined>();

describe("incident engine policy helpers", () => {
  beforeEach(() => {
    for (const key of TIMER_ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of TIMER_ENV_KEYS) {
      const prior = originalEnv.get(key);
      if (prior === undefined) delete process.env[key];
      else process.env[key] = prior;
    }
    originalEnv.clear();
  });

  it("normalizes severity/state/status values", () => {
    expect(normalizeIncidentSeverity("CRITICAL")).toBe("critical");
    expect(normalizeIncidentSeverity("medium")).toBe("medium");
    expect(normalizeIncidentSeverity("unknown")).toBeNull();

    expect(normalizeIncidentStateFilter("active")).toBe("active");
    expect(normalizeIncidentStateFilter("resolved")).toBe("resolved");
    expect(normalizeIncidentStateFilter("bad")).toBeNull();

    expect(normalizePostmortemStatus("draft")).toBe("draft");
    expect(normalizePostmortemStatus("PUBLISHED")).toBe("published");
    expect(normalizePostmortemStatus("invalid")).toBeNull();
  });

  it("normalizes postmortem action items and round-trips json", () => {
    const items = normalizePostmortemActionItems([
      {
        id: "a1",
        title: "Patch host baseline",
        owner: "ops@example.com",
        status: "in_progress",
        note: "tracking now",
      },
      {
        title: "  ",
      },
      {
        title: "Ship updated runbook",
        status: "invalid-status",
      },
    ]);

    expect(items.length).toBe(2);
    expect(items[0]?.id).toBe("a1");
    expect(items[0]?.status).toBe("in_progress");
    expect(items[1]?.status).toBe("open");

    const serialized = serializePostmortemActionItems(items);
    expect(serialized).toBeTruthy();
    const parsed = parsePostmortemActionItems(serialized);
    expect(parsed.length).toBe(2);
    expect(parsed[0]?.title).toBe("Patch host baseline");
    expect(parsed[1]?.title).toBe("Ship updated runbook");
  });

  it("uses severity defaults and env overrides for timers", () => {
    const defaultPolicy = incidentTimerPolicyForSeverity("critical");
    expect(defaultPolicy.ackMinutes).toBe(5);
    expect(defaultPolicy.escalationMinutes).toBe(10);

    process.env.VPS_INCIDENT_ACK_MINUTES_CRITICAL = "7";
    process.env.VPS_INCIDENT_ESCALATE_EVERY_MINUTES_CRITICAL = "14";

    const overridden = incidentTimerPolicyForSeverity("critical");
    expect(overridden.ackMinutes).toBe(7);
    expect(overridden.escalationMinutes).toBe(14);

    const now = new Date("2026-02-08T00:00:00.000Z");
    const timers = computeIncidentTimers({ severity: "critical", now });
    expect(timers.ackDueAt.toISOString()).toBe("2026-02-08T00:07:00.000Z");
    expect(timers.nextEscalationAt.toISOString()).toBe("2026-02-08T00:21:00.000Z");
  });

  it("enforces state transition guardrails", () => {
    expect(canRunIncidentAction("open", "acknowledge")).toBe(true);
    expect(canRunIncidentAction("resolved", "close")).toBe(true);
    expect(canRunIncidentAction("closed", "reopen")).toBe(true);

    expect(canRunIncidentAction("open", "close")).toBe(false);
    expect(canRunIncidentAction("closed", "note")).toBe(false);
    expect(canRunIncidentAction("closed", "step")).toBe(false);
  });
});
