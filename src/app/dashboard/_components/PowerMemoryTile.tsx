import React from "react";
import type { DerivedDashboard } from "../_lib/derive";
import Box from "./Box";

function fmtPercent(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(v)))}%`;
}

function fmtRatio(used: number | null, capacity: number): string {
  if (typeof used !== "number" || !Number.isFinite(used)) return `—/${Math.round(capacity)}%`;
  return `${Math.max(0, Math.min(100, Math.round(used)))}/${Math.round(capacity)}%`;
}

function fmtMb(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "—";
  return `${Math.round(v)}MB`;
}

function clampBar(v: number | null): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

export default function PowerMemoryTile(props: { derived: DerivedDashboard }) {
  const { derived: d } = props;

  const topRows = d.vitalsProcesses.filter((x) => !x.isOther).slice(0, 5);
  const otherRow = d.vitalsProcesses.find((x) => x.isOther);
  const rows = otherRow ? [...topRows, otherRow] : topRows;

  return (
    <section className="power-vitals-wrap">
      <Box className="power-vitals-shell">
        <div className="power-vitals-head">
          <div>
            <h2 className="power-vitals-title">Power / Memory</h2>
            <p className="power-vitals-subtitle">
              First-look VPS load with ranked process hogs.
            </p>
          </div>
          <span className={d.hasVitals ? "dashboard-chip dashboard-chip-ok" : "dashboard-chip dashboard-chip-warn"}>
            {d.hasVitals ? "snapshot ready" : "waiting telemetry"}
          </span>
        </div>

        <div className="power-vitals-kpi-grid">
          <div className="power-vitals-kpi-card">
            <div className="power-vitals-kpi-label">Power</div>
            <div className="power-vitals-kpi-value">{fmtRatio(d.cpuUsedPercent, d.cpuCapacityPercent)}</div>
            <div className="power-vitals-kpi-meta">
              VPS CPU used right now{typeof d.cpuCores === "number" ? ` · ${d.cpuCores} core(s)` : ""}.
            </div>
            <div className="power-vitals-bar">
              <span style={{ width: `${clampBar(d.cpuUsedPercent)}%` }} />
            </div>
          </div>

          <div className="power-vitals-kpi-card">
            <div className="power-vitals-kpi-label">Memory</div>
            <div className="power-vitals-kpi-value">{fmtRatio(d.memoryUsedPercent, d.memoryCapacityPercent)}</div>
            <div className="power-vitals-kpi-meta">
              {fmtMb(d.memoryUsedMb)} used{d.memoryTotalMb ? ` of ${fmtMb(d.memoryTotalMb)}` : ""}.
            </div>
            <div className="power-vitals-bar">
              <span style={{ width: `${clampBar(d.memoryUsedPercent)}%` }} />
            </div>
          </div>
        </div>

        <div className="power-vitals-list-head">
          Process load ranking (CPU share across observed processes, target total 100%)
        </div>

        {rows.length ? (
          <div className="power-vitals-list" role="list" aria-label="Top VPS process load">
            {rows.map((row) => (
              <div key={`${row.name}-${row.pid ?? "other"}`} className="power-vitals-row" role="listitem">
                <div className="power-vitals-row-name">
                  <span className="power-vitals-row-proc">{row.name}</span>
                  <span className="power-vitals-row-pid">
                    {row.pid ? `pid ${row.pid}` : "aggregated"}
                  </span>
                </div>
                <div className="power-vitals-row-metric">
                  <span className="power-vitals-row-metric-label">Load</span>
                  <span className="power-vitals-row-metric-value">{fmtPercent(row.cpuSharePercent)}</span>
                </div>
                <div className="power-vitals-row-metric">
                  <span className="power-vitals-row-metric-label">CPU cap</span>
                  <span className="power-vitals-row-metric-value">{fmtPercent(row.cpuCapacityPercent)}</span>
                </div>
                <div className="power-vitals-row-metric">
                  <span className="power-vitals-row-metric-label">RAM</span>
                  <span className="power-vitals-row-metric-value">
                    {fmtMb(row.memoryMb)} ({fmtPercent(row.memoryCapacityPercent)})
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="power-vitals-empty">
            No process vitals in this snapshot yet. Run a fresh host report to populate.
          </div>
        )}

        <div className="power-vitals-foot">
          Sampled processes: {typeof d.vitalsSampledCount === "number" ? d.vitalsSampledCount : "—"}
          {" · "}
          CPU share sum: {fmtPercent(d.vitalsCpuShareTotalPercent)}
        </div>
      </Box>
    </section>
  );
}

