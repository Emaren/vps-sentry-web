"use client";

import React from "react";
import type { DashboardGarbageEstimate, DerivedDashboard } from "../_lib/derive";
import { MAIN_PROJECTS, type ProjectDef } from "../_lib/project-catalog";
import Box from "./Box";
import GarbageTile from "./GarbageTile";
import PowerVitalsLiveGrid, { type PowerVitalsTopTab } from "./PowerVitalsLiveGrid";
import ReclaimCategoryTile from "./ReclaimCategoryTile";
import { triggerGarbageReclaim } from "./reclaim-utils";

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

type ProjectStorageLocation = {
  storageClass: string | null;
  label: string | null;
  path: string | null;
  realPath: string | null;
  isSymlink: boolean | null;
  isRootResident: boolean | null;
  isVolumeBacked: boolean | null;
  mountPoint: string | null;
  deviceSource: string | null;
  filesystemType: string | null;
  volumeId: string | null;
  volumeLabel: string | null;
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
  deviceSource: string | null;
  deviceSizeBytes: number | null;
  filesystemType: string | null;
  mountPoint: string | null;
  filesystemGapBytes: number | null;
  filesystemResizePending: boolean | null;
  level: "ok" | "warn" | "critical" | null;
};

type ProjectStorageMountedFilesystem = ProjectStorageHostFilesystem & {
  id: string | null;
  label: string | null;
  exists: boolean | null;
  previousTotalBytes: number | null;
  capacityChangedBytes: number | null;
  capacityChangeDirection: "expanded" | "shrunk" | null;
};

type ProjectStorageRoot = {
  label: string | null;
  path: string | null;
  realPath: string | null;
  exists: boolean | null;
  diskBytes: number | null;
  storageLocation: ProjectStorageLocation | null;
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
  storageClass: string | null;
  storageLabel: string | null;
  rootResidentBytes: number | null;
  mountedVolumeBytes: number | null;
  symlinkedToVolumeBytes: number | null;
  volumeBackedBytes: number | null;
  otherMountBytes: number | null;
  roots: ProjectStorageRoot[];
  buckets: Record<string, ProjectStorageBucket>;
  largestDirs: ProjectStorageLargestDir[];
};

type ProjectStorageRootConsumer = {
  id: string;
  projectId: string | null;
  projectLabel: string | null;
  path: string | null;
  realPath: string | null;
  label: string;
  bytes: number | null;
  bucket: string | null;
  category: string | null;
  categoryLabel: string | null;
  reclaimability: string | null;
  storageClass: string | null;
  storageLabel: string | null;
};

type ProjectStorageRootResidency = {
  rootResidentBytes: number | null;
  mountedVolumeBytes: number | null;
  symlinkedToVolumeBytes: number | null;
  volumeBackedBytes: number | null;
  otherMountBytes: number | null;
  unknownStorageBytes: number | null;
  topRootProjects: ProjectStorageRootConsumer[];
  topConsumers: ProjectStorageRootConsumer[];
  categoryTotals: Array<{ key: string; label: string; bytes: number | null; count: number | null }>;
};

type ProjectStorageDiscoveryCandidate = {
  id: string;
  label: string;
  path: string | null;
  realPath: string | null;
  scope: string | null;
  state: string | null;
  storageLocation: ProjectStorageLocation | null;
  markerPaths: string[];
  suggestedNote: string | null;
};

type ProjectStorageDiscovery = {
  scope: string | null;
  mode: string | null;
  rootPaths: string[];
  candidates: ProjectStorageDiscoveryCandidate[];
};

