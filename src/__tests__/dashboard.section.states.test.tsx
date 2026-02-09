import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BreachesSection from "@/app/dashboard/_components/sections/BreachesSection";
import ShippingSection from "@/app/dashboard/_components/sections/ShippingSection";
import RemediationsSection from "@/app/dashboard/_components/sections/RemediationsSection";
import CommandCenterSection from "@/app/dashboard/_components/sections/CommandCenterSection";
import AdaptiveSection from "@/app/dashboard/_components/sections/AdaptiveSection";
import MissionControlSection from "@/app/dashboard/_components/sections/MissionControlSection";
import type { DashboardOpsSnapshot } from "@/app/dashboard/_lib/types";
import {
  panelEmpty,
  panelError,
  panelForbidden,
  panelReady,
} from "@/app/dashboard/_lib/panel-health";

function baseOps(): DashboardOpsSnapshot {
  const ready = panelReady("ok", "2026-02-09T00:00:00.000Z");
  return {
    generatedAtIso: "2026-02-09T00:00:00.000Z",
    access: {
      role: "owner",
      canOps: true,
      canAdmin: true,
    },
    panelHealth: {
      breaches: ready,
      shipping: ready,
      remediation: ready,
      queue: ready,
      incidents: ready,
      slo: ready,
      observability: ready,
      fleet: ready,
      keyLifecycle: ready,
      adaptive: ready,
    },
    workflows: null,
    queue: null,
    incidents: null,
    slo: null,
    observability: null,
    fleet: null,
    keyLifecycle: null,
    breaches: null,
    shipping: null,
    remediation: null,
    adaptive: null,
  };
}

describe("dashboard section panel states", () => {
  it("renders explicit error state for shipping section", () => {
    const ops = baseOps();
    ops.panelHealth.shipping = panelError("shipping backend offline");
    const html = renderToStaticMarkup(
      <ShippingSection
        derived={{ shipping: null } as never}
        ops={ops}
        snapshotTs="2026-02-09T00:00:00.000Z"
      />
    );
    expect(html).toContain("Data unavailable");
    expect(html).toContain("shipping backend offline");
  });

  it("renders explicit empty state for breach section", () => {
    const ops = baseOps();
    ops.panelHealth.breaches = panelEmpty("no breach rows");
    ops.breaches = {
      counts: { total: 0, open: 0, fixed: 0, ignored: 0 },
      recent: [],
    };
    const html = renderToStaticMarkup(
      <BreachesSection
        derived={{ breachesOpen: 0, breachesFixed: 0 } as never}
        ops={ops}
        snapshotTs="2026-02-09T00:00:00.000Z"
      />
    );
    expect(html).toContain("No records in this window");
    expect(html).toContain("No breach records yet for this account.");
  });

  it("renders remediation run rows when panel is ready", () => {
    const ops = baseOps();
    ops.remediation = {
      counts: {
        total: 1,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        canceled: 0,
        dlq: 0,
        approvalPending: 0,
        retryScheduled: 0,
        autoQueued: 0,
      },
      recentRuns: [
        {
          runId: "run-1",
          hostId: "host-1",
          hostName: "host-1",
          actionKey: "lockdown",
          actionTitle: "Lock Down SSH",
          state: "succeeded",
          requestedAt: "2026-02-09T00:00:00.000Z",
          startedAt: null,
          finishedAt: "2026-02-09T00:00:05.000Z",
          requestedByEmail: "ops@example.com",
          attempts: 1,
          maxAttempts: 3,
          dlq: false,
          approvalPending: false,
          retryScheduled: false,
          canaryPassed: true,
          rollbackAttempted: false,
          rollbackSucceeded: null,
          autoQueued: false,
          autoTier: null,
          error: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <RemediationsSection ops={ops} snapshotTs="2026-02-09T00:00:00.000Z" />
    );
    expect(html).toContain("Lock Down SSH");
    expect(html).toContain("succeeded");
  });

  it("renders explicit forbidden state for command center", () => {
    const ops = baseOps();
    ops.panelHealth.incidents = panelForbidden("ops role required");
    const html = renderToStaticMarkup(
      <CommandCenterSection ops={ops} snapshotTs="2026-02-09T00:00:00.000Z" />
    );
    expect(html).toContain("Access required");
    expect(html).toContain("Ops role required");
  });

  it("renders adaptive recommendations when connected", () => {
    const ops = baseOps();
    ops.adaptive = {
      generatedAtIso: "2026-02-09T00:00:00.000Z",
      correlations: [],
      recommendations: [
        {
          id: "adaptive-test",
          priority: "high",
          title: "Tighten SSH guard",
          why: "Detected repeated SSH invalid-user pattern",
          suggestedAction: "Raise guard profile",
          evidence: ["ssh_invalid_user: 8"],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <AdaptiveSection ops={ops} snapshotTs="2026-02-09T00:00:00.000Z" />
    );
    expect(html).toContain("Tighten SSH guard");
    expect(html).toContain("ssh_invalid_user: 8");
  });

  it("renders explicit forbidden state for mission-control queue panel", () => {
    const ops = baseOps();
    ops.panelHealth.queue = panelForbidden("ops role required");
    const html = renderToStaticMarkup(
      <MissionControlSection ops={ops} snapshotTs="2026-02-09T00:00:00.000Z" />
    );
    expect(html).toContain("Mission Control");
    expect(html).toContain("Access required");
    expect(html).toContain("ops role required");
  });

  it("renders queue metrics in mission-control when queue runtime is connected", () => {
    const ops = baseOps();
    ops.queue = {
      limit: 30,
      dlqOnly: false,
      counts: {
        queued: 1,
        running: 2,
        succeeded: 5,
        failed: 0,
        canceled: 0,
        dlq: 0,
        retryScheduled: 0,
        approvalPending: 1,
      },
      items: [],
    };
    const html = renderToStaticMarkup(
      <MissionControlSection ops={ops} snapshotTs="2026-02-09T00:00:00.000Z" />
    );
    expect(html).toContain("queued 1");
    expect(html).toContain("running 2");
    expect(html).toContain("approvals 1");
  });
});
