/**
 * VPSSentry → Kingdom OS bounded, read-only fleet projection.
 * VPSSentry remains the only producer for its HEL1 observations. M1/Intel are
 * NEVER inferred from HEL1, the caller's location, or unsigned browser data.
 */
export const FLEET_SCHEMA = "aoe2war.vpssentry.kingdom-fleet.v1";
export const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
export const VOLUME_PATH = "/mnt/HC_Volume_105319120";
export const STATUS_MAX_BYTES = 1_048_576;

export type FleetState = "LIVE" | "STALE" | "UNVERIFIED";
export type FleetScope =
  | "hel1-root"
  | "hel1-volume-105319120"
  | "m1-dev-mac"
  | "intel-cold-storage";

export type FleetEvidence = {
  producer: string;
  identity: string | null;
  sha256: string | null;
  observedAt: string | null;
  inspectedAt: string;
  ttlSeconds: number | null;
  scope: FleetScope | "hel1-sentry";
  coverage: "measured" | "partial" | "unavailable";
  state: FleetState;
  reason: string | null;
};

export type FleetCapacity = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
};

export type FleetPlane = {
  id: FleetScope;
  label: string;
  evidence: FleetEvidence;
  capacity: FleetCapacity | null;
  link: string;
};

export type FleetPort = {
  protocol: string;
  port: number;
  process: string;
  allowed: boolean;
  purpose: string;
  evidence: FleetEvidence;
};

export type FleetAlert = {
  id: string;
  code: string;
  severity: string;
  reason: string;
  lifecycle: "DETECTED";
  evidence: FleetEvidence;
};

export type FleetGuided = {
  rootBytes: number;
  mountedVolumeBytes: number;
  unknownScopeBytes: number;
  safeNowBytes: number;
  totalGuidedBytes: number;
  candidates: Array<{ path: string; bytes: number; scope: "root" | "mounted-volume" | "unknown"; class: string }>;
  evidence: FleetEvidence;
};

export type FleetProjection = {
  schema: typeof FLEET_SCHEMA;
  producer: "VPSSentry";
  exportedAt: string;
  sourceStatus: FleetEvidence;
  planes: FleetPlane[];
  reclaim: FleetGuided;
  alerts: FleetAlert[];
  ports: FleetPort[];
  host: {
    cpuUsedPercent: number | null;
    memoryUsedPercent: number | null;
    services: null;
    timers: null;
    failureCounts: null;
    sourceDrift: null;
    activeIncidentIds: null;
    coverage: "partial";
    evidence: FleetEvidence;
  };
  permissions: { readOnly: true; permitGeneration: false; rootMutation: false; financialAuthorized: false };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 512) : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e16
    ? value : null;
}

function string(value: unknown, max = 300): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function freshness(ts: unknown, ttl: number, now: Date): { state: FleetState; observedAt: string | null; reason: string | null } {
  const value = string(ts, 64);
  if (!value) return { state: "UNVERIFIED", observedAt: null, reason: "Missing source timestamp" };
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return { state: "UNVERIFIED", observedAt: null, reason: "Invalid source timestamp" };
  const age = now.getTime() - millis;
  if (age < -60_000) return { state: "UNVERIFIED", observedAt: value, reason: "Source clock is in the future" };
  if (age > ttl * 1000) return { state: "STALE", observedAt: value, reason: "Source age exceeds TTL" };
  return { state: "LIVE", observedAt: value, reason: null };
}

function evidence(input: {
  producer: string;
  identity: string | null;
  sha256: string | null;
  ts: unknown;
  ttl: number;
  scope: FleetEvidence["scope"];
  now: Date;
  coverage?: FleetEvidence["coverage"];
}): FleetEvidence {
  const age = freshness(input.ts, input.ttl, input.now);
  return {
    producer: input.producer,
    identity: input.identity,
    sha256: input.sha256,
    observedAt: age.observedAt,
    inspectedAt: input.now.toISOString(),
    ttlSeconds: input.ttl,
    scope: input.scope,
    coverage: input.coverage ?? "measured",
    state: age.state,
    reason: age.reason,
  };
}

function capacity(value: unknown): FleetCapacity | null {
  const obj = record(value);
  const total = num(obj.total_bytes);
  const used = num(obj.used_bytes);
  const available = num(obj.available_bytes);
  const percent = num(obj.used_percent);
  if (total === null || used === null || available === null || percent === null ||
      total <= 0 || used > total || available > total || percent > 100) return null;
  return { totalBytes: total, usedBytes: used, availableBytes: available, usedPercent: percent };
}

const STORAGE_LINK = "https://aoe2war.com/admin/storage-os/explorer";

function missingExternal(id: FleetScope, label: string, now: Date): FleetPlane {
  return {
    id, label, link: STORAGE_LINK, capacity: null,
    evidence: {
      producer: id === "m1-dev-mac" ? "VPSSentry Mac Storage Pulse" : "VPSSentry Intel source observer",
      identity: null, sha256: null, observedAt: null, inspectedAt: now.toISOString(),
      ttlSeconds: null, scope: id, coverage: "unavailable",
      state: "UNVERIFIED",
      reason: "No independently admitted signed observation at this consumer; host power state unknown",
    },
  };
}

function portPurpose(protocol: string, port: number): string {
  if (protocol === "tcp" && port === 27656) return "WoloChain peer listener; approved exposure must still match firewall policy";
  if (protocol === "udp" && port === 68) return "systemd-networkd DHCP client; socket binding is not proof of inbound reachability";
  return "Classified by existing VPSSentry allowlist; exposure review remains independent";
}

