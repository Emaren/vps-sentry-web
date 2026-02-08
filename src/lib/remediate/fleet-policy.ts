type AnyRecord = Record<string, unknown>;

export type HostFleetPolicyConfig = {
  group: string | null;
  tags: string[];
  scopes: string[];
  rolloutPaused: boolean;
  rolloutPriority: number;
};

export type HostFleetPolicyPatch = Partial<{
  group: string | null;
  tags: string[];
  scopes: string[];
  rolloutPaused: boolean;
  rolloutPriority: number;
}>;

export type HostFleetPolicyDelta = {
  setGroup?: string | null;
  setTags?: string[];
  addTags?: string[];
  removeTags?: string[];
  setScopes?: string[];
  addScopes?: string[];
  removeScopes?: string[];
  rolloutPaused?: boolean;
  rolloutPriority?: number;
};

export type FleetSelector = {
  hostIds?: string[];
  groups?: string[];
  tagsAll?: string[];
  tagsAny?: string[];
  scopesAll?: string[];
  scopesAny?: string[];
  enabledOnly?: boolean;
  includePaused?: boolean;
};

export type FleetBlastRadiusPolicy = {
  maxHosts: number;
  maxPerGroup: number;
  maxPercentOfEnabledFleet: number;
  defaultStageSize: number;
  requireSelector: boolean;
  maxPolicyUpdateHosts: number;
};

export type FleetHostCandidate = {
  id: string;
  name: string;
  enabled: boolean;
  lastSeenAt: Date | null;
  metaJson: string | null;
  fleet: HostFleetPolicyConfig;
};

export type FleetSafeguardRejection = {
  hostId: string;
  reason: "max_hosts" | "max_per_group";
};

export type FleetSafeguardResult = {
  accepted: FleetHostCandidate[];
  rejected: FleetSafeguardRejection[];
  maxHostsEffective: number;
  maxPerGroupEffective: number;
  maxPercentOfEnabledFleetEffective: number;
  allowedByPercent: number;
};

export type FleetRolloutStrategy = "group_canary" | "sequential";

function asRecord(v: unknown): AnyRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as AnyRecord;
}

function parseMetaJson(metaJson: string | null | undefined): AnyRecord {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  const t = Math.trunc(v);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function parseIntMaybe(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

function parseBoolMaybe(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return undefined;
}

function normalizeToken(input: unknown, maxLen = 64): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return cleaned.length ? cleaned : null;
}

function normalizeTokenArray(input: unknown, maxItems = 30, maxLen = 64): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const token = normalizeToken(raw, maxLen);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeOptionalTokenArray(input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  return normalizeTokenArray(input);
}

function normalizeHostIds(input: unknown): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 500) break;
  }
  return out;
}

function parseIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const t = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

export function readHostFleetPolicyConfig(metaJson: string | null | undefined): HostFleetPolicyConfig {
  const root = parseMetaJson(metaJson);
  const fleet = asRecord(root.fleetPolicy) ?? {};
  const group = normalizeToken(fleet.group, 64);
  const tags = normalizeTokenArray(fleet.tags, 40, 64);
  const scopes = normalizeTokenArray(fleet.scopes, 40, 64);
  const rolloutPaused = parseBoolMaybe(fleet.rolloutPaused) ?? false;
  const rolloutPriority = clampInt(parseIntMaybe(fleet.rolloutPriority) ?? 0, -100, 100);
  return {
    group,
    tags,
    scopes,
    rolloutPaused,
    rolloutPriority,
  };
}

export function mergeHostFleetPolicyMeta(params: {
  currentMetaJson: string | null | undefined;
  patch: HostFleetPolicyPatch;
}): string {
  const root = parseMetaJson(params.currentMetaJson);
  const current = readHostFleetPolicyConfig(params.currentMetaJson);
  const next: HostFleetPolicyConfig = {
    group:
      params.patch.group === undefined
        ? current.group
        : params.patch.group === null
        ? null
        : normalizeToken(params.patch.group, 64),
    tags:
      params.patch.tags === undefined
        ? current.tags
        : normalizeTokenArray(params.patch.tags, 40, 64),
    scopes:
      params.patch.scopes === undefined
        ? current.scopes
        : normalizeTokenArray(params.patch.scopes, 40, 64),
    rolloutPaused:
      typeof params.patch.rolloutPaused === "boolean"
        ? params.patch.rolloutPaused
        : current.rolloutPaused,
    rolloutPriority:
      typeof params.patch.rolloutPriority === "number"
        ? clampInt(Math.trunc(params.patch.rolloutPriority), -100, 100)
        : current.rolloutPriority,
  };

  const fleetPolicy: AnyRecord = {
    group: next.group,
    tags: next.tags,
    scopes: next.scopes,
    rolloutPaused: next.rolloutPaused,
    rolloutPriority: next.rolloutPriority,
  };

  const merged: AnyRecord = {
    ...root,
    fleetPolicy,
  };

  return JSON.stringify(merged);
}

