export type CommandValidationIssue = {
  index: number;
  command: string;
  reason: string;
};

export type CommandGuardPolicy = {
  enforceAllowlist: boolean;
  maxCommandsPerAction: number;
  maxCommandLength: number;
  allowlist: RegExp[];
  blocklist: RegExp[];
};

export type CommandGuardOverrides = Partial<{
  enforceAllowlist: boolean;
  maxCommandsPerAction: number;
  maxCommandLength: number;
}>;

const DEFAULT_ALLOWLIST: RegExp[] = [
  /^sudo(\s+-n)?\s+(cp|ls|journalctl|ufw|nft|ss|lsof|getent|systemctl|vps-sentry|grep)\b/i,
  /^grep\b/i,
];

const DEFAULT_BLOCKLIST: RegExp[] = [
  /(^|[\s;|&])(rm\s+-rf)\b/i,
  /(^|[\s;|&])(mkfs|fdisk|parted)\b/i,
  /(^|[\s;|&])(shutdown|reboot|halt|poweroff)\b/i,
  /(^|[\s;|&])(dd\s+if=)\b/i,
  /(:\(\)\s*\{)/i,
  /(curl|wget).*\|\s*(sh|bash)/i,
];

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const t = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function parseRegexEnv(name: string): RegExp[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const entries = raw
    .split(/\n|\|\|/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: RegExp[] = [];
  for (const entry of entries) {
    try {
      out.push(new RegExp(entry, "i"));
    } catch {
      // ignore invalid user regex entries
    }
  }
  return out;
}

function isSkippable(raw: string): boolean {
  const t = raw.trim();
  return !t || t.startsWith("#");
}

export function readCommandGuardPolicy(): CommandGuardPolicy {
  return {
    enforceAllowlist: parseBoolEnv("VPS_REMEDIATE_ENFORCE_ALLOWLIST", true),
    maxCommandsPerAction: clamp(parseIntEnv("VPS_REMEDIATE_MAX_COMMANDS_PER_ACTION", 20), 1, 200),
    maxCommandLength: clamp(parseIntEnv("VPS_REMEDIATE_MAX_COMMAND_LENGTH", 800), 10, 8000),
    allowlist: [...DEFAULT_ALLOWLIST, ...parseRegexEnv("VPS_REMEDIATE_ALLOWLIST_REGEX")],
    blocklist: [...DEFAULT_BLOCKLIST, ...parseRegexEnv("VPS_REMEDIATE_BLOCKLIST_REGEX")],
  };
}

export function applyCommandGuardOverrides(
  base: CommandGuardPolicy,
  overrides?: CommandGuardOverrides
): CommandGuardPolicy {
  if (!overrides) return base;
  return {
    ...base,
    enforceAllowlist:
      typeof overrides.enforceAllowlist === "boolean"
        ? overrides.enforceAllowlist
        : base.enforceAllowlist,
    maxCommandsPerAction:
      typeof overrides.maxCommandsPerAction === "number"
        ? clamp(Math.trunc(overrides.maxCommandsPerAction), 1, 200)
        : base.maxCommandsPerAction,
    maxCommandLength:
      typeof overrides.maxCommandLength === "number"
        ? clamp(Math.trunc(overrides.maxCommandLength), 10, 8000)
        : base.maxCommandLength,
  };
}

export function validateRemediationCommands(
  commands: string[],
  policy = readCommandGuardPolicy()
): CommandValidationIssue[] {
  const issues: CommandValidationIssue[] = [];

  if (commands.length > policy.maxCommandsPerAction) {
    issues.push({
      index: -1,
      command: "",
      reason: `too_many_commands:${commands.length}>${policy.maxCommandsPerAction}`,
    });
    return issues;
  }

  commands.forEach((raw, idx) => {
    if (isSkippable(raw)) return;

    if (raw.length > policy.maxCommandLength) {
      issues.push({
        index: idx,
        command: raw,
        reason: `command_too_long:${raw.length}>${policy.maxCommandLength}`,
      });
      return;
    }

    for (const denied of policy.blocklist) {
      if (denied.test(raw)) {
        issues.push({
          index: idx,
          command: raw,
          reason: `blocked_pattern:${denied.source}`,
        });
        return;
      }
    }

    if (policy.enforceAllowlist) {
      const allowed = policy.allowlist.some((allow) => allow.test(raw));
      if (!allowed) {
        issues.push({
          index: idx,
          command: raw,
          reason: "not_allowlisted",
        });
      }
    }
  });

  return issues;
}
