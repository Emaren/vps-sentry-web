import { describe, expect, it } from "vitest";
import { normalizeStatusEnvelope } from "../lib/status";
import type { Status } from "../lib/status";

describe("normalizeStatusEnvelope", () => {
  it("normalizes raw status payload", () => {
    const out = normalizeStatusEnvelope({
      host: "test-host",
      version: "1.0.0",
      ts: "2026-02-07T00:00:00.000Z",
      alerts_count: 2,
      alerts: [{ title: "A" }, { title: "B" }],
      public_ports_count: 1,
      ports_public: [],
      vitals: {
        cpu: { used_percent: 47.2, capacity_percent: 100, cores: 2 },
      },
    } as Status);

    expect(out.last.host).toBe("test-host");
    expect(out.last.alerts_count).toBe(2);
    expect(out.last.public_ports_count).toBe(1);
    expect(out.last.vitals?.cpu?.used_percent).toBe(47.2);
  });
});
