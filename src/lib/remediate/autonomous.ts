import type { RemediationRisk } from "@/lib/remediate/actions";

export type RemediationAutoTier =
  | "observe"
  | "safe_auto"
  | "guarded_auto"
  | "risky_manual";

export type RemediationApprovalRiskThreshold = "none" | RemediationRisk;

const AUTO_TIER_ORDER: RemediationAutoTier[] = [
  "observe",
  "safe_auto",
  "guarded_auto",
  "risky_manual",
];

const RISK_ORDER: RemediationRisk[] = ["low", "medium", "high"];

function rankOf<T extends string>(order: readonly T[], value: T): number {
  const idx = order.indexOf(value);
  return idx >= 0 ? idx : 0;
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const t = Math.trunc(v);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

export function normalizeRemediationAutoTier(v: unknown): RemediationAutoTier {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (AUTO_TIER_ORDER.includes(t as RemediationAutoTier)) {
    return t as RemediationAutoTier;
  }
  return "safe_auto";
}

export function isAutoExecutableTier(
  actionTier: RemediationAutoTier,
  maxTier: RemediationAutoTier
): boolean {
  if (actionTier === "observe") return false;
  return rankOf(AUTO_TIER_ORDER, actionTier) <= rankOf(AUTO_TIER_ORDER, maxTier);
}

export function normalizeApprovalRiskThreshold(
  v: unknown,
  fallback: RemediationApprovalRiskThreshold = "medium"
): RemediationApprovalRiskThreshold {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "none" || t === "low" || t === "medium" || t === "high") {
    return t;
  }
  return fallback;
}

export function riskRequiresApproval(
  risk: RemediationRisk,
  threshold: RemediationApprovalRiskThreshold
): boolean {
  if (threshold === "none") return false;
  return rankOf(RISK_ORDER, risk) >= rankOf(RISK_ORDER, threshold);
}

export function canaryPercentForTier(
  tier: RemediationAutoTier,
  defaultRolloutPercent: number
): number {
  const base = clampInt(defaultRolloutPercent, 1, 100);
  if (tier === "safe_auto") return 100;
  if (tier === "observe") return 0;
  return base;
}

export function stableCanaryBucket(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0) % 100;
}

export function shouldSelectCanary(
  hostId: string,
  actionId: string,
  percent: number
): { bucket: number; selected: boolean } {
  const boundedPercent = clampInt(percent, 0, 100);
  if (boundedPercent <= 0) return { bucket: 99, selected: false };
  if (boundedPercent >= 100) return { bucket: 0, selected: true };
  const bucket = stableCanaryBucket(`${hostId}::${actionId}`);
  return { bucket, selected: bucket < boundedPercent };
}

