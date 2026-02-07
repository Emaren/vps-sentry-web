import { describe, expect, it } from "vitest";
import { parseIngestPayload } from "../lib/host-ingest";

describe("host ingest payload parsing", () => {
  it("rejects invalid JSON", () => {
    const out = parseIngestPayload("{");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(400);
  });

  it("parses raw status payload and computes counts", () => {
    const out = parseIngestPayload(
      JSON.stringify({
        host: "ubuntu-4gb-hel1-11",
        version: "1.0.0",
        ts: "2026-02-07T01:45:07.430Z",
        alerts: [{ title: "A" }, { title: "B" }],
        public_ports_count: 2,
        unexpected_public_ports_count: 1,
        expected_public_ports: ["udp:68"],
      }),
      {
        now: new Date("2026-02-07T01:45:30.000Z"),
      }
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.alertsCount).toBe(2);
    expect(out.publicPortsTotalCount).toBe(2);
    expect(out.publicPortsCount).toBe(1);
    expect(out.expectedPublicPorts).toEqual(["udp:68"]);
    expect(typeof out.payloadHash).toBe("string");
    expect(out.payloadHash.length).toBe(64);
  });

  it("warns on high clock skew", () => {
    const out = parseIngestPayload(
      JSON.stringify({
        host: "x",
        version: "1.0.0",
        ts: "2026-02-07T00:00:00.000Z",
      }),
      {
        now: new Date("2026-02-07T03:00:00.000Z"),
        env: {
          VPS_INGEST_MAX_CLOCK_SKEW_MINUTES: "30",
        },
      }
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings.some((w) => w.startsWith("ingest_clock_skew_high:"))).toBe(true);
  });
});