function allowed(protocol: string, port: number, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const exact = pattern === protocol + ":" + port;
    if (exact) return true;
    const m = new RegExp("^" + protocol + ":(\\d+)-(\\d+)$").exec(pattern);
    return !!m && port >= Number(m[1]) && port <= Number(m[2]);
  });
}

export function projectFleetStatus(status: unknown, sourceSha256: string, now: Date = new Date()): FleetProjection {
  const obj = record(status);
  const storage = record(obj.project_storage);
  const snapshotTs = obj.ts;
  const source = evidence({
    producer: "VPSSentry HEL1 root-owned status.json",
    identity: string(obj.host, 128), sha256: sourceSha256,
    ts: snapshotTs, ttl: 900, scope: "hel1-sentry", now,
  });
  const storageTtl = num(storage.ttl_seconds) ?? 3600;
  const root = record(storage.host_filesystem);
  const mounted = list(storage.mounted_filesystems)
    .map(record).find((x) => x.mount_point === VOLUME_PATH) ?? {};
  const plane = (id: FleetScope, label: string, raw: Record<string, unknown>): FleetPlane => {
    const cap = capacity(raw);
    const actual = evidence({
      producer: "VPSSentry HEL1 storage agent",
      identity: source.identity, sha256: sourceSha256,
      ts: raw.measured_at ?? storage.measured_at ?? snapshotTs,
      ttl: storageTtl, scope: id, now,
      coverage: cap ? "measured" : "unavailable",
    });
    if (!cap) {
      actual.state = "UNVERIFIED";
      actual.reason = "Missing or invalid filesystem bytes";
    }
    return { id, label, link: STORAGE_LINK, capacity: cap, evidence: actual };
  };

  const garbage = record(obj.garbage_estimate);
  const candidates = list(garbage.candidates).map(record).flatMap((c) => {
    const path = string(c.path, 512);
    const bytes = num(c.bytes);
    if (path === null || bytes === null || c.risk !== "guided") return [];
    const scope: "root" | "mounted-volume" | "unknown" =
      path === VOLUME_PATH || path.startsWith(VOLUME_PATH + "/")
        ? "mounted-volume" : path.startsWith("/var/") ? "root" : "unknown";
    return [{ path, bytes, scope, class: string(c.key, 100) ?? "unknown" }];
  });
  const reclaimEvidence = evidence({
    producer: "VPSSentry guided reclaim catalog", identity: source.identity, sha256: sourceSha256,
    ts: garbage.measured_at ?? snapshotTs, ttl: num(garbage.ttl_seconds) ?? 600,
    scope: "hel1-sentry", now,
  });
  const reclaim: FleetGuided = {
    rootBytes: candidates.filter((c) => c.scope === "root").reduce((s, c) => s + c.bytes, 0),
    mountedVolumeBytes: candidates.filter((c) => c.scope === "mounted-volume").reduce((s, c) => s + c.bytes, 0),
    unknownScopeBytes: candidates.filter((c) => c.scope === "unknown").reduce((s, c) => s + c.bytes, 0),
    safeNowBytes: num(garbage.safe_reclaimable_bytes) ?? 0,
    totalGuidedBytes: num(garbage.guided_reclaimable_bytes) ?? 0,
    candidates, evidence: reclaimEvidence,
  };

  const alerts: FleetAlert[] = list(obj.alerts).map(record).flatMap((a) => {
    const code = string(a.code, 96);
    if (!code) return [];
    return [{
      id: code + ":" + (string(a.path, 256) ?? "host"),
      code, severity: string(a.severity, 40) ?? "unknown",
      reason: string(a.detail, 300) ?? "No detail provided",
      lifecycle: "DETECTED" as const,
      evidence: source,
    }];
  });
  const expected = list(obj.expected_public_ports)
    .filter((v): v is string => typeof v === "string").slice(0, 100);
  const ports: FleetPort[] = list(obj.ports_public).map(record).flatMap((p) => {
    const port = num(p.port);
    const protocol = string(p.proto, 10);
    if (port === null || port > 65535 || protocol === null) return [];
    return [{
      protocol, port, process: string(p.proc, 80) ?? "unknown",
      allowed: allowed(protocol, port, expected),
      purpose: portPurpose(protocol, port), evidence: source,
    }];
  });
  const cpu = record(record(obj.vitals).cpu);
  const memory = record(record(obj.vitals).memory);
  return {
    schema: FLEET_SCHEMA, producer: "VPSSentry", exportedAt: now.toISOString(),
    sourceStatus: source,
    planes: [
      plane("hel1-root", "HEL1 root", root),
      plane("hel1-volume-105319120", "HEL1 mounted volume", mounted),
      missingExternal("m1-dev-mac", "M1 Dev Mac", now),
      missingExternal("intel-cold-storage", "Intel Cold Storage", now),
    ],
    reclaim, alerts, ports,
    host: {
      cpuUsedPercent: num(cpu.used_percent),
      memoryUsedPercent: num(memory.used_percent),
      services: null, timers: null, failureCounts: null, sourceDrift: null, activeIncidentIds: null,
      coverage: "partial", evidence: source,
    },
    permissions: { readOnly: true, permitGeneration: false, rootMutation: false, financialAuthorized: false },
  };
}
