import crypto from "node:crypto";

export const HOST_KEY_SCOPE_ORDER = [
  "host.status.write",
  "host.status.read",
  "host.history.read",
] as const;

export type HostKeyScope = (typeof HOST_KEY_SCOPE_ORDER)[number];

export const HOST_KEY_DEFAULT_SCOPES: HostKeyScope[] = [...HOST_KEY_SCOPE_ORDER];

const HOST_KEY_SCOPE_SET = new Set<string>(HOST_KEY_SCOPE_ORDER);

export type HostKeyTokenBundle = {
  token: string;
  tokenHash: string;
  prefix: string;
  version: number;
};

function toSafeVersion(input: number): number {
  if (!Number.isFinite(input)) return 1;
  const t = Math.trunc(input);
  if (t < 1) return 1;
  if (t > 9999) return 9999;
  return t;
}

export function normalizeHostKeyScope(raw: unknown): HostKeyScope | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!HOST_KEY_SCOPE_SET.has(t)) return null;
  return t as HostKeyScope;
}

function dedupeScopes(scopes: HostKeyScope[]): HostKeyScope[] {
  const seen = new Set<HostKeyScope>();
  const out: HostKeyScope[] = [];
  for (const scope of HOST_KEY_SCOPE_ORDER) {
    if (scopes.includes(scope) && !seen.has(scope)) {
      out.push(scope);
      seen.add(scope);
    }
  }
  return out;
}

export function normalizeHostKeyScopes(
  raw: unknown,
  fallback: HostKeyScope[] = HOST_KEY_DEFAULT_SCOPES
): HostKeyScope[] {
  const collected: HostKeyScope[] = [];

  const collectOne = (value: unknown) => {
    const scope = normalizeHostKeyScope(value);
    if (scope) collected.push(scope);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) collectOne(item);
  } else if (typeof raw === "string") {
    for (const part of raw.split(/[\n,|]/g)) collectOne(part);
  } else if (raw && typeof raw === "object") {
    for (const value of Object.values(raw as Record<string, unknown>)) collectOne(value);
  }

  const normalized = dedupeScopes(collected);
  return normalized.length > 0 ? normalized : dedupeScopes(fallback);
}

export function parseHostKeyScopes(scopeJson?: string | null): HostKeyScope[] {
  if (!scopeJson || !scopeJson.trim()) return [...HOST_KEY_DEFAULT_SCOPES];
  try {
    const parsed = JSON.parse(scopeJson);
    return normalizeHostKeyScopes(parsed, HOST_KEY_DEFAULT_SCOPES);
  } catch {
    return [...HOST_KEY_DEFAULT_SCOPES];
  }
}

export function serializeHostKeyScopes(scopes: HostKeyScope[]): string {
  const normalized = normalizeHostKeyScopes(scopes, HOST_KEY_DEFAULT_SCOPES);
  return JSON.stringify(normalized);
}

export function hostKeyHasScope(scopes: HostKeyScope[], requiredScope: HostKeyScope): boolean {
  return scopes.includes(requiredScope);
}

export function hostKeyScopeSummary(scopes: HostKeyScope[]): string {
  const normalized = normalizeHostKeyScopes(scopes, HOST_KEY_DEFAULT_SCOPES);
  return normalized.join(", ");
}

export function sha256Token(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function generateHostKeyTokenBundle(versionInput: number): HostKeyTokenBundle {
  const version = toSafeVersion(versionInput);
  const raw = crypto.randomBytes(24).toString("base64url");
  const token = `vs${version}_${raw}`;
  return {
    token,
    tokenHash: sha256Token(token),
    prefix: `${token.slice(0, 14)}...`,
    version,
  };
}

export function nextHostKeyVersion(rows: Array<{ version: number | null | undefined }>): number {
  let maxVersion = 0;
  for (const row of rows) {
    const version = Number(row.version ?? 0);
    if (Number.isFinite(version) && version > maxVersion) {
      maxVersion = version;
    }
  }
  return toSafeVersion(maxVersion + 1);
}
