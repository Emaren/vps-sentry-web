import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PowerMemoryTile from "@/app/dashboard/_components/PowerMemoryTile";
import type { DerivedDashboard } from "@/app/dashboard/_lib/derive";

function makeDerived(): DerivedDashboard {
  return {
    snapshotTs: "2026-05-12T12:42:20.000Z",
    ageMin: 1,
    stale: false,
    needsAction: true,
    headline: "ACTION NEEDED",
    level: "bad",
    actionSummary: {
      needsAction: true,
      headline: "ACTION NEEDED",
      reasons: [],
      items: [],
    },
    scanLabel: "Age: 1m",
    alertsTotalCount: 1,
    alertsCount: 1,
    alertsForAction: [],
    alertsSuppressedCount: 0,
    alertsSuppressed: [],
    topAlertSeverity: "critical",
    maintenanceActive: false,
    publicPortsTotalCount: 0,
    publicPortsCount: 0,
    unexpectedPublicPortsCount: 0,
    expectedPublicPorts: null,
    portsPublicForAction: [],
    portsLocal: [],
    portsPublic: [],
    garbageEstimate: {
      schemaVersion: 2,
      measuredAt: "2026-05-12T12:42:38.000Z",
      ttlSeconds: 600,
      reclaimableBytesTotal: 0,
      safeReclaimableBytes: 0,
      garbageReclaimableBytes: 0,
      rebuildableBytes: 0,
      guidedReclaimableBytes: 0,
      blockedReclaimableBytes: 0,
      categoryTotals: [],
      riskTotals: [],
      buckets: [],
      topPaths: [],
      candidates: [],
      runningCleanup: false,
      lastCleanupResult: null,
      cleanupProgress: null,
    },
    breachesOpen: null,
    breachesFixed: null,
    breaches: null,
    hasBreachSignals: false,
    shipping: undefined,
    hasShippingSignals: false,
    hasVitals: true,
    cpuUsedPercent: 100,
    cpuCapacityPercent: 100,
    cpuCores: 4,
    memoryUsedPercent: 82,
    memoryCapacityPercent: 100,
    memoryUsedMb: 6368,
    memoryTotalMb: 7750,
    memoryAvailableMb: 1381,
    vitalsSampledCount: 5,
    vitalsCpuShareTotalPercent: 100,
    vitalsProcesses: [
      {
        pid: 1234,
        name: "cpu-logind",
        friendlyName: "cpu-logind",
        secondaryText: "pid 1234",
        detailTitle: "unit aoe2dewarwagers-web.service",
        ports: [],
        unit: "aoe2dewarwagers-web.service",
        exe: null,
        cmdline: null,
        cwd: null,
        project: null,
        serviceKind: null,
        cpuSharePercent: 94,
        cpuCapacityPercent: 94,
        memoryMb: 2300,
        memoryCapacityPercent: 30,
        isOther: false,
      },
    ],
    canonicalStatus: {
      project_storage: {
        measured_at: "2026-05-12T12:42:21Z",
        ttl_seconds: 600,
        host_filesystem: {
          path: "/",
          measured_at: "2026-05-12T12:42:21Z",
          total_bytes: 39973924864,
          used_bytes: 37914013696,
          available_bytes: 2059911168,
          used_percent: 94.8,
          warn_percent: 85,
          fail_percent: 92,
          level: "critical",
        },
        projects: {
          "vps-sentry": {
            measured_at: "2026-05-12T12:42:21Z",
            disk_bytes: 947544064,
            apparent_bytes: 947544064,
            file_count: 34382,
            delta_disk_bytes: 4096,
            roots_configured: 1,
            roots_present: 1,
            buckets: {},
            largest_dirs: [{ label: "VPSSentry/vps-sentry-web/node_modules", disk_bytes: 907390976 }],
            roots: [],
          },
        },
      },
    },
    rawWarnings: undefined,
    rawPaths: undefined,
    footerLinks: {
      discord: "#",
      contact: "#",
      facebook: "#",
      x: "#",
      tokentap: "#",
      tmail: "#",
    },
  };
}

describe("PowerMemoryTile", () => {
  it("renders the Sentry diagnosis panel for root pressure with no safe reclaim", () => {
    const html = renderToStaticMarkup(<PowerMemoryTile derived={makeDerived()} canReclaim={true} />);

    expect(html).toContain("Sentry Diagnosis");
    expect(html).toContain("Root disk above fail line");
    expect(html).toContain("Safe reclaim catalog is empty");
    expect(html).toContain("Scan Now");
    expect(html).toContain("Safe Reclaim Empty");
  });

  it("renders guided dependency reclaim as a deliberate plan, not a safe zap", () => {
    const derived = makeDerived();
    derived.garbageEstimate = {
      ...derived.garbageEstimate!,
      reclaimableBytesTotal: 1513575117,
      guidedReclaimableBytes: 1513575117,
      candidates: [
        {
          id: "guided_review:/var/www/AoE2HDBets/app-prodn/node_modules",
          key: "guided_node_modules",
          label: "Large dependency trees",
          path: "/var/www/AoE2HDBets/app-prodn/node_modules",
          bytes: 1513575117,
          action: "guided_review",
          kind: "directory",
          category: "guided",
          categoryLabel: "Guided Reclaim",
          risk: "guided",
          riskLabel: "Guided",
          requiresStop: true,
          regrows: true,
          explanation: "Large dependency tree on the root filesystem.",
          previewCommand: "du -sh /var/www/AoE2HDBets/app-prodn/node_modules",
          executeCommand: "guided_review",
          projectId: "aoe2hdbets",
          projectLabel: "AoE2HDBets",
          projectUrl: "https://aoe2hdbets.com",
          serviceRefs: ["aoe2hdbets-web.service"],
        },
      ],
    };

    const html = renderToStaticMarkup(<PowerMemoryTile derived={derived} canReclaim={true} />);

    expect(html).toContain("Guided Reclaim Cockpit");
    expect(html).toContain("Review Guided");
    expect(html).toContain("AoE2HDBets");
    expect(html).toContain("aoe2hdbets-web.service");
    expect(html).toContain("Guided deletion is intentionally locked");
  });
});
