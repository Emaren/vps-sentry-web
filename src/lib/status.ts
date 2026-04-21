// /var/www/vps-sentry-web/src/lib/status.ts
export type Alert = {
  title: string;
  detail?: string;
  severity?: "info" | "warn" | "critical";
  code?: string;
  ts?: string;
};

export type Port = {
  proto: string;
  host: string;
  port: number;
  proc: string;
  pid: number;
  public: boolean;
  sig: string;
};

export type Breach = {
  id?: string;
  title: string;
  detail?: string;
  severity?: "info" | "warn" | "critical";
  code?: string;
  opened_ts?: string;
  fixed_ts?: string;
  state?: "open" | "fixed" | "ignored";
  evidence?: Record<string, unknown>;
};

export type Shipping = {
  last_ship_ok?: boolean;
  last_ship_ts?: string;
  last_ship_error?: string;
};

export type VitalsProcess = {
  pid?: number;
  name?: string;
  label?: string;
  ports?: number[];
  unit?: string;
  exe?: string;
  cmdline?: string;
  cwd?: string;
  project?: string;
  project_label?: string;
  service_kind?: string;
  tech?: string;
  cpu_share_percent?: number;
  cpu_capacity_percent?: number;
  memory_mb?: number;
  memory_capacity_percent?: number;
};

export type Vitals = {
  cpu?: {
    used_percent?: number | null;
    capacity_percent?: number;
    cores?: number;
  };
  memory?: {
    total_mb?: number;
    used_mb?: number;
    available_mb?: number;
    used_percent?: number | null;
    capacity_percent?: number;
  };
  processes?: {
    sampled_count?: number;
    top?: VitalsProcess[];
    other?: VitalsProcess | null;
    cpu_share_total_percent?: number;
  };
};

export type ProjectStorageLargestDir = {
  label?: string;
  disk_bytes?: number;
};

export type ProjectStorageLocation = {
  class?: "root_disk" | "mounted_volume" | "symlinked_to_volume" | "other_mount" | "missing" | string;
  label?: string;
  path?: string;
  real_path?: string;
  is_symlink?: boolean;
  is_root_resident?: boolean;
  is_volume_backed?: boolean;
  mount_point?: string;
  device_source?: string;
  filesystem_type?: string;
  volume_id?: string;
  volume_label?: string;
};

export type ProjectStorageBucket = {
  label?: string;
  disk_bytes?: number;
  apparent_bytes?: number;
  file_count?: number;
  match_count?: number;
};

export type ProjectStorageRoot = {
  label?: string;
  path?: string;
  real_path?: string;
  exists?: boolean;
  disk_bytes?: number;
  apparent_bytes?: number;
  file_count?: number;
  storage_location?: ProjectStorageLocation;
  buckets?: Record<string, ProjectStorageBucket>;
  largest_dirs?: ProjectStorageLargestDir[];
};

export type ProjectStorageProject = {
  id?: string;
  label?: string;
  measured_at?: string;
  previous_measured_at?: string;
  roots_configured?: number;
  roots_present?: number;
  disk_bytes?: number;
  apparent_bytes?: number;
  file_count?: number;
  delta_disk_bytes?: number;
  delta_apparent_bytes?: number;
  delta_file_count?: number;
  storage_class?: string;
  storage_label?: string;
  root_resident_bytes?: number;
  mounted_volume_bytes?: number;
  symlinked_to_volume_bytes?: number;
  volume_backed_bytes?: number;
  other_mount_bytes?: number;
  roots?: ProjectStorageRoot[];
  buckets?: Record<string, ProjectStorageBucket>;
  largest_dirs?: ProjectStorageLargestDir[];
};

export type ProjectStorageHostFilesystem = {
  path?: string;
  measured_at?: string;
  total_bytes?: number;
  used_bytes?: number;
  available_bytes?: number;
  used_percent?: number;
  warn_percent?: number;
  fail_percent?: number;
  device_source?: string;
  device_size_bytes?: number;
  filesystem_type?: string;
  mount_point?: string;
  filesystem_gap_bytes?: number;
  filesystem_resize_pending?: boolean;
  level?: "ok" | "warn" | "critical";
};

export type ProjectStorageMountedFilesystem = ProjectStorageHostFilesystem & {
  id?: string;
  label?: string;
  exists?: boolean;
  previous_total_bytes?: number;
  capacity_changed_bytes?: number;
  capacity_change_direction?: "expanded" | "shrunk";
};

