import { buildIncidentTimeline } from "@/lib/incident-signals";
import { buildRemediationActions, type RemediationAction } from "./actions";

export type SnapshotForRemediation = {
  id: string;
  ts: Date | string;
  status: Record<string, unknown>;
};

export type RemediationPlan = {
  actions: RemediationAction[];
  timelineCount: number;
  topCodes: string[];
};

export function buildRemediationPlanFromSnapshots(
  snapshots: SnapshotForRemediation[]
): RemediationPlan {
  const timelineResult = buildIncidentTimeline(snapshots);
  const actions = buildRemediationActions(timelineResult.timeline);
  const topCodes = Object.entries(timelineResult.summary.byCode)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([code]) => code);

  return {
    actions,
    timelineCount: timelineResult.timeline.length,
    topCodes,
  };
}