export function applyFleetPolicyDelta(
  current: HostFleetPolicyConfig,
  delta: HostFleetPolicyDelta
): HostFleetPolicyConfig {
  const nextTags = (() => {
    if (delta.setTags !== undefined) return normalizeTokenArray(delta.setTags, 40, 64);
    const set = new Set(current.tags);
    for (const tag of normalizeTokenArray(delta.addTags, 40, 64)) set.add(tag);
    for (const tag of normalizeTokenArray(delta.removeTags, 40, 64)) set.delete(tag);
    return Array.from(set).slice(0, 40);
  })();
  const nextScopes = (() => {
    if (delta.setScopes !== undefined) return normalizeTokenArray(delta.setScopes, 40, 64);
    const set = new Set(current.scopes);
    for (const scope of normalizeTokenArray(delta.addScopes, 40, 64)) set.add(scope);
    for (const scope of normalizeTokenArray(delta.removeScopes, 40, 64)) set.delete(scope);
    return Array.from(set).slice(0, 40);
  })();

  return {
    group:
      delta.setGroup === undefined
        ? current.group
        : delta.setGroup === null
        ? null
        : normalizeToken(delta.setGroup, 64),
    tags: nextTags,
    scopes: nextScopes,
    rolloutPaused:
      typeof delta.rolloutPaused === "boolean"
        ? delta.rolloutPaused
        : current.rolloutPaused,
    rolloutPriority:
      typeof delta.rolloutPriority === "number"
        ? clampInt(Math.trunc(delta.rolloutPriority), -100, 100)
        : current.rolloutPriority,
  };
}

export function normalizeFleetSelector(input: unknown): FleetSelector {
  const r = asRecord(input) ?? {};
  return {
    hostIds: normalizeHostIds(r.hostIds),
    groups: normalizeOptionalTokenArray(r.groups),
    tagsAll: normalizeOptionalTokenArray(r.tagsAll),
    tagsAny: normalizeOptionalTokenArray(r.tagsAny),
    scopesAll: normalizeOptionalTokenArray(r.scopesAll),
    scopesAny: normalizeOptionalTokenArray(r.scopesAny),
    enabledOnly: parseBoolMaybe(r.enabledOnly),
    includePaused: parseBoolMaybe(r.includePaused),
  };
}

export function hasFleetSelectorFilter(selector: FleetSelector): boolean {
  return Boolean(
    selector.hostIds?.length ||
      selector.groups?.length ||
      selector.tagsAll?.length ||
      selector.tagsAny?.length ||
      selector.scopesAll?.length ||
      selector.scopesAny?.length ||
      selector.enabledOnly
  );
}

export function hostMatchesFleetSelector(
  host: Pick<FleetHostCandidate, "id" | "enabled" | "fleet">,
  selector: FleetSelector
): boolean {
  if (selector.enabledOnly && !host.enabled) return false;
  if (selector.includePaused !== true && host.fleet.rolloutPaused) return false;
  if (selector.hostIds?.length && !selector.hostIds.includes(host.id)) return false;
  if (selector.groups?.length) {
    const group = host.fleet.group ?? "";
    if (!group || !selector.groups.includes(group)) return false;
  }
  if (selector.tagsAll?.length) {
    for (const tag of selector.tagsAll) {
      if (!host.fleet.tags.includes(tag)) return false;
    }
  }
  if (selector.tagsAny?.length) {
    if (!selector.tagsAny.some((tag) => host.fleet.tags.includes(tag))) return false;
  }
  if (selector.scopesAll?.length) {
    for (const scope of selector.scopesAll) {
      if (!host.fleet.scopes.includes(scope)) return false;
    }
  }
  if (selector.scopesAny?.length) {
    if (!selector.scopesAny.some((scope) => host.fleet.scopes.includes(scope))) return false;
  }
  return true;
}

