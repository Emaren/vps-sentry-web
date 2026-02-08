import { buildIncidentTimeline } from "@/lib/incident-signals";
import { buildRemediationActions, type RemediationAction } from "./actions";
import { deriveRemediationContextFromStatus, type RemediationContext } from "./context";

export type SnapshotForRemediation = {
  id: string;
  ts: Date | string;
  status: Record<string, unknown>;
};

export type RemediationPlan = {
  actions: RemediationAction[];
  timelineCount: number;
  topCodes: string[];
  context: RemediationContext;
};

function newestSnapshot(snapshots: SnapshotForRemediation[]): SnapshotForRemediation | null {
  if (!snapshots.length) return null;
  let newest = snapshots[0];
  let newestTs = new Date(newest.ts).getTime();
  for (const snap of snapshots.slice(1)) {
    const ts = new Date(snap.ts).getTime();
    if (Number.isFinite(ts) && ts > newestTs) {
      newest = snap;
      newestTs = ts;
    }
  }
  return newest;
}

export function buildRemediationPlanFromSnapshots(
  snapshots: SnapshotForRemediation[],
  opts?: { dedupeWindowMinutes?: number }
): RemediationPlan {
  const timelineResult = buildIncidentTimeline(snapshots, {
    dedupeWindowMinutes: opts?.dedupeWindowMinutes,
  });
  const latest = newestSnapshot(snapshots);
  const context = latest
    ? deriveRemediationContextFromStatus(latest.status)
    : { unexpectedPublicPorts: [], publicPorts: [] };
  const actions = buildRemediationActions(timelineResult.timeline, context);
  const topCodes = Object.entries(timelineResult.summary.byCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code]) => code);

  return {
    actions,
    timelineCount: timelineResult.timeline.length,
    topCodes,
    context,
  };
}
