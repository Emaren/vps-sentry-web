import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GarbageTile from "@/app/dashboard/_components/GarbageTile";

describe("GarbageTile", () => {
  it("renders reclaimable-space summary and action button", () => {
    const html = renderToStaticMarkup(
      <GarbageTile
        connected={true}
        streamLabel="snapshot"
        canReclaim={true}
        estimate={{
          schemaVersion: 1,
          measuredAt: "2026-02-09T00:00:00.000Z",
          ttlSeconds: 600,
          reclaimableBytesTotal: 812646400,
          safeReclaimableBytes: 812646400,
          garbageReclaimableBytes: 268435456,
          rebuildableBytes: 544210944,
          guidedReclaimableBytes: 0,
          blockedReclaimableBytes: 0,
          categoryTotals: [
            {
              key: "garbage",
              label: "Safe Cleanup",
              description: "Dead-weight junk.",
              bytes: 268435456,
              count: 12,
            },
            {
              key: "recycling",
              label: "Rebuildable Caches",
              description: "Caches that can regenerate.",
              bytes: 544210944,
              count: 7,
            },
          ],
          riskTotals: [
            {
              key: "safe",
              label: "Safe now",
              bytes: 812646400,
              count: 19,
            },
          ],
          buckets: [
            {
              key: "tmp_stale",
              label: "Stale /tmp files",
              bytes: 268435456,
              count: 12,
            },
            {
              key: "pkg_cache",
              label: "Package manager caches",
              bytes: 134217728,
              count: 4,
            },
          ],
          topPaths: [
            {
              path: "/tmp/tmp.drDlZXOgOZ",
              bytes: 269484032,
              bucket: "tmp_stale",
            },
          ],
          candidates: [
            {
              id: "tmp-1",
              key: "tmp_stale",
              label: "Stale /tmp files",
              path: "/tmp/tmp.drDlZXOgOZ",
              bytes: 269484032,
              action: "remove_path",
              kind: "path",
              category: "garbage",
              categoryLabel: "Safe Cleanup",
              risk: "safe",
              riskLabel: "Safe now",
              requiresStop: false,
              regrows: false,
              explanation: "Temporary scratch directory.",
              previewCommand: "du -sh /tmp/tmp.drDlZXOgOZ",
              executeCommand: "rm -rf /tmp/tmp.drDlZXOgOZ",
              projectId: null,
              projectLabel: null,
              projectUrl: null,
              serviceRefs: [],
            },
            {
              id: "cache-1",
              key: "pkg_cache",
              label: "Package manager caches",
              path: "/root/.npm",
              bytes: 134217728,
              action: "remove_path",
              kind: "path",
              category: "recycling",
              categoryLabel: "Rebuildable Caches",
              risk: "safe",
              riskLabel: "Safe now",
              requiresStop: false,
              regrows: true,
              explanation: "Package caches can be re-downloaded.",
              previewCommand: "du -sh /root/.npm",
              executeCommand: "rm -rf /root/.npm",
              projectId: null,
              projectLabel: null,
              projectUrl: null,
              serviceRefs: [],
            },
          ],
          runningCleanup: false,
          lastCleanupResult: {
            ok: true,
            startedAt: "2026-02-09T00:00:00.000Z",
            finishedAt: "2026-02-09T00:00:12.000Z",
            freedBytesEstimated: 693000000,
            freedBytesActual: 680000000,
            rootAvailableBeforeBytes: null,
            rootAvailableAfterBytes: null,
            deletedCount: 14,
            buckets: [],
            errors: [],
          },
          cleanupProgress: null,
        }}
      />
    );

    expect(html).toContain("Reclaimable Space");
    expect(html).toContain("Run Safe Reclaim");
    expect(html).toContain("Stale /tmp files");
    expect(html).toContain("Package manager caches");
    expect(html).toContain("Preview Targets");
  });

  it("renders cleanup progress details when a reclaim pass is running", () => {
    const html = renderToStaticMarkup(
      <GarbageTile
        connected={true}
        streamLabel="live"
        canReclaim={true}
        estimate={{
          schemaVersion: 1,
          measuredAt: "2026-02-09T00:00:00.000Z",
          ttlSeconds: 600,
          reclaimableBytesTotal: 812646400,
          safeReclaimableBytes: 812646400,
          garbageReclaimableBytes: 268435456,
          rebuildableBytes: 544210944,
          guidedReclaimableBytes: 0,
          blockedReclaimableBytes: 0,
          categoryTotals: [],
          riskTotals: [],
          buckets: [],
          topPaths: [],
          candidates: [],
          runningCleanup: true,
          lastCleanupResult: null,
          cleanupProgress: {
            startedAt: "2026-02-09T00:00:00.000Z",
            updatedAt: "2026-02-09T00:00:08.000Z",
            phase: "reclaiming",
            currentLabel: "VS Code cached VSIX downloads",
            currentTarget: "/root/.vscode-server/data/CachedExtensionVSIXs",
            currentCommand: "rm -rf /root/.vscode-server/data/CachedExtensionVSIXs",
            completedSteps: 1,
            totalSteps: 3,
            errorsCount: 0,
            etaSeconds: 12,
            recentLines: [
              "$ scan safe garbage candidates",
              "$ rm -rf /root/.vscode-server/data/CachedExtensionVSIXs",
            ],
          },
        }}
      />
    );

    expect(html).toContain("VS Code cached VSIX downloads");
    expect(html).toContain("1/3");
    expect(html).toContain("ETA ~ 12s");
    expect(html).toContain("$ rm -rf /root/.vscode-server/data/CachedExtensionVSIXs");
  });
});