export function sortFleetHostsForRollout(hosts: FleetHostCandidate[]): FleetHostCandidate[] {
  return hosts.slice().sort((a, b) => {
    if (a.fleet.rolloutPriority !== b.fleet.rolloutPriority) {
      return b.fleet.rolloutPriority - a.fleet.rolloutPriority;
    }
    const aSeen = a.lastSeenAt ? a.lastSeenAt.getTime() : 0;
    const bSeen = b.lastSeenAt ? b.lastSeenAt.getTime() : 0;
    if (aSeen !== bSeen) return bSeen - aSeen;
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.id.localeCompare(b.id);
  });
}

export function readFleetBlastRadiusPolicy(): FleetBlastRadiusPolicy {
  return {
    maxHosts: clampInt(parseIntEnv("VPS_REMEDIATE_FLEET_MAX_HOSTS", 12), 1, 500),
    maxPerGroup: clampInt(parseIntEnv("VPS_REMEDIATE_FLEET_MAX_PER_GROUP", 5), 1, 200),
    maxPercentOfEnabledFleet: clampInt(
      parseIntEnv("VPS_REMEDIATE_FLEET_MAX_PERCENT_ENABLED", 40),
      1,
      100
    ),
    defaultStageSize: clampInt(
      parseIntEnv("VPS_REMEDIATE_FLEET_DEFAULT_STAGE_SIZE", 3),
      1,
      100
    ),
    requireSelector: parseBoolEnv("VPS_REMEDIATE_FLEET_REQUIRE_SELECTOR", true),
    maxPolicyUpdateHosts: clampInt(
      parseIntEnv("VPS_REMEDIATE_FLEET_POLICY_MAX_HOST_UPDATES", 60),
      1,
      1000
    ),
  };
}

export function applyFleetBlastRadiusSafeguards(input: {
  hosts: FleetHostCandidate[];
  totalEnabledFleet: number;
  maxHosts: number;
  maxPerGroup: number;
  maxPercentOfEnabledFleet: number;
}): FleetSafeguardResult {
  const maxHostsEffective = clampInt(input.maxHosts, 1, 500);
  const maxPerGroupEffective = clampInt(input.maxPerGroup, 1, 200);
  const maxPercentOfEnabledFleetEffective = clampInt(
    input.maxPercentOfEnabledFleet,
    1,
    100
  );
  const allowedByPercent = Math.max(
    1,
    Math.floor((Math.max(1, input.totalEnabledFleet) * maxPercentOfEnabledFleetEffective) / 100)
  );
  const allowedTotal = Math.min(maxHostsEffective, allowedByPercent);

  const accepted: FleetHostCandidate[] = [];
  const rejected: FleetSafeguardRejection[] = [];
  const byGroup = new Map<string, number>();

  for (const host of input.hosts) {
    if (accepted.length >= allowedTotal) {
      rejected.push({ hostId: host.id, reason: "max_hosts" });
      continue;
    }
    const groupKey = host.fleet.group ?? "__ungrouped";
    const groupCount = byGroup.get(groupKey) ?? 0;
    if (groupCount >= maxPerGroupEffective) {
      rejected.push({ hostId: host.id, reason: "max_per_group" });
      continue;
    }
    accepted.push(host);
    byGroup.set(groupKey, groupCount + 1);
  }

  return {
    accepted,
    rejected,
    maxHostsEffective,
    maxPerGroupEffective,
    maxPercentOfEnabledFleetEffective,
    allowedByPercent,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function buildFleetRolloutStages(
  hosts: FleetHostCandidate[],
  stageSize: number,
  strategy: FleetRolloutStrategy
): FleetHostCandidate[][] {
  const size = clampInt(stageSize, 1, 100);
  if (hosts.length === 0) return [];

  if (strategy === "sequential") {
    return chunk(hosts, size);
  }

  const grouped = new Map<string, FleetHostCandidate[]>();
  for (const host of hosts) {
    const key = host.fleet.group ?? "__ungrouped";
    const arr = grouped.get(key) ?? [];
    arr.push(host);
    grouped.set(key, arr);
  }

  const groupKeys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
  const canaryWave: FleetHostCandidate[] = [];
  for (const key of groupKeys) {
    const arr = grouped.get(key);
    if (!arr?.length) continue;
    const first = arr.shift();
    if (first) canaryWave.push(first);
  }

  const remaining: FleetHostCandidate[] = [];
  for (const key of groupKeys) {
    const arr = grouped.get(key);
    if (!arr?.length) continue;
    remaining.push(...arr);
  }

  const waves: FleetHostCandidate[][] = [];
  if (canaryWave.length) {
    waves.push(...chunk(canaryWave, size));
  }
  if (remaining.length) {
    waves.push(...chunk(remaining, size));
  }
  return waves;
}
