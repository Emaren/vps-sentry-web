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
          runningCleanup: false,
          lastCleanupResult: {
            ok: true,
            startedAt: "2026-02-09T00:00:00.000Z",
            finishedAt: "2026-02-09T00:00:12.000Z",
            freedBytesEstimated: 693000000,
            freedBytesActual: 680000000,
            deletedCount: 14,
            buckets: [],
            errors: [],
          },
        }}
      />
    );

    expect(html).toContain("Reclaimable Space");
    expect(html).toContain("Clear Safe Garbage");
    expect(html).toContain("Stale /tmp files");
    expect(html).toContain("Package manager caches");
  });
});
