import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  notificationEvent: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  host: {
    findMany: vi.fn(),
  },
  breach: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import { buildSloSnapshot, formatSloSummary } from "@/lib/slo";
import type { ObservabilitySnapshot } from "@/lib/observability";

const ORIGINAL_ENV = { ...process.env };

function makeTrace(
  tsIso: string,
  status: number
): ObservabilitySnapshot["recentTraces"][number] {
  return {
    ts: tsIso,
    name: "GET /api/status",
    status: status >= 500 ? "error" : "ok",
    durationMs: 12,
    correlationId: "corr_test",
    traceId: "trace_test",
    spanId: "span_test",
    parentSpanId: null,
    route: "/api/status",
    method: "GET",
    userId: null,
    hostId: null,
    attributes: {
      status,
    },
  };
}

function makeObservabilitySnapshot(
  nowIso: string,
  statuses: number[]
): ObservabilitySnapshot {
  return {
    generatedAtIso: nowIso,
    startedAtIso: nowIso,
    uptimeMs: 10_000,
    counters: [],
    timings: [],
    recentLogs: [],
    recentAlerts: [],
    recentTraces: statuses.map((status, idx) =>
      makeTrace(new Date(Date.parse(nowIso) - idx * 60_000).toISOString(), status)
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.VPS_SLO_AVAILABILITY_TARGET_PCT = "99.9";
  process.env.VPS_SLO_NOTIFY_DELIVERY_TARGET_PCT = "99";
  process.env.VPS_SLO_INGEST_FRESH_TARGET_PCT = "99";
  process.env.VPS_SLO_MTTD_TARGET_MINUTES = "5";
  process.env.VPS_SLO_MTTR_TARGET_MINUTES = "60";
  process.env.VPS_SLO_BURN_WARN = "6";
  process.env.VPS_SLO_BURN_CRITICAL = "14";
  process.env.VPS_SLO_ROUTE_WARN = "both";
  process.env.VPS_SLO_ROUTE_CRITICAL = "both";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("SLO snapshot + burn-rate", () => {
  it("returns healthy SLO status when objectives meet target", async () => {
    const now = new Date("2026-02-08T16:00:00.000Z");

    prismaMock.notificationEvent.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(8);
    prismaMock.host.findMany.mockResolvedValue([
      { id: "host_1", lastSeenAt: now },
    ]);
    prismaMock.breach.findMany
      .mockResolvedValueOnce([
        {
          id: "breach_open_1",
          hostId: "host_1",
          openedTs: new Date(now.getTime() - 4 * 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "breach_fixed_1",
          openedTs: new Date(now.getTime() - 20 * 60_000),
          fixedTs: new Date(now.getTime() - 5 * 60_000),
        },
      ]);
    prismaMock.breach.count.mockResolvedValue(0);
    prismaMock.notificationEvent.findMany.mockResolvedValue([
      {
        hostId: "host_1",
        createdAt: new Date(now.getTime() - 3 * 60_000),
      },
    ]);

    const snapshot = await buildSloSnapshot({
      now,
      observability: makeObservabilitySnapshot(now.toISOString(), [200, 200, 200, 200, 200]),
    });

    expect(snapshot.burn.severity).toBe("ok");
    expect(snapshot.burn.shouldAlert).toBe(false);
    expect(snapshot.burn.route).toBe("none");
    expect(snapshot.objectives.find((o) => o.key === "availability")?.status).toBe("ok");
    expect(snapshot.objectives.find((o) => o.key === "notify_delivery")?.status).toBe("ok");
    expect(snapshot.objectives.find((o) => o.key === "ingest_fresh_hosts")?.status).toBe("ok");
    expect(snapshot.objectives.find((o) => o.key === "mttd")?.status).toBe("ok");
    expect(snapshot.objectives.find((o) => o.key === "mttr")?.status).toBe("ok");

    const summary = formatSloSummary(snapshot);
    expect(summary).toContain("severity=ok");
    expect(summary).toContain("route=none");
  });

  it("elevates to critical when burn, MTTD/MTTR, and open breaches are out of bounds", async () => {
    const now = new Date("2026-02-08T16:00:00.000Z");
    process.env.VPS_SLO_ROUTE_CRITICAL = "email";
    process.env.VPS_SLO_BURN_WARN = "2";
    process.env.VPS_SLO_BURN_CRITICAL = "3";
    process.env.VPS_SLO_MTTD_TARGET_MINUTES = "5";
    process.env.VPS_SLO_MTTR_TARGET_MINUTES = "60";

    prismaMock.notificationEvent.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1);
    prismaMock.host.findMany.mockResolvedValue([
      { id: "host_2", lastSeenAt: null },
    ]);
    prismaMock.breach.findMany
      .mockResolvedValueOnce([
        {
          id: "breach_open_2",
          hostId: "host_2",
          openedTs: new Date(now.getTime() - 45 * 60_000),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "breach_fixed_2",
          openedTs: new Date(now.getTime() - 190 * 60_000),
          fixedTs: new Date(now.getTime() - 10 * 60_000),
        },
      ]);
    prismaMock.breach.count.mockResolvedValue(2);
    prismaMock.notificationEvent.findMany.mockResolvedValue([
      {
        hostId: "host_2",
        createdAt: new Date(now.getTime() - 5 * 60_000),
      },
    ]);

    const snapshot = await buildSloSnapshot({
      now,
      observability: makeObservabilitySnapshot(now.toISOString(), [500, 503, 500, 502, 500]),
    });

    expect(snapshot.burn.severity).toBe("critical");
    expect(snapshot.burn.shouldAlert).toBe(true);
    expect(snapshot.burn.route).toBe("email");
    expect(snapshot.burn.affectedObjectives.length).toBeGreaterThan(0);
    expect(snapshot.openBreachesOlderThanMttdTarget).toBe(2);

    const mttd = snapshot.objectives.find((o) => o.key === "mttd");
    const mttr = snapshot.objectives.find((o) => o.key === "mttr");
    expect(mttd?.status).toBe("breach");
    expect(mttr?.status).toBe("breach");
  });
});
