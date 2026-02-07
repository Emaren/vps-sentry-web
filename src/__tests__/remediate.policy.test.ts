import { describe, expect, it } from "vitest";
import { isWithinMinutes } from "../lib/remediate/policy";

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
});
