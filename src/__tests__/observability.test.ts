import { beforeEach, describe, expect, it } from "vitest";
import {
  OBS_HEADER_CORRELATION_ID,
  OBS_HEADER_REQUEST_ID,
  OBS_HEADER_SPAN_ID,
  OBS_HEADER_TRACE_ID,
  ensureObservabilityHeaders,
  getObservabilitySnapshot,
  incrementCounter,
  observeTiming,
  renderPrometheusMetrics,
  runObservedRoute,
} from "@/lib/observability";

describe("observability core", () => {
  beforeEach(() => {
    const g = globalThis as unknown as { __vpsObservability?: unknown };
    g.__vpsObservability = undefined;
  });

  it("injects correlation and trace headers", () => {
    const out = ensureObservabilityHeaders(new Headers(), {
      route: "/api/test",
      method: "GET",
      source: "test",
    });

    expect(out.headers.get(OBS_HEADER_CORRELATION_ID)).toBe(out.context.correlationId);
    expect(out.headers.get(OBS_HEADER_TRACE_ID)).toBe(out.context.traceId);
    expect(out.headers.get(OBS_HEADER_SPAN_ID)).toBe(out.context.spanId);
    expect(out.headers.get(OBS_HEADER_REQUEST_ID)).toBe(out.context.correlationId);
  });

  it("records request metrics and applies response headers on observed route", async () => {
    const req = new Request("http://localhost:3035/api/test", {
      method: "GET",
      headers: {
        [OBS_HEADER_CORRELATION_ID]: "corr-test-123",
        [OBS_HEADER_TRACE_ID]: "trace-test-456",
      },
    });

    const res = await runObservedRoute(
      req,
      {
        route: "/api/test",
        source: "unit-test",
      },
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
    );

    expect(res.status).toBe(201);
    expect(res.headers.get(OBS_HEADER_CORRELATION_ID)).toBeTruthy();
    expect(res.headers.get(OBS_HEADER_TRACE_ID)).toBeTruthy();
    expect(res.headers.get("Server-Timing")).toContain("app;dur=");

    const snapshot = getObservabilitySnapshot({
      countersLimit: 100,
      timingsLimit: 100,
      logsLimit: 20,
      tracesLimit: 20,
      alertsLimit: 20,
    });

    expect(snapshot.counters.some((c) => c.name === "api.requests.total")).toBe(true);
    expect(snapshot.counters.some((c) => c.name === "api.requests.by_status.total")).toBe(true);
    expect(snapshot.timings.some((t) => t.name === "api.request.duration_ms")).toBe(true);
    expect(snapshot.recentTraces.length).toBeGreaterThan(0);
    expect(snapshot.recentLogs.length).toBeGreaterThan(0);
  });

  it("renders prometheus text for counters and timings", () => {
    incrementCounter("unit.counter.total", 3, { test: "obs" });
    observeTiming("unit.duration_ms", 12.4, { test: "obs" });

    const text = renderPrometheusMetrics();
    expect(text).toContain("vps_obs_counter");
    expect(text).toContain('name="unit.counter.total"');
    expect(text).toContain("vps_obs_timing_count");
    expect(text).toContain('name="unit.duration_ms"');
  });
});
