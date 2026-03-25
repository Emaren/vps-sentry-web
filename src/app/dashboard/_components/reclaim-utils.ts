"use client";

export type GarbageReclaimProfile = "safe" | "garbage" | "recycling";

export type GarbageReclaimResponse = {
  ok?: boolean;
  accepted?: boolean;
  detail?: string;
  error?: string;
  cleanup?: {
    freedBytesActual?: number | null;
    freedBytesEstimated?: number | null;
    deletedCount?: number | null;
  } | null;
};

export function fmtBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(decimals)}${units[unitIndex]}`;
}

export function ageLabel(ts: string | null | undefined): string {
  if (!ts) return "—";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return "—";
  const deltaMs = Date.now() - ms;
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function fmtDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function cleanupPhaseLabel(phase: string | null | undefined): string {
  switch ((phase ?? "").trim().toLowerCase()) {
    case "scanning":
      return "Scanning reclaim candidates";
    case "reclaiming":
      return "Removing matched targets";
    case "rescanning":
      return "Re-scanning reclaimable space";
    case "publishing":
      return "Publishing refreshed snapshot";
    default:
      return "Cleanup in progress";
  }
}

export function liveBadgeClass(connected: boolean): string {
  if (connected) return "power-vitals-live-badge power-vitals-live-badge-snapshot";
  return "power-vitals-live-badge power-vitals-live-badge-disconnected";
}

export function feedbackToneClass(tone: "ok" | "bad" | "meta"): string {
  if (tone === "ok") return "garbage-tile-feedback garbage-tile-feedback-ok";
  if (tone === "bad") return "garbage-tile-feedback garbage-tile-feedback-bad";
  return "garbage-tile-feedback garbage-tile-feedback-meta";
}

export async function triggerGarbageReclaim(profile: GarbageReclaimProfile): Promise<GarbageReclaimResponse> {
  const res = await fetch("/api/ops/garbage/reclaim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ profile }),
  });
  const data = (await res.json().catch(() => ({}))) as GarbageReclaimResponse;
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
