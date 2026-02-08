import {
  applyCommandGuardOverrides,
  type CommandGuardOverrides,
  type CommandGuardPolicy,
} from "@/lib/remediate/guard";
import {
  applyRemediationPolicyOverrides,
  type RemediationPolicy,
  type RemediationPolicyOverrides,
} from "@/lib/remediate/policy";

export type RemediationPolicyProfile = "strict" | "balanced" | "rapid";

export type HostRemediationPolicyConfig = {
  profile: RemediationPolicyProfile;
  overrides: RemediationPolicyOverrides;
  guardOverrides: CommandGuardOverrides;
};

type HostMetaRecord = Record<string, unknown>;

const PROFILE_POLICY_OVERRIDES: Record<RemediationPolicyProfile, RemediationPolicyOverrides> = {
  strict: {
    dryRunMaxAgeMinutes: 20,
    executeCooldownMinutes: 15,
    maxExecutePerHour: 2,
    timelineDedupeWindowMinutes: 20,
    maxQueuePerHost: 2,
    maxQueueTotal: 100,
    queueTtlMinutes: 60,
    commandTimeoutMs: 15_000,
    maxBufferBytes: 256_000,
    queueAutoDrain: false,
  },
  balanced: {},
  rapid: {
    dryRunMaxAgeMinutes: 60,
    executeCooldownMinutes: 1,
    maxExecutePerHour: 20,
    timelineDedupeWindowMinutes: 45,
    maxQueuePerHost: 10,
    maxQueueTotal: 800,
    queueTtlMinutes: 240,
    commandTimeoutMs: 30_000,
    maxBufferBytes: 1_000_000,
  },
};

const PROFILE_GUARD_OVERRIDES: Record<RemediationPolicyProfile, CommandGuardOverrides> = {
  strict: {
    enforceAllowlist: true,
    maxCommandsPerAction: 10,
    maxCommandLength: 500,
  },
  balanced: {},
  rapid: {
    enforceAllowlist: true,
    maxCommandsPerAction: 30,
    maxCommandLength: 1200,
  },
};

function asRecord(v: unknown): HostMetaRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as HostMetaRecord;
}

function parseMetaJson(metaJson: string | null | undefined): HostMetaRecord {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
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

export function normalizeRemediationPolicyProfile(v: unknown): RemediationPolicyProfile {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "strict" || t === "rapid") return t;
  return "balanced";
}

export function readHostRemediationPolicyConfig(metaJson: string | null | undefined): HostRemediationPolicyConfig {
  const meta = parseMetaJson(metaJson);
  const remediation = asRecord(meta.remediationPolicy) ?? {};
  const overridesRaw = asRecord(remediation.overrides) ?? {};
  const guardOverridesRaw = asRecord(remediation.guardOverrides) ?? {};

  const overrides: RemediationPolicyOverrides = {
    dryRunMaxAgeMinutes: parseIntMaybe(overridesRaw.dryRunMaxAgeMinutes),
    executeCooldownMinutes: parseIntMaybe(overridesRaw.executeCooldownMinutes),
    maxExecutePerHour: parseIntMaybe(overridesRaw.maxExecutePerHour),
    timelineDedupeWindowMinutes: parseIntMaybe(overridesRaw.timelineDedupeWindowMinutes),
    maxQueuePerHost: parseIntMaybe(overridesRaw.maxQueuePerHost),
    maxQueueTotal: parseIntMaybe(overridesRaw.maxQueueTotal),
    queueTtlMinutes: parseIntMaybe(overridesRaw.queueTtlMinutes),
    commandTimeoutMs: parseIntMaybe(overridesRaw.commandTimeoutMs),
    maxBufferBytes: parseIntMaybe(overridesRaw.maxBufferBytes),
    queueAutoDrain: parseBoolMaybe(overridesRaw.queueAutoDrain),
  };

  const guardOverrides: CommandGuardOverrides = {
    enforceAllowlist: parseBoolMaybe(guardOverridesRaw.enforceAllowlist),
    maxCommandsPerAction: parseIntMaybe(guardOverridesRaw.maxCommandsPerAction),
    maxCommandLength: parseIntMaybe(guardOverridesRaw.maxCommandLength),
  };

  return {
    profile: normalizeRemediationPolicyProfile(remediation.profile),
    overrides,
    guardOverrides,
  };
}

export function resolveHostRemediationPolicy(input: {
  metaJson: string | null | undefined;
  globalPolicy: RemediationPolicy;
  globalGuardPolicy: CommandGuardPolicy;
}) {
  const config = readHostRemediationPolicyConfig(input.metaJson);

  const profilePolicy = PROFILE_POLICY_OVERRIDES[config.profile];
  const profileGuard = PROFILE_GUARD_OVERRIDES[config.profile];

  const policy = applyRemediationPolicyOverrides(
    applyRemediationPolicyOverrides(input.globalPolicy, profilePolicy),
    config.overrides
  );
  const guardPolicy = applyCommandGuardOverrides(
    applyCommandGuardOverrides(input.globalGuardPolicy, profileGuard),
    config.guardOverrides
  );

  return {
    profile: config.profile,
    policy,
    guardPolicy,
    config,
  };
}

export function mergeHostRemediationPolicyMeta(params: {
  currentMetaJson: string | null | undefined;
  profile?: RemediationPolicyProfile | null;
  overrides?: RemediationPolicyOverrides;
  guardOverrides?: CommandGuardOverrides;
}): string {
  const root = parseMetaJson(params.currentMetaJson);

  const currentRemediation = asRecord(root.remediationPolicy) ?? {};
  const currentOverrides = asRecord(currentRemediation.overrides) ?? {};
  const currentGuardOverrides = asRecord(currentRemediation.guardOverrides) ?? {};

  const nextOverrides: HostMetaRecord = {
    ...currentOverrides,
    ...(params.overrides as HostMetaRecord | undefined),
  };
  const nextGuardOverrides: HostMetaRecord = {
    ...currentGuardOverrides,
    ...(params.guardOverrides as HostMetaRecord | undefined),
  };

  const remediation: HostMetaRecord = {
    ...currentRemediation,
    profile: params.profile ?? normalizeRemediationPolicyProfile(currentRemediation.profile),
    overrides: nextOverrides,
    guardOverrides: nextGuardOverrides,
  };

  const merged: HostMetaRecord = {
    ...root,
    remediationPolicy: remediation,
  };

  return JSON.stringify(merged);
}
