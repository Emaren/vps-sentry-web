"use client";

import React from "react";

export type PowerVitalsTopTab = "power" | "memory" | "disk" | "reclaim";

type HostVitals = {
  source: "live" | "snapshot";
  updatedTs: string | null;
  cpuUsedPercent: number | null;
  cpuCapacityPercent: number;
  cpuCores: number | null;
  memoryUsedPercent: number | null;
  memoryCapacityPercent: number;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  diskUsedPercent: number | null;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  diskAvailableBytes: number | null;
};

function clampPercent(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function markerPercent(value: number | null): number {
  return Math.max(2, Math.min(98, clampPercent(value)));
}

function fmtRatio(used: number | null, capacity: number): string {
  if (typeof used !== "number" || !Number.isFinite(used)) return `—/${Math.round(capacity)}%`;
  return `${Math.max(0, Math.min(100, Math.round(used)))}/${Math.round(capacity)}%`;
}

function fmtSizeFromMb(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 1024) return `${(value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1)}GB`;
  return `${Math.round(value)}MB`;
}

function fmtBytes(value: number | null): string {
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

function liveBadgeClass(connected: boolean, source: HostVitals["source"]): string {
  if (connected && source === "live") return "power-vitals-live-badge power-vitals-live-badge-live";
  if (connected) return "power-vitals-live-badge power-vitals-live-badge-snapshot";
  return "power-vitals-live-badge power-vitals-live-badge-disconnected";
}

type ToneStop = {
  pct: number;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  border: string;
  borderSoft: string;
  accent: string;
  accentSoft: string;
  badgeBg: string;
  track: string;
  focusRing: string;
};

const VITALS_TONE_STOPS: ToneStop[] = [
  {
    pct: 0,
    surface: "#5d4700",
    surfaceHover: "#695200",
    surfaceActive: "#715900",
    border: "#ffd54a",
    borderSoft: "#b59124",
    accent: "#ffe066",
    accentSoft: "#f3c62f",
    badgeBg: "#7a6107",
    track: "#6c5a1f",
    focusRing: "#ffe791",
  },
  {
    pct: 5,
    surface: "#705703",
    surfaceHover: "#7c6207",
    surfaceActive: "#85690a",
    border: "#ffd95d",
    borderSoft: "#c8a33a",
    accent: "#ffe57a",
    accentSoft: "#f5cf48",
    badgeBg: "#8a6f0c",
    track: "#756227",
    focusRing: "#fff0ab",
  },
  {
    pct: 6,
    surface: "#177648",
    surfaceHover: "#1b814f",
    surfaceActive: "#1f8755",
    border: "#67f0a3",
    borderSoft: "#2e9b63",
    accent: "#4ee98d",
    accentSoft: "#2dcb6e",
    badgeBg: "#1f8d5a",
    track: "#2a6b48",
    focusRing: "#98f4bf",
  },
  {
    pct: 20,
    surface: "#1a7448",
    surfaceHover: "#1d7d4f",
    surfaceActive: "#218556",
    border: "#60e696",
    borderSoft: "#318f5c",
    accent: "#4ddf86",
    accentSoft: "#31c36a",
    badgeBg: "#22885a",
    track: "#2d6648",
    focusRing: "#8befb2",
  },
  {
    pct: 40,
    surface: "#1b6d43",
    surfaceHover: "#1e7649",
    surfaceActive: "#227d4f",
    border: "#57d883",
    borderSoft: "#347f57",
    accent: "#44cf77",
    accentSoft: "#31b35f",
    badgeBg: "#257f54",
    track: "#315f46",
    focusRing: "#79e39d",
  },
  {
    pct: 60,
    surface: "#1a603b",
    surfaceHover: "#1d6941",
    surfaceActive: "#207046",
    border: "#4ec472",
    borderSoft: "#366f4a",
    accent: "#3db964",
    accentSoft: "#2f9e51",
    badgeBg: "#246f49",
    track: "#335644",
    focusRing: "#6cd88a",
  },
  {
    pct: 75,
    surface: "#1a5334",
    surfaceHover: "#1d5b39",
    surfaceActive: "#20633e",
    border: "#42aa60",
    borderSoft: "#355f43",
    accent: "#33a455",
    accentSoft: "#2b8c49",
    badgeBg: "#225f3f",
    track: "#344d3f",
    focusRing: "#60c47d",
  },
  {
    pct: 85,
    surface: "#19442d",
    surfaceHover: "#1c4b31",
    surfaceActive: "#205336",
    border: "#357f4a",
    borderSoft: "#2f5938",
    accent: "#2f8d4a",
    accentSoft: "#27733d",
    badgeBg: "#214f36",
    track: "#33453b",
    focusRing: "#56ad6d",
  },
  {
    pct: 86,
    surface: "#542220",
    surfaceHover: "#5d2523",
    surfaceActive: "#672927",
    border: "#ff8e79",
    borderSoft: "#a9584d",
    accent: "#ff7f67",
    accentSoft: "#ef614c",
    badgeBg: "#70302b",
    track: "#5d3c39",
    focusRing: "#ffb29f",
  },
  {
    pct: 92,
    surface: "#641e1e",
    surfaceHover: "#6e2121",
    surfaceActive: "#772424",
    border: "#ff7360",
    borderSoft: "#b34e40",
    accent: "#ff6a55",
    accentSoft: "#ee5141",
    badgeBg: "#7f2a29",
    track: "#643a38",
    focusRing: "#ff9a8d",
  },
  {
    pct: 100,
    surface: "#761818",
    surfaceHover: "#7f1b1b",
    surfaceActive: "#891e1e",
    border: "#ff5b4d",
    borderSoft: "#bd473c",
    accent: "#ff4c42",
    accentSoft: "#f13c34",
    badgeBg: "#912422",
    track: "#6d3838",
    focusRing: "#ff877d",
  },
];

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((part) => `${part}${part}`).join("") : normalized;
  const parsed = Number.parseInt(value, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function mixHex(a: string, b: string, ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const mix = (start: number, end: number) => Math.round(start + (end - start) * clamped);
  return `rgb(${mix(ar, br)} ${mix(ag, bg)} ${mix(ab, bb)})`;
}

function moodStyle(value: number | null): React.CSSProperties {
  const pct = clampPercent(value);
  const upperIndex = VITALS_TONE_STOPS.findIndex((stop) => pct <= stop.pct);
  const upper = upperIndex === -1 ? VITALS_TONE_STOPS[VITALS_TONE_STOPS.length - 1] : VITALS_TONE_STOPS[upperIndex];
  const lower =
    upperIndex <= 0
      ? VITALS_TONE_STOPS[0]
      : upperIndex === -1
        ? VITALS_TONE_STOPS[VITALS_TONE_STOPS.length - 1]
        : VITALS_TONE_STOPS[upperIndex - 1];
  const span = Math.max(1, upper.pct - lower.pct);
  const ratio = lower === upper ? 0 : (pct - lower.pct) / span;

  return {
    ["--pv-surface" as string]: mixHex(lower.surface, upper.surface, ratio),
    ["--pv-surface-hover" as string]: mixHex(lower.surfaceHover, upper.surfaceHover, ratio),
    ["--pv-surface-active" as string]: mixHex(lower.surfaceActive, upper.surfaceActive, ratio),
    ["--pv-border" as string]: mixHex(lower.border, upper.border, ratio),
    ["--pv-border-soft" as string]: mixHex(lower.borderSoft, upper.borderSoft, ratio),
    ["--pv-accent" as string]: mixHex(lower.accent, upper.accent, ratio),
    ["--pv-accent-soft" as string]: mixHex(lower.accentSoft, upper.accentSoft, ratio),
    ["--pv-badge-bg" as string]: mixHex(lower.badgeBg, upper.badgeBg, ratio),
    ["--pv-track" as string]: mixHex(lower.track, upper.track, ratio),
    ["--pv-focus-ring" as string]: mixHex(lower.focusRing, upper.focusRing, ratio),
  };
}

export default function PowerVitalsLiveGrid(props: {
  hostVitals: HostVitals;
  connected: boolean;
  streamLabel: string;
  activeTab: PowerVitalsTopTab;
  onSelectTab: (tab: Exclude<PowerVitalsTopTab, "reclaim">) => void;
}) {
  const { activeTab, connected, hostVitals, onSelectTab, streamLabel } = props;

  return (
    <div className="power-vitals-core-grid">
      <button
        type="button"
        id="power-vitals-tab-power"
        role="tab"
        aria-selected={activeTab === "power"}
        aria-controls="power-vitals-tab-panel"
        className={`power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-tab-card power-vitals-vitals-card${
          activeTab === "power" ? " power-vitals-tab-card-active" : ""
        }`}
        style={moodStyle(hostVitals.cpuUsedPercent)}
        onClick={() => onSelectTab("power")}
      >
        <div className="power-vitals-kpi-headline">
          <div className="power-vitals-kpi-label">Power</div>
          <span className={liveBadgeClass(connected, hostVitals.source)}>{streamLabel}</span>
        </div>
        <div className="power-vitals-kpi-value">{fmtRatio(hostVitals.cpuUsedPercent, hostVitals.cpuCapacityPercent)}</div>
        <div className="power-vitals-kpi-meta">
          VPS CPU used right now{typeof hostVitals.cpuCores === "number" ? ` · ${hostVitals.cpuCores} core(s)` : ""}.
        </div>
        <div className="power-vitals-gauge" aria-hidden="true">
          <div className="power-vitals-gauge-track">
            <span className="power-vitals-gauge-fill" style={{ width: `${clampPercent(hostVitals.cpuUsedPercent)}%` }} />
            {typeof hostVitals.cpuUsedPercent === "number" ? (
              <span className="power-vitals-gauge-marker" style={{ left: `${markerPercent(hostVitals.cpuUsedPercent)}%` }} />
            ) : null}
          </div>
        </div>
      </button>

      <button
        type="button"
        id="power-vitals-tab-memory"
        role="tab"
        aria-selected={activeTab === "memory"}
        aria-controls="power-vitals-tab-panel"
        className={`power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-tab-card power-vitals-vitals-card${
          activeTab === "memory" ? " power-vitals-tab-card-active" : ""
        }`}
        style={moodStyle(hostVitals.memoryUsedPercent)}
        onClick={() => onSelectTab("memory")}
      >
        <div className="power-vitals-kpi-headline">
          <div className="power-vitals-kpi-label">Memory</div>
        </div>
        <div className="power-vitals-kpi-value">{fmtRatio(hostVitals.memoryUsedPercent, hostVitals.memoryCapacityPercent)}</div>
        <div className="power-vitals-kpi-meta">
          {fmtSizeFromMb(hostVitals.memoryUsedMb)} used of {fmtSizeFromMb(hostVitals.memoryTotalMb)}.
        </div>
        <div className="power-vitals-gauge" aria-hidden="true">
          <div className="power-vitals-gauge-track">
            <span className="power-vitals-gauge-fill" style={{ width: `${clampPercent(hostVitals.memoryUsedPercent)}%` }} />
            {typeof hostVitals.memoryUsedPercent === "number" ? (
              <span className="power-vitals-gauge-marker" style={{ left: `${markerPercent(hostVitals.memoryUsedPercent)}%` }} />
            ) : null}
          </div>
        </div>
      </button>

      <button
        type="button"
        id="power-vitals-tab-disk"
        role="tab"
        aria-selected={activeTab === "disk"}
        aria-controls="power-vitals-tab-panel"
        className={`power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-tab-card power-vitals-vitals-card${
          activeTab === "disk" ? " power-vitals-tab-card-active" : ""
        }`}
        style={moodStyle(hostVitals.diskUsedPercent)}
        onClick={() => onSelectTab("disk")}
      >
        <div className="power-vitals-kpi-headline">
          <div className="power-vitals-kpi-label">Disk</div>
        </div>
        <div className="power-vitals-kpi-value">{fmtRatio(hostVitals.diskUsedPercent, 100)}</div>
        <div className="power-vitals-kpi-meta">
          {fmtBytes(hostVitals.diskUsedBytes)} used of {fmtBytes(hostVitals.diskTotalBytes)} · {fmtBytes(hostVitals.diskAvailableBytes)} free.
        </div>
        <div className="power-vitals-gauge" aria-hidden="true">
          <div className="power-vitals-gauge-track">
            <span className="power-vitals-gauge-fill" style={{ width: `${clampPercent(hostVitals.diskUsedPercent)}%` }} />
            {typeof hostVitals.diskUsedPercent === "number" ? (
              <span className="power-vitals-gauge-marker" style={{ left: `${markerPercent(hostVitals.diskUsedPercent)}%` }} />
            ) : null}
          </div>
        </div>
      </button>
    </div>
  );
}
