// /var/www/vps-sentry-web/src/app/dashboard/_components/status-popup/types.ts
import type { ActionSummary } from "../../_lib/explain";

export type Level = "ok" | "warn" | "bad";
export type Panel = null | "actions" | "explain" | "fix";

export type FixStepStatus = "idle" | "running" | "success" | "error";

export type FixStep = {
  id: string;
  label: string;
  status: FixStepStatus;
  detail?: string;
};

export type FixResult = { ok: boolean; message: string };

export type StatusActionPopupProps = {
  needsAction: boolean;
  headline: string; // "ACTION NEEDED" | "OK" | "ATTENTION"
  summary: ActionSummary;

  // meta (for the collapsed/expanded details)
  host: string;
  version: string;
  snapshotLabel: string;
  scanLabel: string;
  baselineLabel: string;
  signedInAs: string;

  // for status light + action inference
  level: Level;
  alertsCount: number;

  /**
   * IMPORTANT:
   * publicPortsCount is the *actionable* count (unexpected if present, else total fallback).
   * You may optionally pass the raw total + expected list for nicer messaging.
   */
  publicPortsCount: number;
  publicPortsTotalCount?: number;
  expectedPublicPorts?: string[] | null;

  stale: boolean;
};