type ProjectStoragePayload = {
  schemaVersion: number | null;
  measuredAt: string | null;
  ttlSeconds: number | null;
  bucketOrder: string[];
  hostFilesystem: ProjectStorageHostFilesystem | null;
  mountedFilesystems: ProjectStorageMountedFilesystem[];
  rootResidency: ProjectStorageRootResidency | null;
  discovery: ProjectStorageDiscovery | null;
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
  projectStorage?: unknown;
  projectVitals?: Record<string, Partial<ProjectLiveVitals>>;
  garbageEstimate?: DashboardGarbageEstimate | null;
  portsLocal?: PortEntry[];
  portsPublic?: PortEntry[];
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

function mergeProjectStorage(
  previous: ProjectStoragePayload | null,
  next: ProjectStoragePayload | null | undefined
): ProjectStoragePayload | null {
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

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
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

function parseStorageLocation(value: unknown): ProjectStorageLocation | null {
  const rec = asRecord(value);
  if (!Object.keys(rec).length) return null;
  return {
    storageClass: toStringOrNull(rec.class),
    label: toStringOrNull(rec.label),
    path: toStringOrNull(rec.path),
    realPath: toStringOrNull(rec.real_path),
    isSymlink: toBool(rec.is_symlink),
    isRootResident: toBool(rec.is_root_resident),
    isVolumeBacked: toBool(rec.is_volume_backed),
    mountPoint: toStringOrNull(rec.mount_point),
    deviceSource: toStringOrNull(rec.device_source),
    filesystemType: toStringOrNull(rec.filesystem_type),
    volumeId: toStringOrNull(rec.volume_id),
    volumeLabel: toStringOrNull(rec.volume_label),
  };
}

function parseRootConsumer(value: unknown, fallbackId: string): ProjectStorageRootConsumer | null {
  const rec = asRecord(value);
  const label = toStringOrNull(rec.label);
  if (!label) return null;
  return {
    id: toStringOrNull(rec.id) ?? fallbackId,
    projectId: toStringOrNull(rec.project_id),
    projectLabel: toStringOrNull(rec.project_label),
    path: toStringOrNull(rec.path),
    realPath: toStringOrNull(rec.real_path),
    label,
    bytes: toInt(rec.bytes),
    bucket: toStringOrNull(rec.bucket),
    category: toStringOrNull(rec.category),
    categoryLabel: toStringOrNull(rec.category_label),
    reclaimability: toStringOrNull(rec.reclaimability),
    storageClass: toStringOrNull(rec.storage_class),
    storageLabel: toStringOrNull(rec.storage_label),
  };
}

function parseRootResidency(value: unknown): ProjectStorageRootResidency | null {
  const rec = asRecord(value);
  if (!Object.keys(rec).length) return null;
  const categoryTotals = safeArray<Record<string, unknown>>(rec.category_totals)
    .map((entry) => ({
      key: toStringOrNull(entry.key) ?? "unknown",
      label: toStringOrNull(entry.label) ?? toStringOrNull(entry.key) ?? "Unknown",
      bytes: toInt(entry.bytes),
      count: toInt(entry.count),
    }))
    .filter((entry) => entry.label.length > 0);

  return {
    rootResidentBytes: toInt(rec.root_resident_bytes),
    mountedVolumeBytes: toInt(rec.mounted_volume_bytes),
    symlinkedToVolumeBytes: toInt(rec.symlinked_to_volume_bytes),
    volumeBackedBytes: toInt(rec.volume_backed_bytes),
    otherMountBytes: toInt(rec.other_mount_bytes),
    unknownStorageBytes: toInt(rec.unknown_storage_bytes),
    topRootProjects: safeArray<unknown>(rec.top_root_projects)
      .map((entry, index) => parseRootConsumer(entry, `root-project-${index}`))
      .filter((entry): entry is ProjectStorageRootConsumer => Boolean(entry)),
    topConsumers: safeArray<unknown>(rec.top_consumers)
      .map((entry, index) => parseRootConsumer(entry, `root-consumer-${index}`))
      .filter((entry): entry is ProjectStorageRootConsumer => Boolean(entry)),
    categoryTotals,
  };
}

function parseDiscovery(value: unknown): ProjectStorageDiscovery | null {
  const rec = asRecord(value);
  if (!Object.keys(rec).length) return null;
  const candidates = safeArray<Record<string, unknown>>(rec.candidates)
    .map((entry, index) => ({
      id: toStringOrNull(entry.id) ?? `candidate-${index}`,
      label: toStringOrNull(entry.label) ?? toStringOrNull(entry.id) ?? "Detected project",
      path: toStringOrNull(entry.path),
      realPath: toStringOrNull(entry.real_path),
      scope: toStringOrNull(entry.scope),
      state: toStringOrNull(entry.state),
      storageLocation: parseStorageLocation(entry.storage_location),
      markerPaths: safeArray<string>(entry.marker_paths).filter((item) => typeof item === "string" && item.trim().length > 0),
      suggestedNote: toStringOrNull(asRecord(entry.suggested_tracking).note),
    }))
    .filter((entry) => entry.label.length > 0);

  return {
    scope: toStringOrNull(rec.scope),
    mode: toStringOrNull(rec.mode),
    rootPaths: safeArray<string>(rec.root_paths).filter((item) => typeof item === "string" && item.trim().length > 0),
    candidates,
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
    const roots = safeArray<Record<string, unknown>>(project.roots).map((entry) => ({
      label: toStringOrNull(entry.label),
      path: toStringOrNull(entry.path),
      realPath: toStringOrNull(entry.real_path),
      exists: toBool(entry.exists),
      diskBytes: toInt(entry.disk_bytes),
      storageLocation: parseStorageLocation(entry.storage_location),
    }));

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
      storageClass: toStringOrNull(project.storage_class),
      storageLabel: toStringOrNull(project.storage_label),
      rootResidentBytes: toInt(project.root_resident_bytes),
      mountedVolumeBytes: toInt(project.mounted_volume_bytes),
      symlinkedToVolumeBytes: toInt(project.symlinked_to_volume_bytes),
      volumeBackedBytes: toInt(project.volume_backed_bytes),
      otherMountBytes: toInt(project.other_mount_bytes),
      roots,
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
    deviceSource: typeof entry.device_source === "string" ? entry.device_source : null,
    deviceSizeBytes: toInt(entry.device_size_bytes),
    filesystemType: typeof entry.filesystem_type === "string" ? entry.filesystem_type : null,
    mountPoint: typeof entry.mount_point === "string" ? entry.mount_point : null,
    filesystemGapBytes: toInt(entry.filesystem_gap_bytes),
    filesystemResizePending: typeof entry.filesystem_resize_pending === "boolean" ? entry.filesystem_resize_pending : null,
    previousTotalBytes: toInt(entry.previous_total_bytes),
    capacityChangedBytes: toInt(entry.capacity_changed_bytes),
    capacityChangeDirection:
      entry.capacity_change_direction === "expanded" || entry.capacity_change_direction === "shrunk"
        ? entry.capacity_change_direction
        : null,
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
          deviceSource: typeof hostFilesystemRec.device_source === "string" ? hostFilesystemRec.device_source : null,
          deviceSizeBytes: toInt(hostFilesystemRec.device_size_bytes),
          filesystemType: typeof hostFilesystemRec.filesystem_type === "string" ? hostFilesystemRec.filesystem_type : null,
          mountPoint: typeof hostFilesystemRec.mount_point === "string" ? hostFilesystemRec.mount_point : null,
          filesystemGapBytes: toInt(hostFilesystemRec.filesystem_gap_bytes),
          filesystemResizePending:
            typeof hostFilesystemRec.filesystem_resize_pending === "boolean"
              ? hostFilesystemRec.filesystem_resize_pending
              : null,
          level:
            hostFilesystemRec.level === "ok" || hostFilesystemRec.level === "warn" || hostFilesystemRec.level === "critical"
              ? hostFilesystemRec.level
              : null,
        }
      : null,
    mountedFilesystems,
    rootResidency: parseRootResidency(rec?.root_residency),
    discovery: parseDiscovery(rec?.discovery),
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

function storageClassLabel(storageClass: string | null | undefined): string {
  switch ((storageClass ?? "").trim()) {
    case "root_disk":
      return "root disk";
    case "mounted_volume":
      return "mounted volume";
    case "symlinked_to_volume":
      return "symlinked to volume";
    case "other_mount":
      return "other mount";
    case "mixed":
      return "mixed storage";
    case "missing":
      return "missing";
    default:
      return storageClass ? storageClass.replace(/_/g, " ") : "storage pending";
  }
}

function storageToneClass(storageClass: string | null | undefined): string {
  if (storageClass === "root_disk") return "pm-project-health-pill pm-project-health-pill-bad";
  if (storageClass === "symlinked_to_volume" || storageClass === "mounted_volume") {
    return "pm-project-health-pill pm-project-health-pill-ok";
  }
  if (storageClass === "mixed" || storageClass === "other_mount") {
    return "pm-project-health-pill pm-project-health-pill-warn";
  }
  return "pm-project-health-pill";
}

function rootPathLabel(root: ProjectStorageRoot | undefined): string | null {
  if (!root) return null;
  const path = root.path ?? null;
  const realPath = root.realPath ?? null;
  if (path && realPath && path !== realPath) return `${path} -> ${realPath}`;
  return path ?? realPath;
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

type SentryDiagnosisIssue = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: "ok" | "warn" | "bad";
};

type SentryDiagnosisLeader = {
  key: string;
  label: string;
  value: string;
  meta: string | null;
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

function SentryDiagnosisPanel(props: {
  issues: SentryDiagnosisIssue[];
  leaders: SentryDiagnosisLeader[];
  canReclaim: boolean;
  safeReclaimableBytes: number;
  busyAction: "scan" | "reclaim" | null;
  feedback: string | null;
  feedbackTone: "ok" | "bad" | "meta";
  onScanNow: () => void;
  onSafeReclaim: () => void;
  onInspectDisk: () => void;
  onInspectPower: () => void;
}) {
  const {
    busyAction,
    canReclaim,
    feedback,
    feedbackTone,
    issues,
    leaders,
    onInspectDisk,
    onInspectPower,
    onSafeReclaim,
    onScanNow,
    safeReclaimableBytes,
  } = props;
  const primaryIssue = issues[0];
  const canRunSafeReclaim = canReclaim && safeReclaimableBytes > 0 && busyAction === null;

  return (
    <div className="sentry-diagnosis-panel" aria-label="VPSSentry diagnosis and quick actions">
      <div className="sentry-diagnosis-main">
        <div className="sentry-diagnosis-head">
          <div>
            <div className="sentry-diagnosis-kicker">Sentry Diagnosis</div>
            <div className="sentry-diagnosis-title">
              {primaryIssue?.label ?? "No pressure blockers detected"}
            </div>
          </div>
          <div className={`sentry-diagnosis-status sentry-diagnosis-status-${primaryIssue?.tone ?? "ok"}`}>
            {primaryIssue?.value ?? "clear"}
          </div>
        </div>

        <div className="sentry-diagnosis-grid">
          {issues.map((issue) => (
            <div key={issue.key} className={`sentry-diagnosis-issue sentry-diagnosis-issue-${issue.tone}`}>
              <div className="sentry-diagnosis-issue-label">{issue.label}</div>
              <div className="sentry-diagnosis-issue-value">{issue.value}</div>
              <div className="sentry-diagnosis-issue-detail">{issue.detail}</div>
            </div>
          ))}
        </div>

        <div className="sentry-diagnosis-actions">
          <button
            type="button"
            className="sentry-diagnosis-button"
            onClick={onScanNow}
            disabled={busyAction !== null}
          >
            {busyAction === "scan" ? "Scanning..." : "Scan Now"}
          </button>
          <button
            type="button"
            className="sentry-diagnosis-button sentry-diagnosis-button-secondary"
            onClick={onInspectDisk}
          >
            Inspect Disk
          </button>
          <button
            type="button"
            className="sentry-diagnosis-button sentry-diagnosis-button-secondary"
            onClick={onInspectPower}
          >
            Inspect Power
          </button>
          <button
            type="button"
            className="sentry-diagnosis-button sentry-diagnosis-button-zap"
            onClick={onSafeReclaim}
            disabled={!canRunSafeReclaim}
          >
            {busyAction === "reclaim"
              ? "Zapping..."
              : safeReclaimableBytes > 0
                ? "Zap Safe Hogs"
                : "Safe Reclaim Empty"}
          </button>
        </div>

        {feedback ? (
          <div className={`sentry-diagnosis-feedback sentry-diagnosis-feedback-${feedbackTone}`}>
            {feedback}
          </div>
        ) : null}
      </div>

      <div className="sentry-diagnosis-side">
        <div className="sentry-diagnosis-side-title">Root pressure leaders</div>
        {leaders.length > 0 ? (
          <div className="sentry-diagnosis-leaders">
            {leaders.map((leader) => (
              <div key={leader.key} className="sentry-diagnosis-leader">
                <div>
                  <div className="sentry-diagnosis-leader-label">{leader.label}</div>
                  {leader.meta ? <div className="sentry-diagnosis-leader-meta">{leader.meta}</div> : null}
                </div>
                <div className="sentry-diagnosis-leader-value">{leader.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="sentry-diagnosis-empty">Disk leaders will appear after the next project storage scan.</div>
        )}
      </div>
    </div>
  );
}

export default function PowerMemoryTile(props: { derived: DerivedDashboard; canReclaim: boolean }) {
  const { canReclaim, derived: d } = props;
  const snapshotProjectStorage = pickProjectStorageFromDerived(d);

  const topRows = d.vitalsProcesses.filter((x) => !x.isOther).slice(0, 5);
  const otherRow = d.vitalsProcesses.find((x) => x.isOther);
  const rows = otherRow ? [...topRows, otherRow] : topRows;

  const initialPorts = React.useMemo(() => pickPortsFromDerived(d), [d]);
  const [livePorts, setLivePorts] = React.useState<{ local: PortEntry[]; pub: PortEntry[] }>(initialPorts);
  const { local: portsLocal, pub: portsPublic } = livePorts;
  const [projectStorage, setProjectStorage] = React.useState<ProjectStoragePayload | null>(snapshotProjectStorage);
  const mountedFilesystems = projectStorage?.mountedFilesystems ?? [];
  const rootResidency = projectStorage?.rootResidency ?? null;
  const discoveryCandidates = projectStorage?.discovery?.candidates ?? [];
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
    updatedTs: snapshotProjectStorage?.measuredAt ?? d.snapshotTs,
    cpuUsedPercent: d.cpuUsedPercent,
    cpuCapacityPercent: d.cpuCapacityPercent,
    cpuCores: d.cpuCores,
    memoryUsedPercent: d.memoryUsedPercent,
    memoryCapacityPercent: d.memoryCapacityPercent,
    memoryUsedMb: d.memoryUsedMb,
    memoryTotalMb: d.memoryTotalMb,
    diskUsedPercent: snapshotProjectStorage?.hostFilesystem?.usedPercent ?? null,
    diskUsedBytes: snapshotProjectStorage?.hostFilesystem?.usedBytes ?? null,
    diskTotalBytes: snapshotProjectStorage?.hostFilesystem?.totalBytes ?? null,
    diskAvailableBytes: snapshotProjectStorage?.hostFilesystem?.availableBytes ?? null,
  };
  const [hostVitals, setHostVitals] = React.useState<HostVitals>(initialHostVitals);
  const [garbageEstimate, setGarbageEstimate] = React.useState<DashboardGarbageEstimate | null>(d.garbageEstimate);
  const [projectLiveVitals, setProjectLiveVitals] = React.useState<Record<string, ProjectLiveVitals>>({});
  const [liveConnected, setLiveConnected] = React.useState(false);
  const [opsBusyAction, setOpsBusyAction] = React.useState<"scan" | "reclaim" | null>(null);
  const [opsFeedback, setOpsFeedback] = React.useState<string | null>(null);
  const [opsFeedbackTone, setOpsFeedbackTone] = React.useState<"ok" | "bad" | "meta">("meta");

  React.useEffect(() => {
    setLivePorts(initialPorts);
  }, [initialPorts]);
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
        const nextProjectStorage =
          payload.projectStorage === undefined ? undefined : parseProjectStoragePayload(payload.projectStorage);
        const nextLocal = Array.isArray(payload.portsLocal) ? payload.portsLocal : undefined;
        const nextPublic = Array.isArray(payload.portsPublic) ? payload.portsPublic : undefined;
        React.startTransition(() => {
          setHostVitals((current) => mergeHostVitals(current, payload.hostVitals));
          setProjectStorage((current) => mergeProjectStorage(current, nextProjectStorage));
          setGarbageEstimate((current) => mergeGarbageEstimate(current, payload.garbageEstimate));
          setProjectLiveVitals((current) => mergeProjectVitals(current, payload.projectVitals));
          if (nextLocal || nextPublic) {
            setLivePorts({
              local: nextLocal ?? [],
              pub: nextPublic ?? [],
            });
          }
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
      storage ? (storage.storageLabel ? storage.storageLabel : storageClassLabel(storage.storageClass)) : null,
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
    const primaryRoot = storage?.roots.find((root) => root.exists !== false) ?? storage?.roots[0];
    const storageClass = storage?.storageClass ?? primaryRoot?.storageLocation?.storageClass ?? null;
    const storageLabel = storage?.storageLabel ?? primaryRoot?.storageLocation?.label ?? storageClassLabel(storageClass);
    const rootPath = rootPathLabel(primaryRoot);
    const rootResidentBytes = storage?.rootResidentBytes ?? null;
    const volumeBackedBytes = storage?.volumeBackedBytes ?? null;
    const storageBreakdown = [
      typeof rootResidentBytes === "number" && rootResidentBytes > 0 ? `root ${fmtBytes(rootResidentBytes)}` : null,
      typeof volumeBackedBytes === "number" && volumeBackedBytes > 0 ? `volume ${fmtBytes(volumeBackedBytes)}` : null,
      rootPath,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" · ");

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
      storageClass,
      storageLabel,
      storageBreakdown,
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

  async function handleScanNow() {
    if (opsBusyAction) return;
    setOpsBusyAction("scan");
    setOpsFeedbackTone("meta");
    setOpsFeedback("Starting an immediate VPS scan...");
    try {
      const res = await fetch("/api/ops/scan-now", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        statusTs?: string;
        statusAdvanced?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setOpsFeedbackTone("ok");
      setOpsFeedback(
        data.statusAdvanced
          ? `Fresh scan landed at ${data.statusTs ?? "the latest snapshot"}.`
          : "Scan started. The live feed will update when the snapshot advances."
      );
    } catch (error: unknown) {
      setOpsFeedbackTone("bad");
      setOpsFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setOpsBusyAction(null);
    }
  }

  async function handleSafeReclaim() {
    if (opsBusyAction || !canReclaim) return;
    setOpsBusyAction("reclaim");
    setOpsFeedbackTone("meta");
    setOpsFeedback("Launching safe hog zap...");
    try {
      const data = await triggerGarbageReclaim("safe");
      setOpsFeedbackTone("ok");
      setOpsFeedback(data.detail || "Safe reclaim started. The reclaim lane will update as progress is published.");
      setActiveTopTab("reclaim");
    } catch (error: unknown) {
      setOpsFeedbackTone("bad");
      setOpsFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setOpsBusyAction(null);
    }
  }

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
  const diskFocusItems =
    rootResidency?.topConsumers && rootResidency.topConsumers.length > 0
      ? rootResidency.topConsumers.slice(0, 4).map((consumer) => ({
          key: `root-consumer-${consumer.id}`,
          label: consumer.projectLabel ? `${consumer.projectLabel}: ${consumer.label}` : consumer.label,
          value: fmtBytes(consumer.bytes),
          meta:
            [
              consumer.categoryLabel,
              consumer.reclaimability ? `posture ${consumer.reclaimability}` : null,
              consumer.storageLabel,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || "Root consumer.",
          note:
            [
              consumer.path,
              consumer.realPath && consumer.realPath !== consumer.path ? `real ${consumer.realPath}` : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join(" · ") || null,
        }))
      : projectCards
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
                project.storageBreakdown,
                project.diskDeltaLabel,
                project.largestDirHighlights[0]
                  ? `${project.largestDirHighlights[0].label} · ${project.largestDirHighlights[0].value}`
                  : null,
              ]
                .filter((value): value is string => Boolean(value))
                .join(" · ") || null,
          }));
  const safeReclaimableBytes = Math.max(0, garbageEstimate?.safeReclaimableBytes ?? 0);
  const guidedReclaimableBytes = Math.max(0, garbageEstimate?.guidedReclaimableBytes ?? 0);
  const reclaimableBytes = Math.max(0, garbageEstimate?.reclaimableBytesTotal ?? safeReclaimableBytes);
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
  const mountedResizePending =
    primaryMountedFilesystem?.filesystemResizePending === true &&
    typeof primaryMountedFilesystem.deviceSizeBytes === "number" &&
    typeof primaryMountedFilesystem.totalBytes === "number" &&
    primaryMountedFilesystem.deviceSizeBytes > primaryMountedFilesystem.totalBytes;
  const mountedTone =
    mountedResizePending || primaryMountedFilesystem?.level === "critical" || primaryMountedFilesystem?.level === "warn"
      ? "warn"
      : primaryMountedFilesystem?.level === "ok"
        ? "ok"
        : "default";
  const mountedUsageMeta = primaryMountedFilesystem
    ? [
        typeof primaryMountedFilesystem.usedBytes === "number"
          ? `${fmtBytes(primaryMountedFilesystem.usedBytes)} used`
          : null,
        typeof primaryMountedFilesystem.usedPercent === "number"
          ? `${fmtPercent(primaryMountedFilesystem.usedPercent)} full`
          : null,
        primaryMountedFilesystem.path ?? null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : null;
  const mountedResizeMeta =
    primaryMountedFilesystem &&
    typeof primaryMountedFilesystem.totalBytes === "number" &&
    typeof primaryMountedFilesystem.previousTotalBytes === "number" &&
    typeof primaryMountedFilesystem.capacityChangedBytes === "number" &&
    primaryMountedFilesystem.capacityChangedBytes !== 0
      ? `${
          primaryMountedFilesystem.capacityChangeDirection === "shrunk" ? "Resized down" : "Expanded"
        } from ${fmtBytes(primaryMountedFilesystem.previousTotalBytes)} by ${fmtSignedBytes(primaryMountedFilesystem.capacityChangedBytes)}`
      : null;
  const mountedResizePendingMeta =
    mountedResizePending && primaryMountedFilesystem
      ? [
          `Device ${fmtBytes(primaryMountedFilesystem.deviceSizeBytes)}`,
          `filesystem still ${fmtBytes(primaryMountedFilesystem.totalBytes)} usable`,
          typeof primaryMountedFilesystem.filesystemGapBytes === "number"
            ? `${fmtBytes(primaryMountedFilesystem.filesystemGapBytes)} not yet usable`
            : "filesystem grow pending",
        ].join(" · ")
      : null;
  const mountedDeviceMeta =
    !mountedResizePending &&
    primaryMountedFilesystem &&
    typeof primaryMountedFilesystem.deviceSizeBytes === "number" &&
    typeof primaryMountedFilesystem.totalBytes === "number"
      ? `Device ${fmtBytes(primaryMountedFilesystem.deviceSizeBytes)} · filesystem usable ${fmtBytes(primaryMountedFilesystem.totalBytes)}`
      : null;
  const mountedCapacityValue =
    mountedResizePending && primaryMountedFilesystem
      ? `${fmtBytes(primaryMountedFilesystem.deviceSizeBytes)} device`
      : fmtBytes(primaryMountedFilesystem?.totalBytes ?? null);
  const mountedMeta = primaryMountedFilesystem
    ? (mountedResizePendingMeta
        ? [mountedResizePendingMeta, mountedUsageMeta]
        : [mountedDeviceMeta, mountedResizeMeta, mountedUsageMeta]
      )
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : "No mounted volume tracked yet.";
  const diskUsedPercent = hostVitals.diskUsedPercent ?? hostFilesystem?.usedPercent ?? null;
  const diskFailPercent = hostFilesystem?.failPercent ?? 92;
  const diskWarnPercent = hostFilesystem?.warnPercent ?? 85;
  const diskCritical =
    hostFilesystem?.level === "critical" ||
    (typeof diskUsedPercent === "number" &&
      typeof diskFailPercent === "number" &&
      diskUsedPercent >= diskFailPercent);
  const diskWarning =
    !diskCritical &&
    (hostFilesystem?.level === "warn" ||
      (typeof diskUsedPercent === "number" &&
        typeof diskWarnPercent === "number" &&
        diskUsedPercent >= diskWarnPercent));
  const memoryCritical = (hostVitals.memoryUsedPercent ?? 0) >= 92;
  const memoryWarning = !memoryCritical && (hostVitals.memoryUsedPercent ?? 0) >= 85;
  const safeReclaimEmptyUnderPressure = (diskCritical || diskWarning) && safeReclaimableBytes <= 0;
  const diagnosisIssues: SentryDiagnosisIssue[] = [];

  if (diskCritical || diskWarning) {
    diagnosisIssues.push({
      key: "disk-pressure",
      label: diskCritical ? "Root disk above fail line" : "Root disk nearing fail line",
      value: fmtPercent(diskUsedPercent),
      detail: `${fmtBytes(hostVitals.diskAvailableBytes)} free on /. Safe reclaim: ${fmtBytes(safeReclaimableBytes)}${
        guidedReclaimableBytes > 0 ? ` · guided: ${fmtBytes(guidedReclaimableBytes)}` : ""
      }.`,
      tone: diskCritical ? "bad" : "warn",
    });
  }

  if (safeReclaimEmptyUnderPressure) {
    diagnosisIssues.push({
      key: "safe-reclaim-empty",
      label: "Safe reclaim catalog is empty",
      value: "0B safe",
      detail:
        reclaimableBytes > 0
          ? "Only guided/manual reclaim remains; inspect root pressure leaders before deleting anything."
          : "No safe cleanup target matched; the next move is guided review of the largest root-resident app trees.",
      tone: "warn",
    });
  }

  if (showCpuHotspot) {
    diagnosisIssues.push({
      key: "cpu-hotspot",
      label: "CPU hotspot is active",
      value: fmtPercent(topCpuCapacity),
      detail: `${topCpuProcess?.friendlyName ?? topCpuProcess?.name ?? "Unknown process"} is the current pressure leader. Refresh evidence before restarting anything.`,
      tone: "warn",
    });
  }

  if (memoryCritical || memoryWarning) {
    diagnosisIssues.push({
      key: "memory-pressure",
      label: memoryCritical ? "Memory pressure is critical" : "Memory pressure is elevated",
      value: fmtPercent(hostVitals.memoryUsedPercent),
      detail: `${fmtSizeFromMb(memoryFreeMb)} headroom remains. Inspect the Memory lane before restarting a resident service.`,
      tone: memoryCritical ? "bad" : "warn",
    });
  }

  if (diagnosisIssues.length === 0) {
    diagnosisIssues.push({
      key: "clear",
      label: "No pressure blocker in the latest vitals",
      value: "clear",
      detail: "Scan cadence and project telemetry are available; keep watching for drift or exposure alerts.",
      tone: "ok",
    });
  }

  const diagnosisLeaders: SentryDiagnosisLeader[] = diskFocusItems.slice(0, 4).map((item) => ({
    key: item.key,
    label: item.label,
    value: item.value,
    meta: item.note ?? item.meta,
  }));

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
        subtitle="Root pressure, mounted-volume health, and which project mass actually lives on each filesystem."
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
            value: mountedCapacityValue,
            meta: mountedMeta,
            tone: mountedTone,
          },
          {
            label: "Free now",
            value: fmtBytes(hostVitals.diskAvailableBytes),
            meta: "Immediate headroom on the tracked root filesystem.",
          },
          {
            label: "Root-resident",
            value: fmtBytes(rootResidency?.rootResidentBytes ?? null),
            meta: "Tracked project bytes still living on /.",
            tone: (rootResidency?.rootResidentBytes ?? 0) > 0 ? "warn" : "ok",
          },
          {
            label: "Volume-backed",
            value: fmtBytes(rootResidency?.volumeBackedBytes ?? null),
            meta: "Tracked project bytes on mounted volume paths or symlinks.",
            tone: (rootResidency?.volumeBackedBytes ?? 0) > 0 ? "ok" : "default",
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

        <SentryDiagnosisPanel
          issues={diagnosisIssues}
          leaders={diagnosisLeaders}
          canReclaim={canReclaim}
          safeReclaimableBytes={safeReclaimableBytes}
          busyAction={opsBusyAction}
          feedback={opsFeedback}
          feedbackTone={opsFeedbackTone}
          onScanNow={handleScanNow}
          onSafeReclaim={handleSafeReclaim}
          onInspectDisk={() => handleTopTabSelect("disk")}
          onInspectPower={() => handleTopTabSelect("power")}
        />

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

          {discoveryCandidates.length > 0 ? (
            <div className="pm-project-discovery" aria-label="Untracked project discovery">
              <div className="pm-project-discovery-head">
                <div>
                  <div className="pm-project-discovery-kicker">Project Discovery</div>
                  <div className="pm-project-discovery-title">
                    VPS-side scan found {discoveryCandidates.length} likely untracked project{discoveryCandidates.length === 1 ? "" : "s"}.
                  </div>
                </div>
                <div className="pm-project-health-pill pm-project-health-pill-warn">VPS scan only</div>
              </div>
              <div className="pm-project-discovery-note">
                Local MBP tracking is not inferred in the browser. Add local roots through a committed registry entry or a local command-driven discovery pass.
              </div>
              <div className="pm-project-discovery-list">
                {discoveryCandidates.slice(0, 4).map((candidate) => (
                  <div key={candidate.id} className="pm-project-discovery-row">
                    <div>
                      <div className="pm-project-discovery-name">{candidate.label}</div>
                      <div className="pm-project-discovery-path">
                        {candidate.path}
                        {candidate.realPath && candidate.realPath !== candidate.path ? ` -> ${candidate.realPath}` : ""}
                      </div>
                      {candidate.suggestedNote ? (
                        <div className="pm-project-discovery-note">{candidate.suggestedNote}</div>
                      ) : null}
                    </div>
                    <div className={storageToneClass(candidate.storageLocation?.storageClass)}>
                      {candidate.storageLocation?.label ?? storageClassLabel(candidate.storageLocation?.storageClass)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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
                      <span className={storageToneClass(p.storageClass)}>{p.storageLabel}</span>
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
                      <span className={storageToneClass(p.storageClass)}>{p.storageLabel}</span>
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
                    {p.storageBreakdown ? <div className="pm-project-metric-sub">{p.storageBreakdown}</div> : null}
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
                      ? `pending deploy · dormant by design · ${p.storageLabel}`
                      : `required ${p.requiredUpCount}/${p.requiredCount} · public ${p.publicCount} · ${p.storageLabel}`}
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