export type ProjectStorageRootConsumer = {
  id?: string;
  project_id?: string;
  project_label?: string;
  path?: string;
  real_path?: string;
  label?: string;
  bytes?: number;
  bucket?: string;
  category?: string;
  category_label?: string;
  reclaimability?: string;
  storage_class?: string;
  storage_label?: string;
};

export type ProjectStorageDiscoveryCandidate = {
  id?: string;
  label?: string;
  path?: string;
  real_path?: string;
  scope?: "vps" | "local" | string;
  state?: "untracked" | "ignored" | "tracked" | string;
  storage_location?: ProjectStorageLocation;
  marker_paths?: string[];
  suggested_tracking?: {
    vps_roots?: string[];
    local_roots?: string[];
    note?: string;
  };
};

export type ProjectStorageSnapshot = {
  schema_version?: number;
  measured_at?: string;
  ttl_seconds?: number;
  top_dirs_limit?: number;
  top_dirs_depth?: number;
  bucket_order?: string[];
  host_filesystem?: ProjectStorageHostFilesystem;
  mounted_filesystems?: ProjectStorageMountedFilesystem[];
  root_residency?: {
    root_resident_bytes?: number;
    mounted_volume_bytes?: number;
    symlinked_to_volume_bytes?: number;
    volume_backed_bytes?: number;
    other_mount_bytes?: number;
    unknown_storage_bytes?: number;
    top_root_projects?: ProjectStorageRootConsumer[];
    top_consumers?: ProjectStorageRootConsumer[];
    category_totals?: Array<{
      key?: string;
      label?: string;
      bytes?: number;
      count?: number;
    }>;
  };
  discovery?: {
    scope?: string;
    mode?: string;
    root_paths?: string[];
    candidates?: ProjectStorageDiscoveryCandidate[];
  };
  projects?: Record<string, ProjectStorageProject>;
};

export type GarbageEstimateBucket = {
  key?: string;
  label?: string;
  bytes?: number;
  count?: number;
};

export type GarbageEstimateTopPath = {
  path?: string;
  bytes?: number;
  bucket?: string;
};

export type GarbageEstimateCategoryTotal = {
  key?: string;
  label?: string;
  description?: string;
  bytes?: number;
  count?: number;
};

export type GarbageEstimateRiskTotal = {
  key?: string;
  label?: string;
  bytes?: number;
  count?: number;
};

export type GarbageEstimateCandidate = {
  id?: string;
  key?: string;
  label?: string;
  path?: string;
  bytes?: number;
  action?: string;
  kind?: string;
  category?: string;
  category_label?: string;
  risk?: string;
  risk_label?: string;
  requires_stop?: boolean;
  regrows?: boolean;
  explanation?: string;
  preview_command?: string;
  execute_command?: string;
  project_id?: string;
  project_label?: string;
  project_url?: string;
  service_refs?: string[];
};

export type GarbageCleanupBucket = {
  key?: string;
  label?: string;
  estimated_bytes?: number;
  deleted_count?: number;
};

export type GarbageCleanupResult = {
  ok?: boolean;
  started_at?: string;
  finished_at?: string;
  freed_bytes_estimated?: number;
  freed_bytes_actual?: number;
  root_available_before_bytes?: number;
  root_available_after_bytes?: number;
  deleted_count?: number;
  buckets?: GarbageCleanupBucket[];
  errors?: string[];
};

export type GarbageCleanupProgress = {
  started_at?: string;
  updated_at?: string;
  phase?: string;
  current_label?: string;
  current_target?: string;
  current_command?: string;
  completed_steps?: number;
  total_steps?: number;
  errors_count?: number;
  eta_seconds?: number | null;
  recent_lines?: string[];
};

export type GarbageEstimateSnapshot = {
  schema_version?: number;
  measured_at?: string;
  ttl_seconds?: number;
  reclaimable_bytes_total?: number;
  safe_reclaimable_bytes?: number;
  garbage_reclaimable_bytes?: number;
  rebuildable_bytes?: number;
  guided_reclaimable_bytes?: number;
  blocked_reclaimable_bytes?: number;
  category_totals?: GarbageEstimateCategoryTotal[];
  risk_totals?: GarbageEstimateRiskTotal[];
  buckets?: GarbageEstimateBucket[];
  top_paths?: GarbageEstimateTopPath[];
  candidates?: GarbageEstimateCandidate[];
  running_cleanup?: boolean;
  last_cleanup_result?: GarbageCleanupResult | null;
  cleanup_progress?: GarbageCleanupProgress | null;
};

