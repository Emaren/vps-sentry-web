// /var/www/vps-sentry-web/src/app/dashboard/_components/sections/ChangesDebugSection.tsx
import React from "react";
import { fmt, safeJson } from "@/lib/status";
import Box from "../Box";
import JsonDetails from "../JsonDetails";

export default function ChangesDebugSection(props: {
  snapshotTs: string;
  envOk: boolean;
  envTs?: string;
  canonicalStatus: unknown;
  rawWarnings?: string[];
  rawPaths: unknown;
  diff?: unknown;
  raw: unknown;
}) {
  const { snapshotTs, envOk, envTs, canonicalStatus, rawWarnings, rawPaths, diff, raw } =
    props;

  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 18, marginBottom: 8 }}>Changes & Debug</h2>

      <Box>
        <div style={{ opacity: 0.65, fontSize: 12 }}>
          As-of: <b>{fmt(snapshotTs)}</b> · Envelope ok: <b>{envOk ? "true" : "false"}</b> ·
          Envelope ts: <b>{fmt(envTs)}</b>
        </div>

        <JsonDetails
          title="Canonical status.json (preferred)"
          subtitle="collapsed"
          jsonText={
            canonicalStatus !== undefined
              ? safeJson(canonicalStatus)
              : "— status not present in /api/status response"
          }
          defaultOpen={false}
        />

        <JsonDetails
          title="Warnings & Paths"
          subtitle="collapsed"
          jsonText={safeJson({ warnings: rawWarnings ?? null, paths: rawPaths ?? null })}
          defaultOpen={false}
        />

        <JsonDetails
          title="Changes / Diff"
          subtitle="collapsed"
          jsonText={diff !== undefined ? safeJson(diff) : "— diff not present in /api/status response"}
          defaultOpen={false}
        />

        <JsonDetails
          title="Raw /api/status payload"
          subtitle="collapsed"
          jsonText={safeJson(raw)}
          defaultOpen={false}
        />
      </Box>
    </section>
  );
}
