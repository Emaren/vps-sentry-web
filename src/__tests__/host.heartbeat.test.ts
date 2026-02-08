import { describe, expect, it } from "vitest";
import {
  classifyHeartbeat,
  heartbeatLabel,
  readHeartbeatConfig,
} from "../lib/host-heartbeat";

describe("host heartbeat", () => {
  it("reads defaults when env is missing", () => {
    const cfg = readHeartbeatConfig({});
    expect(cfg.expectedMinutes).toBe(5);
    expect(cfg.staleAfterMinutes).toBe(15);
    expect(cfg.missingAfterMinutes).toBe(60);
  });

  it("classifies fresh/delayed/stale/missing", () => {
    const now = new Date("2026-02-07T06:00:00.000Z");
    const cfg = { expectedMinutes: 5, staleAfterMinutes: 15, missingAfterMinutes: 60 };

    expect(classifyHeartbeat(new Date("2026-02-07T05:57:00.000Z"), now, cfg).state).toBe("fresh");
    expect(classifyHeartbeat(new Date("2026-02-07T05:50:00.000Z"), now, cfg).state).toBe("delayed");
    expect(classifyHeartbeat(new Date("2026-02-07T05:40:00.000Z"), now, cfg).state).toBe("stale");
    expect(classifyHeartbeat(new Date("2026-02-07T04:00:00.000Z"), now, cfg).state).toBe("missing");
    expect(classifyHeartbeat(null, now, cfg).state).toBe("missing");
  });

  it("formats labels", () => {
    const now = new Date("2026-02-07T06:00:00.000Z");
    const cfg = { expectedMinutes: 5, staleAfterMinutes: 15, missingAfterMinutes: 60 };

    expect(heartbeatLabel(classifyHeartbeat(null, now, cfg))).toBe("Missing (never)");
    expect(heartbeatLabel(classifyHeartbeat(new Date("2026-02-07T05:58:00.000Z"), now, cfg))).toBe(
      "Fresh (2m)"
    );
  });
});
