"use client";

import React from "react";
import type { DashboardGarbageEstimate, DerivedDashboard } from "../_lib/derive";
import { MAIN_PROJECTS, type ProjectDef } from "../_lib/project-catalog";
import Box from "./Box";
import GarbageTile from "./GarbageTile";
import PowerVitalsLiveGrid, { type PowerVitalsTopTab } from "./PowerVitalsLiveGrid";
import ReclaimCategoryTile from "./ReclaimCategoryTile";

type PortEntry = {
  proto?: string;
  host?: string;
  port?: number | string;
  pid?: number | string;
  proc?: string;
  public?: boolean;
  raw?: string;
  sig?: string;
};

type ProjectStorageLargestDir = {
  label: string;
  diskBytes: number | null;
};

type ProjectStorageBucket = {
  label: string;
  diskBytes: number | null;
  apparentBytes: number | null;
  fileCount: number | null;
  matchCount: number | null;
};

type ProjectStorageHostFilesystem = {
  path: string | null;
  measuredAt: string | null;
  totalBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usedPercent: number | null;
  warnPercent: number | null;
  failPercent: number | null;
  level: "ok" | "warn" | "critical" | null;
};

type ProjectStorageMountedFilesystem = ProjectStorageHostFilesystem & {
  id: string | null;
  label: string | null;
  exists: boolean | null;
};

type ProjectStorageProject = {
  measuredAt: string | null;
  previousMeasuredAt: string | null;
  rootsConfigured: number | null;
  rootsPresent: number | null;
  diskBytes: number | null;
  apparentBytes: number | null;
  fileCount: number | null;
  deltaDiskBytes: number | null;
  deltaApparentBytes: number | null;
  deltaFileCount: number | null;
  buckets: Record<string, ProjectStorageBucket>;
  largestDirs: ProjectStorageLargestDir[];
};

type ProjectStoragePayload = {
  schemaVersion: number | null;
  measuredAt: string | null;
  ttlSeconds: number | null;
  bucketOrder: string[];
  hostFilesystem: ProjectStorageHostFilesystem | null;
  mountedFilesystems: ProjectStorageMountedFilesystem[];
  projects: Record<string, ProjectStorageProject>;
};

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

type ProjectLiveVitals = {
  source: "live" | "partial" | "snapshot";
  updatedTs: string | null;
  cpuSharePercent: number | null;
  memoryMb: number | null;
  servicesSeen: number;
  servicesExpected: number;
};

type LivePulsePayload = {
  ts?: string;
  hostVitals?: Partial<HostVitals>;
  projectVitals?: Record<string, Partial<ProjectLiveVitals>>;
  garbageEstimate?: DashboardGarbageEstimate | null;
};

function fmtPercent(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${Math.max(0, Math.min(100, Math.round(v)))}%`;
}

function fmtSizeFromMb(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "—";
  if (v >= 1024) return `${(v / 1024).toFixed(v >= 10 * 1024 ? 0 : 1)}GB`;
  return `${Math.round(v)}MB`;
}

function fmtBytes(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "—";
  if (v === 0) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = v;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)}${units[unitIndex]}`;
}

function fmtSignedBytes(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return "0B";
  return `${v > 0 ? "+" : "-"}${fmtBytes(Math.abs(v))}`;
}

function compactBucketLabel(label: string): string {
  return label
    .replace(/\s+\/\s+/g, "/")
    .replace(/\bDependencies\b/i, "Deps")
    .replace(/\bBackups\/Artifacts\b/i, "Backups");
}

function compactPathLabel(label: string): string {
  const parts = label
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}

function fmtFileCount(v: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
}

function clampBar(v: number | null): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function markerPercent(v: number | null): number {
  return Math.max(3, Math.min(97, clampBar(v)));
}

function mergeHostVitals(previous: HostVitals, next: Partial<HostVitals> | null | undefined): HostVitals {
  if (!next) return previous;
  return {
    ...previous,
    ...next,
    source: next.source === "live" || next.source === "snapshot" ? next.source : previous.source,
    updatedTs: typeof next.updatedTs === "string" ? next.updatedTs : previous.updatedTs,
  };
}

function mergeProjectVitals(
  previous: Record<string, ProjectLiveVitals>,
  next: Record<string, Partial<ProjectLiveVitals>> | null | undefined
): Record<string, ProjectLiveVitals> {
  if (!next) return previous;
  const merged = { ...previous };

  for (const [projectKey, rawValue] of Object.entries(next)) {
    const current = merged[projectKey] ?? {
      source: "snapshot",
      updatedTs: null,
      cpuSharePercent: null,
      memoryMb: null,
      servicesSeen: 0,
      servicesExpected: 0,
    };
    const source =
      rawValue.source === "live" || rawValue.source === "partial" || rawValue.source === "snapshot"
        ? rawValue.source
        : current.source;
    merged[projectKey] = {
      ...current,
      ...rawValue,
      source,
      updatedTs: typeof rawValue.updatedTs === "string" ? rawValue.updatedTs : current.updatedTs,
      servicesSeen: typeof rawValue.servicesSeen === "number" ? rawValue.servicesSeen : current.servicesSeen,
      servicesExpected: typeof rawValue.servicesExpected === "number" ? rawValue.servicesExpected : current.servicesExpected,
    };
  }

  return merged;
}

function mergeGarbageEstimate(
  previous: DashboardGarbageEstimate | null,
  next: DashboardGarbageEstimate | null | undefined
): DashboardGarbageEstimate | null {
  if (next === undefined) return previous;
  return next ?? null;
}

function projectTelemetryBadge(vitals: ProjectLiveVitals | undefined): {
  label: string;
  className: string;
  title: string;
} {
  if (!vitals || vitals.source === "snapshot") {
    return {
      label: "snapshot",
      className: "pm-project-telemetry-badge pm-project-telemetry-badge-snapshot",
      title: "Using the last trusted snapshot for CPU and RAM.",
    };
  }

  if (vitals.source === "live") {
    return {
      label: "live",
      className: "pm-project-telemetry-badge pm-project-telemetry-badge-live",
      title: `Live telemetry from ${vitals.servicesSeen}/${vitals.servicesExpected} visible service port${vitals.servicesExpected === 1 ? "" : "s"}.`,
    };
  }

  return {
    label: `${vitals.servicesSeen}/${vitals.servicesExpected} live`,
    className: "pm-project-telemetry-badge pm-project-telemetry-badge-partial",
    title: "Partial live telemetry. Linux exposed some, but not all, service PIDs for this project.",
  };
}

