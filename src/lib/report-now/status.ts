// /var/www/vps-sentry-web/src/lib/report-now/status.ts

import { promises as fs } from "node:fs";
import { readJsonSafe, sleep } from "./utils";
import type { StatusJson } from "./types";

export const TRIGGER_PATH = "/tmp/vps-sentry-report-now.json";
export const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";

// Keep API snappy (avoid nginx 504)
export const POLL_MAX_MS = 6_000;
export const POLL_STEP_MS = 400;

export type PollResult = {
  beforeTs: string | null;
  afterTs: string | null;
  refreshed: boolean;
  pollMs: number;
  status: StatusJson | null;
};

export async function triggerManualReport(params: {
  rid: string;
  requestedBy: string;
  reason?: string;
}) {
  const payload = {
    ts: new Date().toISOString(),
    rid: params.rid,
    requestedBy: params.requestedBy,
    reason: params.reason ?? "manual-report",
  };

  await fs.writeFile(TRIGGER_PATH, JSON.stringify(payload, null, 2), "utf8");
}

export async function pollStatus(beforeTs: string | null): Promise<PollResult> {
  const start = Date.now();
  let pollMs = 0;

  let after: StatusJson | null = null;

  while (Date.now() - start < POLL_MAX_MS) {
    await sleep(POLL_STEP_MS);
    after = await readJsonSafe<StatusJson>(STATUS_PATH);
    pollMs = Date.now() - start;

    if (after?.ts && after.ts !== beforeTs) break;
  }

  const afterTs = after?.ts ?? null;
  const refreshed = !!(afterTs && afterTs !== beforeTs);

  // Best snapshot we have
  const status = after ?? (await readJsonSafe<StatusJson>(STATUS_PATH)) ?? null;

  return { beforeTs, afterTs, refreshed, pollMs, status };
}
