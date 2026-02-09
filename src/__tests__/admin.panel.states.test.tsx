import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminOpsPanel from "@/app/admin/AdminOpsPanel";
import {
  panelError,
  panelForbidden,
  panelReady,
} from "@/app/dashboard/_lib/panel-health";
import type { DashboardPanelHealth } from "@/app/dashboard/_lib/types";

function ready(): DashboardPanelHealth {
  return panelReady("ok", "2026-02-09T00:00:00.000Z");
}

function baseProps() {
  const ok = ready();
  return {
    workflows: [],
    recentOps: [],
    queueSnapshot: null,
    observabilitySnapshot: null,
    sloSnapshot: null,
    incidentSnapshot: null,
    initialIncidentDetail: null,
    panelHealth: {
      users: ok,
      hosts: ok,
      recentOps: ok,
      queue: ok,
      observability: ok,
      slo: ok,
      incidents: ok,
      incidentDetail: ok,
    },
    incidentAssignees: [],
    hostOptions: [],
    currentIdentity: {
      userId: "user-1",
      email: "owner@example.com",
      role: "owner" as const,
    },
  };
}

describe("admin panel states", () => {
  it("shows explicit queue error state and hides queue rows when blocked", () => {
    const props = baseProps();
    props.panelHealth.queue = panelError("queue backend offline");
    const html = renderToStaticMarkup(<AdminOpsPanel {...props} />);
    expect(html).toContain("Queue / DLQ Visibility");
    expect(html).toContain("Data unavailable");
    expect(html).toContain("queue backend offline");
    expect(html).not.toContain("No queue items for selected filter.");
  });

  it("shows explicit incident forbidden state and does not render incident engine controls", () => {
    const props = baseProps();
    props.panelHealth.incidents = panelForbidden("ops role required");
    props.panelHealth.incidentDetail = panelForbidden("ops role required");
    const html = renderToStaticMarkup(<AdminOpsPanel {...props} />);
    expect(html).toContain("Incident Workflow Engine v2");
    expect(html).toContain("Access required");
    expect(html).toContain("ops role required");
    expect(html).not.toContain("Create Incident");
  });
});