function parseUsedPercent(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isTcp(proto: string | undefined): boolean {
  if (!proto) return true;
  return proto.toLowerCase().startsWith("tcp");
}

function scorePortArray(arr: PortEntry[]) {
  const sample = arr.slice(0, 12);
  let looks = 0;
  let tcp = 0;
  let pubT = 0;
  let pubF = 0;

  for (const e of sample) {
    const p = toInt(e?.port);
    const pid = toInt(e?.pid);
    if (typeof p === "number" && typeof pid === "number") looks++;
    if (isTcp(e?.proto)) tcp++;
    if (e?.public === true) pubT++;
    if (e?.public === false) pubF++;
  }

  const score = looks * 10 + tcp * 3 + pubF * 2 + pubT * 2 + Math.min(arr.length, 60);
  return { score, looks, tcp, pubT, pubF };
}

function pickPortsFromDerived(d: DerivedDashboard): { local: PortEntry[]; pub: PortEntry[]; debug: string } {
  const root = d as unknown as Record<string, unknown>;

  const directLocal = safeArray<PortEntry>(root["ports_local"] ?? root["portsLocal"]);
  const directPub = safeArray<PortEntry>(root["ports_public"] ?? root["portsPublic"]);
  if (directLocal.length || directPub.length) {
    return {
      local: directLocal,
      pub: directPub,
      debug: `direct: local=${directLocal.length} pub=${directPub.length}`,
    };
  }

  const candidates: unknown[] = [
    root["canonicalStatus"],
    root["canonical_status"],
    root["statusCanonical"],
    root["status_canonical"],
    root["status"],
    root["hostStatus"],
    root["rawStatus"],
  ].filter(Boolean);

  for (const c of candidates) {
    const r = asRecord(c);
    const loc = safeArray<PortEntry>(r["ports_local"] ?? r["portsLocal"]);
    const pub = safeArray<PortEntry>(r["ports_public"] ?? r["portsPublic"]);
    if (loc.length || pub.length) {
      return {
        local: loc,
        pub,
        debug: `statusCandidate: local=${loc.length} pub=${pub.length}`,
      };
    }
  }

  const hits: Array<{ path: string; arr: PortEntry[]; score: number; pubT: number; pubF: number }> = [];
  const seen = new Set<unknown>();
  const q: Array<{ v: unknown; path: string; depth: number }> = [{ v: d, path: "derived", depth: 0 }];

  let visited = 0;
  const MAX_NODES = 1200;
  const MAX_DEPTH = 6;

  try {
    while (q.length && visited < MAX_NODES) {
      const cur = q.shift()!;
      visited++;

      if (!cur || typeof cur.v !== "object" || cur.v === null) continue;
      if (seen.has(cur.v)) continue;
      seen.add(cur.v);

      if (Array.isArray(cur.v)) {
        const arr = cur.v as unknown[];
        for (let i = 0; i < Math.min(arr.length, 6); i++) {
          q.push({ v: arr[i], path: `${cur.path}[${i}]`, depth: cur.depth + 1 });
        }
        continue;
      }

      const rec = cur.v as Record<string, unknown>;
      for (const [k, vv] of Object.entries(rec)) {
        const path = `${cur.path}.${k}`;

        if (Array.isArray(vv) && vv.length && typeof vv[0] === "object" && vv[0] !== null) {
          const arr = vv as PortEntry[];
          const { score, looks, pubT, pubF } = scorePortArray(arr);
          if (looks >= 2) hits.push({ path, arr, score, pubT, pubF });
        }

        if (cur.depth < MAX_DEPTH) {
          q.push({ v: vv, path, depth: cur.depth + 1 });
        }
      }
    }
  } catch {
    return { local: [], pub: [], debug: "bfs:error" };
  }

  if (!hits.length) return { local: [], pub: [], debug: "bfs: none" };

  const namedLocal = hits
    .filter((h) => /ports[_-]?local|portsLocal/i.test(h.path))
    .sort((a, b) => b.score - a.score)[0];
  const namedPub = hits
    .filter((h) => /ports[_-]?public|portsPublic/i.test(h.path))
    .sort((a, b) => b.score - a.score)[0];

  if (namedLocal || namedPub) {
    return {
      local: namedLocal?.arr ?? [],
      pub: namedPub?.arr ?? [],
      debug: `bfs:named local=${namedLocal?.arr.length ?? 0} pub=${namedPub?.arr.length ?? 0}`,
    };
  }

  const best = hits.sort((a, b) => b.score - a.score)[0];
  const pub = best.arr.filter((x) => x.public === true);
  const local = best.arr.filter((x) => x.public === false);
  const fallbackLocal = local.length || pub.length ? local : best.arr;

  return {
    local: fallbackLocal,
    pub,
    debug: `bfs:best path=${best.path} local=${fallbackLocal.length} pub=${pub.length}`,
  };
}

function parseProjectStoragePayload(value: unknown): ProjectStoragePayload | null {
  const rec = asRecord(value);
  const projectsRec = asRecord(rec?.projects);
  const bucketOrder = safeArray<string>(rec?.bucket_order).filter((entry) => typeof entry === "string" && entry.trim().length > 0);
  const hostFilesystemRec = asRecord(rec?.host_filesystem);
  const mountedFilesystemRecs = safeArray<Record<string, unknown>>(rec?.mounted_filesystems);

  const projects: Record<string, ProjectStorageProject> = {};
  for (const [key, rawProject] of Object.entries(projectsRec)) {
    const project = asRecord(rawProject);
    if (!project) continue;
    const largestDirs = safeArray<Record<string, unknown>>(project.largest_dirs)
      .map((entry) => {
        const label = typeof entry?.label === "string" ? entry.label.trim() : "";
        return {
          label,
          diskBytes: toInt(entry?.disk_bytes),
        };
      })
      .filter((entry) => entry.label.length > 0);
    const bucketsRec = asRecord(project.buckets);
    const buckets: Record<string, ProjectStorageBucket> = {};
    for (const [bucketId, rawBucket] of Object.entries(bucketsRec)) {
      const bucket = asRecord(rawBucket);
      if (!bucket) continue;
      const label = typeof bucket.label === "string" && bucket.label.trim().length > 0 ? bucket.label.trim() : bucketId;
      buckets[bucketId] = {
        label,
        diskBytes: toInt(bucket.disk_bytes),
        apparentBytes: toInt(bucket.apparent_bytes),
        fileCount: toInt(bucket.file_count),
        matchCount: toInt(bucket.match_count),
      };
    }

    projects[key] = {
      measuredAt: typeof project.measured_at === "string" ? project.measured_at : null,
      previousMeasuredAt: typeof project.previous_measured_at === "string" ? project.previous_measured_at : null,
      rootsConfigured: toInt(project.roots_configured),
      rootsPresent: toInt(project.roots_present),
      diskBytes: toInt(project.disk_bytes),
      apparentBytes: toInt(project.apparent_bytes),
      fileCount: toInt(project.file_count),
      deltaDiskBytes: toInt(project.delta_disk_bytes),
      deltaApparentBytes: toInt(project.delta_apparent_bytes),
      deltaFileCount: toInt(project.delta_file_count),
      buckets,
      largestDirs,
    };
  }

  const mountedFilesystems: ProjectStorageMountedFilesystem[] = mountedFilesystemRecs.map((entry) => ({
    id: typeof entry.id === "string" ? entry.id : null,
    label: typeof entry.label === "string" ? entry.label : null,
    exists: typeof entry.exists === "boolean" ? entry.exists : null,
    path: typeof entry.path === "string" ? entry.path : null,
    measuredAt: typeof entry.measured_at === "string" ? entry.measured_at : null,
    totalBytes: toInt(entry.total_bytes),
    usedBytes: toInt(entry.used_bytes),
    availableBytes: toInt(entry.available_bytes),
    usedPercent: parseUsedPercent(entry.used_percent),
    warnPercent: parseUsedPercent(entry.warn_percent),
    failPercent: parseUsedPercent(entry.fail_percent),
    level:
      entry.level === "ok" || entry.level === "warn" || entry.level === "critical"
        ? entry.level
        : null,
  }));

  return {
    schemaVersion: toInt(rec?.schema_version),
    measuredAt: typeof rec?.measured_at === "string" ? rec.measured_at : null,
    ttlSeconds: toInt(rec?.ttl_seconds),
    bucketOrder,
    hostFilesystem: hostFilesystemRec
      ? {
          path: typeof hostFilesystemRec.path === "string" ? hostFilesystemRec.path : null,
          measuredAt: typeof hostFilesystemRec.measured_at === "string" ? hostFilesystemRec.measured_at : null,
          totalBytes: toInt(hostFilesystemRec.total_bytes),
          usedBytes: toInt(hostFilesystemRec.used_bytes),
          availableBytes: toInt(hostFilesystemRec.available_bytes),
          usedPercent: parseUsedPercent(hostFilesystemRec.used_percent),
          warnPercent: parseUsedPercent(hostFilesystemRec.warn_percent),
          failPercent: parseUsedPercent(hostFilesystemRec.fail_percent),
          level:
            hostFilesystemRec.level === "ok" || hostFilesystemRec.level === "warn" || hostFilesystemRec.level === "critical"
              ? hostFilesystemRec.level
              : null,
        }
      : null,
    mountedFilesystems,
    projects,
  };
}

function pickProjectStorageFromDerived(d: DerivedDashboard): ProjectStoragePayload | null {
  const root = d as unknown as Record<string, unknown>;
  const candidates: unknown[] = [
    root["project_storage"],
    asRecord(root["canonicalStatus"])?.["project_storage"],
    asRecord(root["status"])?.["project_storage"],
    asRecord(root["last"])?.["project_storage"],
  ];

  for (const candidate of candidates) {
    const parsed = parseProjectStoragePayload(candidate);
    if (parsed && (Object.keys(parsed.projects).length || parsed.mountedFilesystems.length)) return parsed;
  }
  return null;
}

function findPort(ports: PortEntry[], port: number): PortEntry | undefined {
  return ports.find((p) => {
    const pport = toInt(p?.port);
    return pport === port && isTcp(p.proto);
  });
}

function sumMaybe(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

function resolveBackendHref(project: Pick<ProjectDef, "subtitle" | "backendHref">): string | undefined {
  if (project.backendHref?.trim()) return project.backendHref.trim();
  const subtitle = project.subtitle?.trim();
  if (!subtitle) return undefined;
  if (subtitle.startsWith("http://") || subtitle.startsWith("https://")) return subtitle;
  return `https://${subtitle}`;
}

function backendLabelFromHref(href: string): string {
  try {
    const u = new URL(href);
    const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
    return `${u.hostname}${path}`;
  } catch {
    return href.replace(/^https?:\/\//i, "");
  }
}

function resolveBackendLabel(project: Pick<ProjectDef, "subtitle" | "backendHref">): string {
  const resolved = resolveBackendHref(project);
  if (resolved) return backendLabelFromHref(resolved);
  return project.subtitle?.trim() ?? "";
}

type FocusPanelItem = {
  key: string;
  label: string;
  value: string;
  meta: string;
  note?: string | null;
};

type FocusPanelStat = {
  label: string;
  value: string;
  meta: string;
  tone?: "default" | "ok" | "warn";
};

function FocusWorkbench(props: {
  tab: Exclude<PowerVitalsTopTab, "reclaim">;
  title: string;
  subtitle: string;
  pill: string | null;
  items: FocusPanelItem[];
  emptyLabel: string;
  footer: string;
  stats: FocusPanelStat[];
}) {
  const { emptyLabel, footer, items, pill, stats, subtitle, tab, title } = props;

  return (
    <div
      className="power-vitals-focus-panel"
      role="tabpanel"
      id="power-vitals-tab-panel"
      aria-labelledby={`power-vitals-tab-${tab}`}
    >
      <div className="power-vitals-focus-panel-main">
        <div className="power-vitals-focus-panel-head">
          <div>
            <div className="power-vitals-focus-panel-kicker">{title}</div>
            <div className="power-vitals-focus-panel-title">{subtitle}</div>
          </div>
          {pill ? <div className="power-vitals-focus-panel-pill">{pill}</div> : null}
        </div>

        <div className="power-vitals-focus-list">
          {items.length > 0 ? (
            items.map((item) => (
              <div key={item.key} className="power-vitals-focus-row">
                <div className="power-vitals-focus-row-copy">
                  <div className="power-vitals-focus-row-label">{item.label}</div>
                  <div className="power-vitals-focus-row-meta">{item.meta}</div>
                  {item.note ? <div className="power-vitals-focus-row-note">{item.note}</div> : null}
                </div>
                <div className="power-vitals-focus-row-value">{item.value}</div>
              </div>
            ))
          ) : (
            <div className="power-vitals-focus-empty">{emptyLabel}</div>
          )}
        </div>

        <div className="power-vitals-focus-footer">{footer}</div>
      </div>

      <div className="power-vitals-focus-panel-side">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`power-vitals-focus-stat${
              stat.tone === "ok"
                ? " power-vitals-focus-stat-ok"
                : stat.tone === "warn"
                  ? " power-vitals-focus-stat-warn"
                  : ""
            }`}
          >
            <div className="power-vitals-focus-stat-label">{stat.label}</div>
            <div className="power-vitals-focus-stat-value">{stat.value}</div>
            <div className="power-vitals-focus-stat-meta">{stat.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PowerMemoryTile(props: { derived: DerivedDashboard; canReclaim: boolean }) {
  const { canReclaim, derived: d } = props;

  const topRows = d.vitalsProcesses.filter((x) => !x.isOther).slice(0, 5);
  const otherRow = d.vitalsProcesses.find((x) => x.isOther);
  const rows = otherRow ? [...topRows, otherRow] : topRows;

  const { local: portsLocal, pub: portsPublic } = pickPortsFromDerived(d);
  const projectStorage = pickProjectStorageFromDerived(d);
  const mountedFilesystems = projectStorage?.mountedFilesystems ?? [];
  const primaryMountedFilesystem =
    mountedFilesystems.find((fs) => fs.exists !== false) ?? mountedFilesystems[0] ?? null;
  const totalTrackedDisk = Object.values(projectStorage?.projects ?? {}).reduce(
    (sum, project) => sum + (project.diskBytes ?? 0),
    0
  );
  const storageTtlLabel =
    typeof projectStorage?.ttlSeconds === "number" && projectStorage.ttlSeconds > 0
      ? `${Math.round(projectStorage.ttlSeconds / 60)}m`
      : null;
  const storageBucketOrder = projectStorage?.bucketOrder ?? [];
  const hostFilesystem = projectStorage?.hostFilesystem ?? null;
  const initialHostVitals: HostVitals = {
    source: "snapshot",
    updatedTs: projectStorage?.measuredAt ?? d.snapshotTs,
    cpuUsedPercent: d.cpuUsedPercent,
    cpuCapacityPercent: d.cpuCapacityPercent,
    cpuCores: d.cpuCores,
    memoryUsedPercent: d.memoryUsedPercent,
    memoryCapacityPercent: d.memoryCapacityPercent,
    memoryUsedMb: d.memoryUsedMb,
    memoryTotalMb: d.memoryTotalMb,
    diskUsedPercent: hostFilesystem?.usedPercent ?? null,
    diskUsedBytes: hostFilesystem?.usedBytes ?? null,
    diskTotalBytes: hostFilesystem?.totalBytes ?? null,
    diskAvailableBytes: hostFilesystem?.availableBytes ?? null,
  };
  const [hostVitals, setHostVitals] = React.useState<HostVitals>(initialHostVitals);
  const [garbageEstimate, setGarbageEstimate] = React.useState<DashboardGarbageEstimate | null>(d.garbageEstimate);
  const [projectLiveVitals, setProjectLiveVitals] = React.useState<Record<string, ProjectLiveVitals>>({});
  const [liveConnected, setLiveConnected] = React.useState(false);
  const [liveLastError, setLiveLastError] = React.useState<string | null>(null);
  const [activeTopTab, setActiveTopTab] = React.useState<PowerVitalsTopTab>("reclaim");

  React.useEffect(() => {
    const es = new EventSource("/api/dashboard/live?intervalMs=4000");

    const onOpen = () => {
      setLiveConnected(true);
      setLiveLastError(null);
    };
    const onError = () => {
      setLiveConnected(false);
      setLiveLastError("reconnecting");
    };
    const onPulse = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as LivePulsePayload;
        if (!payload || typeof payload !== "object") return;
        React.startTransition(() => {
          setHostVitals((current) => mergeHostVitals(current, payload.hostVitals));
          setGarbageEstimate((current) => mergeGarbageEstimate(current, payload.garbageEstimate));
          setProjectLiveVitals((current) => mergeProjectVitals(current, payload.projectVitals));
        });
      } catch {
        // ignore malformed events
      }
    };

    es.addEventListener("open", onOpen as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.addEventListener("pulse", onPulse as EventListener);

    return () => {
      es.close();
    };
  }, []);

  const pidToVitals = new Map<number, (typeof d.vitalsProcesses)[number]>();
  for (const vp of d.vitalsProcesses) {
    const pid = toInt((vp as unknown as { pid?: unknown })?.pid);
    if (typeof pid === "number") pidToVitals.set(pid, vp);
  }

  const projectCards = MAIN_PROJECTS.map((proj) => {
    const storage = projectStorage?.projects[proj.key];
    const backendHrefResolved = resolveBackendHref(proj);
    const backendLabel = resolveBackendLabel(proj);
    const isDormant = proj.state === "dormant";

    const services = proj.services.map((svc) => {
      const local = findPort(portsLocal, svc.port);
      const pub = findPort(portsPublic, svc.port);
      const portEntry = local ?? pub;

      const pid = toInt(portEntry?.pid);
      const vitals = typeof pid === "number" ? pidToVitals.get(pid) : undefined;

      return {
        ...svc,
        isListening: Boolean(portEntry),
        isPublic: Boolean(pub),
        pid: pid ?? undefined,
        cpuSharePercent: vitals?.cpuSharePercent ?? null,
        memoryMb: vitals?.memoryMb ?? null,
      };
    });

    const required = services.filter((s) => s.required);
    const hasRequired = required.length > 0;
    const allRequiredUp = hasRequired ? required.every((s) => s.isListening) : false;
    const requiredUpCount = required.filter((s) => s.isListening).length;
    const listeningCount = services.filter((s) => s.isListening).length;
    const publicCount = services.filter((s) => s.isPublic).length;
    const missingRequired = isDormant ? [] : required.filter((s) => !s.isListening).map((s) => `${s.label}:${s.port}`);

    const snapshotCpuSharePercent = sumMaybe(services.map((s) => s.cpuSharePercent));
    const snapshotMemoryMb = sumMaybe(services.map((s) => s.memoryMb));
    const liveTelemetry = projectLiveVitals[proj.key];
    const cpuSharePercent =
      liveTelemetry && liveTelemetry.source !== "snapshot" && typeof liveTelemetry.cpuSharePercent === "number"
        ? liveTelemetry.cpuSharePercent
        : snapshotCpuSharePercent;
    const memoryMb =
      liveTelemetry && liveTelemetry.source !== "snapshot" && typeof liveTelemetry.memoryMb === "number"
        ? liveTelemetry.memoryMb
        : snapshotMemoryMb;
    const telemetryBadge = projectTelemetryBadge(liveTelemetry);
    const cpuBarPercent = clampBar(cpuSharePercent);
    const memBarPercent =
      typeof memoryMb === "number" && typeof d.memoryTotalMb === "number" && d.memoryTotalMb > 0
        ? clampBar((memoryMb / d.memoryTotalMb) * 100)
        : 0;
    const diskBarPercent =
      totalTrackedDisk > 0 && typeof storage?.diskBytes === "number"
        ? clampBar((storage.diskBytes / totalTrackedDisk) * 100)
        : 0;
    const diskMetaParts = [
      typeof storage?.apparentBytes === "number" ? `${fmtBytes(storage.apparentBytes)} apparent` : null,
      typeof storage?.fileCount === "number" ? `${fmtFileCount(storage.fileCount)} files` : null,
    ].filter((value): value is string => Boolean(value));
    const diskMeta =
      diskMetaParts.join(" · ") ||
      (typeof storage?.rootsConfigured === "number" && storage.rootsConfigured > 0 && storage.rootsPresent === 0
        ? "tracked roots missing"
        : "disk scan pending");
    const sortedBuckets = Object.entries(storage?.buckets ?? {})
      .map(([bucketId, bucket]) => ({ bucketId, ...bucket }))
      .filter((bucket) => typeof bucket.diskBytes === "number" && bucket.diskBytes > 0)
      .sort((a, b) => {
        const diskDiff = (b.diskBytes ?? 0) - (a.diskBytes ?? 0);
        if (diskDiff !== 0) return diskDiff;
        const orderDiff = storageBucketOrder.indexOf(a.bucketId) - storageBucketOrder.indexOf(b.bucketId);
        return orderDiff;
      });
    const bucketHighlights = sortedBuckets.slice(0, 3).map((bucket) => ({
      label: compactBucketLabel(bucket.label),
      value: fmtBytes(bucket.diskBytes),
    }));
    const largestDirHighlights = (storage?.largestDirs ?? []).slice(0, 2).map((entry) => ({
      label: compactPathLabel(entry.label),
      value: fmtBytes(entry.diskBytes),
    }));
    const diskDeltaLabel =
      typeof storage?.deltaDiskBytes === "number" && storage.previousMeasuredAt
        ? `${storage.deltaDiskBytes > 0 ? "Growth" : "Delta"} ${fmtSignedBytes(storage.deltaDiskBytes)}`
        : null;
    const diskStatusLabel =
      typeof storage?.rootsConfigured === "number" && storage.rootsConfigured > 0 && storage.rootsPresent === 0
        ? "Tracked roots missing"
        : null;

    const portsLabel =
      services.length > 0
        ? services
            .map((s) => {
              const pubTag = s.isPublic ? "(pub)" : "";
              const pidTag = typeof s.pid === "number" ? `#${s.pid}` : "";
              return `${s.label}:${s.port}${pubTag}${pidTag ? ` ${pidTag}` : ""}`;
            })
            .join(" · ")
        : "No live ports mapped yet.";

    const statusText = isDormant ? "Dormant" : allRequiredUp ? "Up" : "Down";
    const statusClass = isDormant
      ? "pm-project-status"
      : allRequiredUp
        ? "pm-project-status pm-project-status-ok"
        : "pm-project-status pm-project-status-bad";

    return {
      ...proj,
      isDormant,
      backendHrefResolved,
      backendLabel,
      services,
      up: !isDormant && allRequiredUp,
      statusText,
      statusClass,
      requiredUpCount,
      requiredCount: required.length,
      listeningCount,
      publicCount,
      missingRequired,
      cpuSharePercent,
      cpuBarPercent,
      memoryMb,
      memoryBarPercent: memBarPercent,
      diskBytes: storage?.diskBytes ?? null,
      diskBarPercent,
      diskMeta,
      diskDeltaLabel,
      diskStatusLabel,
      bucketHighlights,
      largestDirHighlights,
      portsLabel,
      telemetryBadge,
      hasCpuTelemetry: typeof cpuSharePercent === "number" && Number.isFinite(cpuSharePercent),
      hasMemoryTelemetry: typeof memoryMb === "number" && Number.isFinite(memoryMb),
      hasDiskTelemetry: typeof storage?.diskBytes === "number" && totalTrackedDisk > 0,
    };
  });

  const topCpuProcess = d.vitalsProcesses
    .filter((row) => !row.isOther)
    .slice()
    .sort((a, b) => (b.cpuCapacityPercent ?? -1) - (a.cpuCapacityPercent ?? -1))[0];
  const topCpuCapacity = typeof topCpuProcess?.cpuCapacityPercent === "number" ? topCpuProcess.cpuCapacityPercent : null;
  const showCpuHotspot =
    (hostVitals.cpuUsedPercent ?? d.cpuUsedPercent ?? 0) >= 90 &&
    typeof topCpuCapacity === "number" &&
    topCpuCapacity >= 50;
  const overviewChipClass = liveConnected
    ? "dashboard-chip dashboard-chip-ok"
    : d.hasVitals
      ? "dashboard-chip dashboard-chip-warn"
      : "dashboard-chip dashboard-chip-warn";
  const overviewChipLabel = liveConnected ? "live feed" : d.hasVitals ? "snapshot ready" : "waiting telemetry";
  const liveStreamLabel = liveConnected
    ? hostVitals.source === "live"
      ? "live"
      : "snapshot"
    : liveLastError ?? "offline";
  const sampledProcessCount = d.vitalsProcesses.filter((row) => !row.isOther).length;
  const handleTopTabSelect = (tab: PowerVitalsTopTab) => {
    React.startTransition(() => {
      setActiveTopTab(tab);
    });
  };
  const cpuFocusItems = d.vitalsProcesses
    .filter((row) => !row.isOther && (typeof row.cpuCapacityPercent === "number" || typeof row.cpuSharePercent === "number"))
    .slice()
    .sort(
      (a, b) =>
        (b.cpuCapacityPercent ?? b.cpuSharePercent ?? -1) - (a.cpuCapacityPercent ?? a.cpuSharePercent ?? -1)
    )
    .slice(0, 4)
    .map((row) => ({
      key: `cpu-${row.pid ?? row.name}`,
      label: row.friendlyName || row.name,
      value: fmtPercent(row.cpuCapacityPercent ?? row.cpuSharePercent),
      meta:
        [
          row.secondaryText,
          row.unit ? `unit ${row.unit}` : null,
          row.project ? `project ${row.project}` : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ") || "CPU sample ready.",
      note:
        [
          row.detailTitle,
          row.ports.length > 0 ? `Ports ${row.ports.slice(0, 3).join(", ")}` : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ") || null,
    }));
  const memoryFocusItems = d.vitalsProcesses
    .filter((row) => !row.isOther && typeof row.memoryMb === "number")
    .slice()
    .sort((a, b) => (b.memoryMb ?? -1) - (a.memoryMb ?? -1))
    .slice(0, 4)
    .map((row) => ({
      key: `memory-${row.pid ?? row.name}`,
      label: row.friendlyName || row.name,
      value: fmtSizeFromMb(row.memoryMb),
      meta:
        [
          row.secondaryText,
          row.unit ? `unit ${row.unit}` : null,
          row.project ? `project ${row.project}` : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ") || "Memory sample ready.",
      note:
        [
          typeof row.cpuCapacityPercent === "number" ? `${fmtPercent(row.cpuCapacityPercent)} CPU share` : null,
          row.ports.length > 0 ? `Ports ${row.ports.slice(0, 3).join(", ")}` : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ") || null,
    }));
  const diskFocusItems = projectCards
    .filter((project) => typeof project.diskBytes === "number" && project.diskBytes > 0)
    .slice()
    .sort((a, b) => (b.diskBytes ?? -1) - (a.diskBytes ?? -1))
    .slice(0, 4)
    .map((project) => ({
      key: `disk-${project.key}`,
      label: project.name,
      value: fmtBytes(project.diskBytes),
      meta: project.diskMeta,
      note:
        [
          project.diskDeltaLabel,
          project.largestDirHighlights[0]
            ? `${project.largestDirHighlights[0].label} · ${project.largestDirHighlights[0].value}`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" · ") || null,
    }));
  const memoryFreeMb =
    typeof hostVitals.memoryTotalMb === "number" && typeof hostVitals.memoryUsedMb === "number"
      ? Math.max(0, hostVitals.memoryTotalMb - hostVitals.memoryUsedMb)
      : d.memoryAvailableMb;
  const diskTone =
    hostFilesystem?.level === "critical" || hostFilesystem?.level === "warn"
      ? "warn"
      : hostFilesystem?.level === "ok"
        ? "ok"
        : "default";
  const mountedTone =
    primaryMountedFilesystem?.level === "critical" || primaryMountedFilesystem?.level === "warn"
      ? "warn"
      : primaryMountedFilesystem?.level === "ok"
        ? "ok"
        : "default";

  const activeFocusPanel =
    activeTopTab === "power" ? (
      <FocusWorkbench
        tab="power"
        title="Power Workbench"
        subtitle="CPU draw, burst pressure, and the hottest sampled services right now."
        pill={`${fmtPercent(hostVitals.cpuUsedPercent)} host draw`}
        items={cpuFocusItems}
        emptyLabel="No CPU-heavy process samples are available yet."
        footer={
          showCpuHotspot
            ? `Hotspot detected: ${topCpuProcess?.friendlyName ?? "unknown"} is the current pressure leader.`
            : "No CPU hotspot is dominating the box right now."
        }
        stats={[
          {
            label: "Host draw",
            value: fmtPercent(hostVitals.cpuUsedPercent),
            meta: `${liveStreamLabel} feed · ${typeof hostVitals.cpuCores === "number" ? `${hostVitals.cpuCores} core(s)` : "core count pending"}`,
            tone: (hostVitals.cpuUsedPercent ?? 0) >= 85 ? "warn" : liveConnected ? "ok" : "default",
          },
          {
            label: "Top pressure",
            value: topCpuProcess?.friendlyName ?? "None",
            meta:
              typeof topCpuCapacity === "number"
                ? `${fmtPercent(topCpuCapacity)} process share`
                : "No hot process sampled.",
          },
          {
            label: "Sample window",
            value: sampledProcessCount > 0 ? `${sampledProcessCount}` : "—",
            meta: "Visible non-aggregate processes in this window.",
          },
        ]}
      />
    ) : activeTopTab === "memory" ? (
      <FocusWorkbench
        tab="memory"
        title="Memory Workbench"
        subtitle="RAM pressure, resident memory leaders, and service-level memory share."
        pill={`${fmtSizeFromMb(hostVitals.memoryUsedMb)} / ${fmtSizeFromMb(hostVitals.memoryTotalMb)}`}
        items={memoryFocusItems}
        emptyLabel="No memory-heavy process samples are available yet."
        footer="Memory stays live while Linux can map the service PIDs; otherwise the panel falls back to the last trusted snapshot."
        stats={[
          {
            label: "Used now",
            value: fmtPercent(hostVitals.memoryUsedPercent),
            meta: `${fmtSizeFromMb(hostVitals.memoryUsedMb)} resident right now.`,
            tone: (hostVitals.memoryUsedPercent ?? 0) >= 85 ? "warn" : liveConnected ? "ok" : "default",
          },
          {
            label: "Free headroom",
            value: fmtSizeFromMb(memoryFreeMb),
            meta: `${fmtSizeFromMb(hostVitals.memoryTotalMb)} total on the box.`,
          },
          {
            label: "Tracked services",
            value: sampledProcessCount > 0 ? `${sampledProcessCount}` : "—",
            meta: "Processes contributing to the sampled memory view.",
          },
        ]}
      />
    ) : activeTopTab === "disk" ? (
      <FocusWorkbench
        tab="disk"
        title="Disk Workbench"
        subtitle="Root volume pressure, mounted volume telemetry, and the heaviest tracked project footprints on this VPS."
        pill={`${fmtPercent(hostVitals.diskUsedPercent)} root used`}
        items={diskFocusItems}
        emptyLabel="Tracked project roots have not reported disk data yet."
        footer={
          storageTtlLabel
            ? `Disk snapshots refresh about every ${storageTtlLabel}. Root pressure stays primary, and mounted-volume telemetry is shown separately so the top row stays clean.`
            : "Disk snapshots refresh on the patrol cadence. Root pressure stays primary, and mounted-volume telemetry is shown separately."
        }
        stats={[
          {
            label: "Root volume",
            value: fmtBytes(hostVitals.diskUsedBytes),
            meta: `${fmtBytes(hostVitals.diskTotalBytes)} total capacity.`,
            tone: diskTone,
          },
          {
            label: primaryMountedFilesystem?.label ?? "Mounted volume",
            value: fmtBytes(primaryMountedFilesystem?.usedBytes ?? null),
            meta:
              primaryMountedFilesystem
                ? `${fmtBytes(primaryMountedFilesystem.totalBytes)} total · ${primaryMountedFilesystem.path ?? "mounted path"}`
                : "No mounted volume tracked yet.",
            tone: mountedTone,
          },
          {
            label: "Free now",
            value: fmtBytes(hostVitals.diskAvailableBytes),
            meta: "Immediate headroom on the tracked root filesystem.",
          },
          {
            label: "Tracked apps",
            value: fmtBytes(totalTrackedDisk),
            meta: "Combined footprint across mapped project roots.",
          },
        ]}
      />
    ) : (
      <div role="tabpanel" id="power-vitals-tab-panel" aria-labelledby="power-vitals-tab-reclaim">
        <GarbageTile
          mode="workbench"
          estimate={garbageEstimate}
          connected={liveConnected}
          streamLabel={liveStreamLabel}
          canReclaim={canReclaim}
        >
          <ReclaimCategoryTile
            title="Garbage Dump"
            subtitle="Dead-weight junk you can usually delete outright."
            category="garbage"
            actionLabel="Clean Safe Junk"
            emptyLabel="No garbage-dump targets matched in the latest scan."
            estimate={garbageEstimate}
            connected={liveConnected}
            streamLabel={liveStreamLabel}
            canReclaim={canReclaim}
          />
          <ReclaimCategoryTile
            title="Recycling Center"
            subtitle="Caches and rebuildable artifacts that can regenerate later."
            category="recycling"
            actionLabel="Recycle Caches"
            emptyLabel="No recycling targets matched in the latest scan."
            estimate={garbageEstimate}
            connected={liveConnected}
            streamLabel={liveStreamLabel}
            canReclaim={canReclaim}
          />
        </GarbageTile>
      </div>
    );

  return (
    <section className="power-vitals-wrap">
      <Box className="power-vitals-shell">
        <div className="power-vitals-head">
          <div>
            <h2 className="power-vitals-title">Power / Memory / Disk / Reclaim</h2>
            <p className="power-vitals-subtitle">
              Select a lane to inspect live host pressure, tracked disk footprint, or reclaim actions with one shared operator panel.
            </p>
          </div>
          <span className={overviewChipClass}>{overviewChipLabel}</span>
        </div>

        <div className="power-vitals-reclaim-layout">
          <div className="power-vitals-kpi-grid" role="tablist" aria-label="Host vitals and reclaim focus">
            <PowerVitalsLiveGrid
              hostVitals={hostVitals}
              connected={liveConnected}
              streamLabel={liveStreamLabel}
              activeTab={activeTopTab}
              onSelectTab={handleTopTabSelect}
            />
            <GarbageTile
              mode="tab"
              estimate={garbageEstimate}
              connected={liveConnected}
              streamLabel={liveStreamLabel}
              canReclaim={canReclaim}
              active={activeTopTab === "reclaim"}
              onSelect={() => handleTopTabSelect("reclaim")}
            />
          </div>

          {activeFocusPanel}
        </div>

        {showCpuHotspot ? (
          <div className="pm-cpu-hotspot">
            <div className="pm-cpu-hotspot-title">
              CPU hotspot right now: {topCpuProcess?.name ?? "unknown"} ({fmtPercent(topCpuCapacity)} CPU cap)
            </div>
            <div className="pm-cpu-hotspot-sub">
              This is usually transient during builds/deploys. If it persists, check the Processes tab and restart or tune the hottest service.
            </div>
          </div>
        ) : null}

        <input className="pm-toggle-input" type="radio" id="pm-mode-projects" name="pm-mode" defaultChecked />
        <input className="pm-toggle-input" type="radio" id="pm-mode-processes" name="pm-mode" />
        <input className="pm-toggle-input" type="radio" id="pm-layout-tiles" name="pm-layout" defaultChecked />
        <input className="pm-toggle-input" type="radio" id="pm-layout-list" name="pm-layout" />

        <div className="power-vitals-controls">
          <div className="pm-toggle-group" role="group" aria-label="Power panel mode">
            <label className="pm-toggle-label" htmlFor="pm-mode-projects">
              Projects
            </label>
            <label className="pm-toggle-label" htmlFor="pm-mode-processes">
              Processes
            </label>
          </div>

          <div className="pm-toggle-group" role="group" aria-label="Project view layout">
            <label className="pm-toggle-label" htmlFor="pm-layout-tiles">
              Tiles
            </label>
            <label className="pm-toggle-label" htmlFor="pm-layout-list">
              List
            </label>
          </div>
        </div>

        <div className="pm-view pm-view-projects" aria-label="Projects overview">
          <div className="power-vitals-list-head">
            {projectCards.length} main project{projectCards.length === 1 ? "" : "s"} (status + CPU share + RAM by bound port/PID + Disk on tracked project trees)
          </div>

          <div className="pm-projects-tiles" role="list" aria-label="Projects tiles">
            {projectCards.map((p) => (
              <div key={p.key} className="pm-project-card" role="listitem">
                <div className="pm-project-top">
                  <div className="pm-project-title-stack">
                    {p.href ? (
                      <a className="pm-project-name pm-project-name-link" href={p.href} target="_blank" rel="noreferrer">
                        {p.name}
                      </a>
                    ) : (
                      <div className="pm-project-name">{p.name}</div>
                    )}
                    {p.backendLabel ? (
                      p.backendHrefResolved ? (
                        <a className="pm-project-sub pm-project-sub-link" href={p.backendHrefResolved} target="_blank" rel="noreferrer">
                          {p.backendLabel}
                        </a>
                      ) : (
                        <div className="pm-project-sub">{p.backendLabel}</div>
                      )
                    ) : null}
                  </div>

                  <div className={p.statusClass} title={p.portsLabel}>
                    <span className="pm-project-dot" />
                    {p.statusText}
                  </div>
                </div>

                <div className="pm-project-health-row">
                  {p.isDormant ? (
                    <>
                      <span className="pm-project-health-pill">pending deploy</span>
                      <span className="pm-project-health-pill">no live ports mapped yet</span>
                    </>
                  ) : (
                    <>
                      <span className={p.requiredUpCount === p.requiredCount ? "pm-project-health-pill pm-project-health-pill-ok" : "pm-project-health-pill pm-project-health-pill-bad"}>
                        required {p.requiredUpCount}/{p.requiredCount}
                      </span>
                      <span className="pm-project-health-pill">listening {p.listeningCount}/{p.services.length}</span>
                      <span className={p.publicCount > 0 ? "pm-project-health-pill pm-project-health-pill-warn" : "pm-project-health-pill"}>
                        public {p.publicCount}
                      </span>
                    </>
                  )}
                </div>

                <div className="pm-project-metrics">
                  <div className="pm-project-metric">
                    <div className="pm-project-metric-headline">
                      <div className="pm-project-metric-label">CPU</div>
                      <span className={p.telemetryBadge.className} title={p.telemetryBadge.title}>
                        {p.telemetryBadge.label}
                      </span>
                    </div>
                    <div className="pm-project-metric-value">{fmtPercent(p.cpuSharePercent)}</div>
                    <div className="pm-project-metric-sub">sampled process share</div>
                    <div className="pm-project-metric-bar">
                      <span style={{ width: `${p.cpuBarPercent}%` }} />
                      {p.hasCpuTelemetry ? (
                        <i className="pm-project-metric-marker" style={{ left: `${markerPercent(p.cpuBarPercent)}%` }} />
                      ) : null}
                    </div>
                  </div>
                  <div className="pm-project-metric">
                    <div className="pm-project-metric-headline">
                      <div className="pm-project-metric-label">RAM</div>
                    </div>
                    <div className="pm-project-metric-value">{fmtSizeFromMb(p.memoryMb)}</div>
                    <div className="pm-project-metric-sub">aggregate service memory</div>
                    <div className="pm-project-metric-bar">
                      <span style={{ width: `${p.memoryBarPercent}%` }} />
                      {p.hasMemoryTelemetry ? (
                        <i className="pm-project-metric-marker" style={{ left: `${markerPercent(p.memoryBarPercent)}%` }} />
                      ) : null}
                    </div>
                  </div>
                  <div className="pm-project-metric pm-project-metric-disk">
                    <div className="pm-project-metric-headline">
                      <div className="pm-project-metric-label">Disk</div>
                      {p.diskDeltaLabel ? <div className="pm-project-metric-trend">{p.diskDeltaLabel}</div> : null}
                    </div>
                    <div className="pm-project-metric-value pm-project-metric-value-disk">{fmtBytes(p.diskBytes)}</div>
                    <div className="pm-project-metric-sub">{p.diskMeta}</div>
                    {p.diskStatusLabel ? <div className="pm-project-metric-sub pm-project-metric-sub-alert">{p.diskStatusLabel}</div> : null}
                    <div className="pm-project-metric-bar">
                      <span style={{ width: `${p.diskBarPercent}%` }} />
                      {p.hasDiskTelemetry ? (
                        <i className="pm-project-metric-marker" style={{ left: `${markerPercent(p.diskBarPercent)}%` }} />
                      ) : null}
                    </div>
                  </div>
                </div>

                {p.missingRequired.length > 0 ? (
                  <div className="pm-project-missing">Missing required: {p.missingRequired.join(", ")}</div>
                ) : null}

                {(p.bucketHighlights.length || p.largestDirHighlights.length) ? (
                  <div className="pm-project-storage-grid">
                    {p.bucketHighlights.length ? (
                      <div className="pm-project-storage-panel">
                        <div className="pm-project-storage-label">Footprint Mix</div>
                        <div className="pm-project-storage-list">
                          {p.bucketHighlights.map((item) => (
                            <div key={`${p.key}-bucket-${item.label}`} className="pm-project-storage-item">
                              <span className="pm-project-storage-item-label">{item.label}</span>
                              <span className="pm-project-storage-item-value">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {p.largestDirHighlights.length ? (
                      <div className="pm-project-storage-panel">
                        <div className="pm-project-storage-label">Largest Paths</div>
                        <div className="pm-project-storage-list">
                          {p.largestDirHighlights.map((item) => (
                            <div key={`${p.key}-dir-${item.label}`} className="pm-project-storage-item">
                              <span className="pm-project-storage-item-label pm-project-storage-item-label-path">{item.label}</span>
                              <span className="pm-project-storage-item-value">{item.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="pm-project-services-text" aria-label="Per-service ports and process IDs">
                  {p.services.length > 0 ? (
                    p.services.map((svc) => (
                      <div
                        key={`${p.key}-${svc.label}-${svc.port}`}
                        className={svc.isListening ? "pm-project-service-line" : "pm-project-service-line pm-project-service-line-down"}
                      >
                        {svc.label}:{svc.port}
                        {typeof svc.pid === "number" ? ` #${svc.pid}` : ""}
                        {svc.isPublic ? " (public)" : ""}
                      </div>
                    ))
                  ) : (
                    <div className="pm-project-service-line">No live ports mapped yet.</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="pm-projects-list" role="list" aria-label="Projects list">
            {projectCards.map((p) => (
              <div key={p.key} className="pm-project-list-row" role="listitem">
                <div className="pm-project-list-name">
                  {p.href ? (
                    <a className="pm-project-list-title pm-project-list-title-link" href={p.href} target="_blank" rel="noreferrer">
                      {p.name}
                    </a>
                  ) : (
                    <div className="pm-project-list-title">{p.name}</div>
                  )}
                  {p.backendLabel ? (
                    p.backendHrefResolved ? (
                      <a className="pm-project-list-backend pm-project-list-backend-link" href={p.backendHrefResolved} target="_blank" rel="noreferrer">
                        {p.backendLabel}
                      </a>
                    ) : (
                      <div className="pm-project-list-backend">{p.backendLabel}</div>
                    )
                  ) : null}
                  <div className="pm-project-list-sub">
                    {p.isDormant
                      ? "pending deploy · dormant by design"
                      : `required ${p.requiredUpCount}/${p.requiredCount} · public ${p.publicCount}`}
                  </div>
                </div>

                <div className="pm-project-list-metric">
                  <div className="pm-project-list-metric-value">{fmtPercent(p.cpuSharePercent)}</div>
                  <div className="pm-project-list-metric-label">CPU share</div>
                </div>

                <div className="pm-project-list-metric">
                  <div className="pm-project-list-metric-value">{fmtSizeFromMb(p.memoryMb)}</div>
                  <div className="pm-project-list-metric-label">RAM</div>
                </div>

                <div className="pm-project-list-metric">
                  <div className="pm-project-list-metric-value">{fmtBytes(p.diskBytes)}</div>
                  <div className="pm-project-list-metric-label">Disk</div>
                </div>

                <div className="pm-project-list-status">
                  <div className={p.statusClass}>
                    <span className="pm-project-dot" />
                    {p.statusText}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="power-vitals-foot">
            Project CPU and RAM now refresh about every 4 seconds by matching service ports to live PIDs. When Linux
            hides a PID, the card falls back to the last trusted snapshot instead of guessing. Disk still comes from
            cached host-side tree scans{storageTtlLabel ? ` (target refresh ${storageTtlLabel})` : ""}, while host
            free space is refreshed separately by the patrol worker.
          </div>
        </div>

        <div className="pm-view pm-view-processes" aria-label="Processes overview">
          <div className="power-vitals-list-head">
            Process load ranking (CPU share across observed processes, target total 100%)
          </div>

          {rows.length ? (
            <div className="power-vitals-list" role="list" aria-label="Top VPS process load">
              {rows.map((row) => (
                <div
                  key={`${row.friendlyName}-${row.pid ?? "other"}`}
                  className="power-vitals-row"
                  role="listitem"
                  title={row.detailTitle ?? undefined}
                >
                  <div className="power-vitals-row-name">
                    <span className="power-vitals-row-proc">{row.friendlyName}</span>
                    <span className="power-vitals-row-pid">{row.secondaryText}</span>
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
                      {fmtSizeFromMb(row.memoryMb)} ({fmtPercent(row.memoryCapacityPercent)})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="power-vitals-empty">No process vitals in this snapshot yet. Run a fresh host report to populate.</div>
          )}

          <div className="power-vitals-foot">
            Sampled processes: {typeof d.vitalsSampledCount === "number" ? d.vitalsSampledCount : "—"} {" · "}
            CPU share sum: {fmtPercent(d.vitalsCpuShareTotalPercent)}
          </div>
        </div>
      </Box>
    </section>
  );
}