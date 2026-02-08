import { prisma } from "@/lib/prisma";
import {
  hostKeyHasScope,
  parseHostKeyScopes,
  type HostKeyScope,
  sha256Token,
} from "@/lib/host-keys";

export type HostKeyState = "active" | "revoked" | "expired";

type HostKeyRow = {
  id: string;
  hostId: string;
  prefix: string;
  version: number;
  label: string | null;
  scopeJson: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date | null;
  rotatedFromKeyId: string | null;
};

export type HostKeySummary = {
  id: string;
  prefix: string;
  version: number;
  label: string | null;
  scopes: HostKeyScope[];
  state: HostKeyState;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  expiresAt: Date | null;
  rotatedFromKeyId: string | null;
};

export type HostKeyAuthSuccess = {
  ok: true;
  host: {
    id: string;
    name: string;
    slug: string | null;
    enabled: boolean;
    lastSeenAt: Date | null;
    agentVersion: string | null;
  };
  key: HostKeyRow;
  keySummary: HostKeySummary;
  scopes: HostKeyScope[];
};

export type HostKeyAuthFailure = {
  ok: false;
  status: 401 | 403 | 404;
  error: string;
  code:
    | "host_not_found"
    | "invalid_token"
    | "key_revoked"
    | "key_expired"
    | "insufficient_scope";
  requiredScope?: HostKeyScope;
  keySummary?: HostKeySummary;
};

function classifyHostKeyState(
  key: Pick<HostKeyRow, "revokedAt" | "expiresAt">,
  now: Date
): HostKeyState {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

export function summarizeHostKey(
  key: Pick<
    HostKeyRow,
    | "id"
    | "prefix"
    | "version"
    | "label"
    | "scopeJson"
    | "createdAt"
    | "lastUsedAt"
    | "revokedAt"
    | "revokedReason"
    | "expiresAt"
    | "rotatedFromKeyId"
  >,
  now = new Date()
): HostKeySummary {
  const scopes = parseHostKeyScopes(key.scopeJson);
  return {
    id: key.id,
    prefix: key.prefix,
    version: key.version,
    label: key.label,
    scopes,
    state: classifyHostKeyState(
      {
        revokedAt: key.revokedAt,
        expiresAt: key.expiresAt,
      },
      now
    ),
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    revokedReason: key.revokedReason,
    expiresAt: key.expiresAt,
    rotatedFromKeyId: key.rotatedFromKeyId,
  };
}

export function readBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function touchHostKeyLastUsed(keyId: string): Promise<void> {
  if (!keyId) return;
  try {
    await prisma.hostApiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date() },
    });
  } catch (err) {
    console.error("[host-key] touch lastUsed failed:", err);
  }
}

export async function verifyHostTokenForScope(input: {
  hostId: string;
  token: string;
  requiredScope?: HostKeyScope;
}): Promise<HostKeyAuthSuccess | HostKeyAuthFailure> {
  const hostId = input.hostId.trim();
  if (!hostId) {
    return {
      ok: false,
      status: 404,
      error: "Host not found",
      code: "host_not_found",
      requiredScope: input.requiredScope,
    };
  }

  const now = new Date();
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      lastSeenAt: true,
      agentVersion: true,
    },
  });
  if (!host) {
    return {
      ok: false,
      status: 404,
      error: "Host not found",
      code: "host_not_found",
      requiredScope: input.requiredScope,
    };
  }

  const tokenHash = sha256Token(input.token);
  const key = await prisma.hostApiKey.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      hostId: true,
      prefix: true,
      version: true,
      label: true,
      scopeJson: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
      revokedReason: true,
      expiresAt: true,
      rotatedFromKeyId: true,
    },
  });

  if (!key || key.hostId !== host.id) {
    return {
      ok: false,
      status: 401,
      error: "Invalid token",
      code: "invalid_token",
      requiredScope: input.requiredScope,
    };
  }

  const keySummary = summarizeHostKey(key, now);
  if (keySummary.state === "revoked") {
    return {
      ok: false,
      status: 401,
      error: "Key revoked",
      code: "key_revoked",
      requiredScope: input.requiredScope,
      keySummary,
    };
  }
  if (keySummary.state === "expired") {
    return {
      ok: false,
      status: 401,
      error: "Key expired",
      code: "key_expired",
      requiredScope: input.requiredScope,
      keySummary,
    };
  }

  if (input.requiredScope && !hostKeyHasScope(keySummary.scopes, input.requiredScope)) {
    return {
      ok: false,
      status: 403,
      error: "Key scope does not allow this action",
      code: "insufficient_scope",
      requiredScope: input.requiredScope,
      keySummary,
    };
  }

  return {
    ok: true,
    host,
    key: {
      id: key.id,
      hostId: key.hostId,
      prefix: key.prefix,
      version: key.version,
      label: key.label,
      scopeJson: key.scopeJson,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt,
      revokedReason: key.revokedReason,
      expiresAt: key.expiresAt,
      rotatedFromKeyId: key.rotatedFromKeyId,
    },
    keySummary,
    scopes: keySummary.scopes,
  };
}
