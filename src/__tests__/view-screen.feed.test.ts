import { describe, expect, it } from "vitest";
import { buildViewScreenMessages, type ViewScreenModel } from "../app/dashboard/_lib/view-screen";

function baseInput(): ViewScreenModel {
  return {
    host: "ubuntu-4gb-hel1-11",
    version: "1.0.0",
    snapshotTs: "2026-02-17T00:00:00.000Z",
    snapshotAgeMin: 2,
    stale: false,
    alertsCount: 0,
    topAlertSeverity: "none",
    unexpectedPorts: 0,
    authFailed: 0,
    authInvalidUser: 0,
    threatSignals: 0,
    openBreaches: 0,
    incidentsOpen: 0,
    queueQueued: 0,
    queueDlq: 0,
    shippingFailed24h: 0,
  };
}

describe("buildViewScreenMessages", () => {
  it("includes all-clear mission control line when no active risk is present", () => {
    const out = buildViewScreenMessages(baseInput());

    expect(out.some((x) => x.id === "mission-control-all-clear")).toBe(true);
    expect(out.some((x) => x.sensor === "Bridge Core")).toBe(true);
  });

  it("raises explicit alert + port messages for risky state", () => {
    const out = buildViewScreenMessages({
      ...baseInput(),
      alertsCount: 4,
      topAlertSeverity: "critical",
      unexpectedPorts: 2,
    });

    expect(out.some((x) => x.id === "alert-radar" && x.tone === "bad")).toBe(true);
    expect(out.some((x) => x.id === "port-sentinel" && x.tone === "bad")).toBe(true);
  });

  it("marks queue feed as bad when DLQ is non-zero", () => {
    const out = buildViewScreenMessages({
      ...baseInput(),
      queueQueued: 3,
      queueDlq: 1,
    });

    const queue = out.find((x) => x.id === "response-queue");
    expect(queue).toBeDefined();
    expect(queue?.tone).toBe("bad");
  });
});
