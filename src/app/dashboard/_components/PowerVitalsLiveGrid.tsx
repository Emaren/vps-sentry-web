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

function moodClass(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "power-vitals-tab-card-mood-stable";
  if (value <= 5) return "power-vitals-tab-card-mood-warm";
  if (value >= 86) return "power-vitals-tab-card-mood-hot";
  return "power-vitals-tab-card-mood-stable";
}

function moodStyle(value: number | null): React.CSSProperties {
  const pct = clampPercent(value);
  let accentHue = 152;
  let accentSat = 78;
  let accentLight = 57;
  let intensity = 0.3;

  if (pct <= 5) {
    const zone = pct / 5;
    accentHue = 48;
    accentSat = 92;
    accentLight = 63 - zone * 3;
    intensity = 0.28 + zone * 0.2;
  } else if (pct >= 86) {
    const zone = (pct - 86) / 14;
    accentHue = 7;
    accentSat = 90 + zone * 6;
    accentLight = 60 - zone * 7;
    intensity = 0.72 + zone * 0.28;
  } else {
    const zone = (pct - 6) / 79;
    accentHue = 146 - zone * 6;
    accentSat = 72 + zone * 14;
    accentLight = 58 - zone * 6;
    intensity = 0.24 + zone * 0.44;
  }

  return {
    ["--pv-accent" as string]: `${accentHue.toFixed(1)} ${accentSat.toFixed(1)}% ${accentLight.toFixed(1)}%`,
    ["--pv-border-alpha" as string]: (0.1 + intensity * 0.22).toFixed(3),
    ["--pv-panel-alpha" as string]: (0.07 + intensity * 0.16).toFixed(3),
    ["--pv-panel-deep-alpha" as string]: (0.03 + intensity * 0.12).toFixed(3),
    ["--pv-orb-alpha" as string]: (0.08 + intensity * 0.22).toFixed(3),
    ["--pv-orb-soft-alpha" as string]: (0.04 + intensity * 0.16).toFixed(3),
    ["--pv-glow-alpha" as string]: (0.14 + intensity * 0.3).toFixed(3),
    ["--pv-line-alpha" as string]: (0.18 + intensity * 0.34).toFixed(3),
    ["--pv-gauge-alpha" as string]: (0.26 + intensity * 0.34).toFixed(3),
    ["--pv-pulse-seconds" as string]: `${(20 - intensity * 7).toFixed(2)}s`,
    ["--pv-drift-seconds" as string]: `${(28 - intensity * 9).toFixed(2)}s`,
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
        className={`power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-tab-card power-vitals-tab-card-mood ${moodClass(
          hostVitals.cpuUsedPercent
        )}${
          activeTab === "power" ? " power-vitals-tab-card-active" : ""
        }`}
        style={moodStyle(hostVitals.cpuUsedPercent)}
        onClick={() => onSelectTab("power")}
      >
        <span className="power-vitals-mood-field power-vitals-mood-field-primary" aria-hidden="true" />
        <span className="power-vitals-mood-field power-vitals-mood-field-secondary" aria-hidden="true" />
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
        className={`power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-tab-card power-vitals-tab-card-mood ${moodClass(
          hostVitals.memoryUsedPercent
        )}${
          activeTab === "memory" ? " power-vitals-tab-card-active" : ""
        }`}
        style={moodStyle(hostVitals.memoryUsedPercent)}
        onClick={() => onSelectTab("memory")}
      >
        <span className="power-vitals-mood-field power-vitals-mood-field-primary" aria-hidden="true" />
        <span className="power-vitals-mood-field power-vitals-mood-field-secondary" aria-hidden="true" />
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
        className={`power-vitals-kpi-card power-vitals-kpi-card-live power-vitals-tab-card power-vitals-tab-card-mood ${moodClass(
          hostVitals.diskUsedPercent
        )}${
          activeTab === "disk" ? " power-vitals-tab-card-active" : ""
        }`}
        style={moodStyle(hostVitals.diskUsedPercent)}
        onClick={() => onSelectTab("disk")}
      >
        <span className="power-vitals-mood-field power-vitals-mood-field-primary" aria-hidden="true" />
        <span className="power-vitals-mood-field power-vitals-mood-field-secondary" aria-hidden="true" />
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