export type Status = {
  host: string;
  version: string;
  ts: string;

  baseline_last_accepted_ts?: string;

  alerts_count: number;
  alerts: Alert[];

  public_ports_count: number;
  ports_public: Port[];
  ports_local?: Port[];

  auth?: {
    new_ssh_accepts_count: number;
    ssh_failed_password: number;
    ssh_invalid_user: number;
  };

  threat?: {
    suspicious_processes?: unknown[];
    top_cpu?: unknown[];
    outbound_suspicious?: unknown[];
    persistence_hits?: unknown[];
    indicators?: Array<{
      id: string;
      severity: "info" | "warn" | "critical";
      title: string;
      detail?: string;
    }>;
  };

  breaches_open?: number;
  breaches_fixed?: number;
  breaches?: Breach[];

  shipping?: Shipping;
  vitals?: Vitals;
  project_storage?: ProjectStorageSnapshot;
  garbage_estimate?: GarbageEstimateSnapshot;

  [k: string]: unknown;
};

export type StatusEnvelope = {
  ok?: boolean;
  ts?: string;
  status?: Partial<Status> & Record<string, unknown>;
  last?: Partial<Status> & Record<string, unknown>;
  diff?: unknown;
  warnings?: string[];
  paths?: {
    status?: string;
    last?: string;
    diff?: string;
  };
  [k: string]: unknown;
};

export function safeJson(v: unknown): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) => (typeof val === "bigint" ? val.toString() : val),
      2
    );
  } catch {
    try {
      return String(v);
    } catch {
      return "[unprintable]";
    }
  }
}

export function fmt(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export function fmtAny(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return fmt(v);
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === "bigint") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return new Date(n).toLocaleString();
  }
  if (typeof v === "number") {
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toLocaleString();
  }
  return String(v);
}

export function minutesAgo(ts?: string): number | null {
  if (!ts) return null;
  const d = new Date(ts);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  return Math.round(diffMs / 60000);
}

function pickArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function pickNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}

export function normalizeStatusEnvelope(data: Status | StatusEnvelope) {
  const env = (data ?? {}) as StatusEnvelope;

  const source =
    (env.status ?? env.last ?? (data as Status)) as Partial<Status> &
      Record<string, unknown>;

  const alerts = pickArray<Alert>(source.alerts);
  const portsPublic = pickArray<Port>(source.ports_public);
  const breaches = pickArray<Breach>(source.breaches);

  const alertsCount = pickNumber(source.alerts_count) ?? alerts.length;
  const publicPortsCount =
    pickNumber(source.public_ports_count) ?? portsPublic.length;

  const breachesOpen =
    pickNumber(source.breaches_open) ??
    breaches.filter((b) => (b?.state ?? "open") === "open").length;

  const breachesFixed =
    pickNumber(source.breaches_fixed) ??
    breaches.filter((b) => (b?.state ?? "") === "fixed").length;

  const ts = pickString(source.ts) ?? pickString(env.ts) ?? new Date().toISOString();

  const last: Status = {
    host: pickString(source.host) ?? "—",
    version: pickString(source.version) ?? "—",
    ts,

    baseline_last_accepted_ts:
      pickString(source.baseline_last_accepted_ts) ?? undefined,

    alerts_count: alertsCount,
    alerts,

    public_ports_count: publicPortsCount,
    ports_public: portsPublic,

    auth: (source.auth as Status["auth"]) ?? undefined,
    threat: (source.threat as Status["threat"]) ?? undefined,

    breaches_open:
      breaches.length || source.breaches_open !== undefined ? breachesOpen : undefined,
    breaches_fixed:
      breaches.length || source.breaches_fixed !== undefined ? breachesFixed : undefined,
    breaches: breaches.length ? breaches : undefined,

    shipping: (source.shipping as Status["shipping"]) ?? undefined,
    vitals: (source.vitals as Status["vitals"]) ?? undefined,

    ...source,
  };

  return {
    ok: Boolean(env.ok ?? true),
    ts: env.ts ?? ts,
    last,
    diff: env.diff,
    warnings: Array.isArray(env.warnings) ? env.warnings : undefined,
    paths: env.paths,
    raw: data,
  };
}
