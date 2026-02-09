import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { safeRequestUrl } from "@/lib/request-url";
import {
  generateHostKeyTokenBundle,
  HOST_KEY_DEFAULT_SCOPES,
  HOST_KEY_SCOPE_ORDER,
  nextHostKeyVersion,
  normalizeHostKeyScope,
  normalizeHostKeyScopes,
  parseHostKeyScopes,
  serializeHostKeyScopes,
  type HostKeyScope,
} from "@/lib/host-keys";
import { summarizeHostKey, verifyHostTokenForScope } from "@/lib/host-key-auth";

export const dynamic = "force-dynamic";

const HOST_KEY_SELECT = {
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
} as const;

function parseBool(v: string | null, fallback = false): boolean {
  if (!v) return fallback;
  const t = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

function trimLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().slice(0, 80);
  return t.length ? t : null;
}

function parseExpiresAt(raw: unknown): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: null };
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "expiresAt must be an ISO date string" };
  const ts = new Date(raw);
  if (!Number.isFinite(ts.getTime())) return { ok: false, error: "Invalid expiresAt timestamp" };
  return { ok: true, value: ts };
}

function toScopes(raw: unknown): HostKeyScope[] {
  return normalizeHostKeyScopes(raw, HOST_KEY_DEFAULT_SCOPES);
}

async function requireManagedHost(req: Request, hostId: string) {
  const access = await requireAdminAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "host.key.manage.denied",
      detail: `status=${access.status} role=${access.role ?? "unknown"} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/hosts/[hostId]/keys",
        requiredRole: "admin",
        status: access.status,
        email: access.email ?? null,
        role: access.role ?? null,
      },
    });
    return { ok: false as const, access };
  }

  const host = await prisma.host.findFirst({
    where: { id: hostId, userId: access.identity.userId },
    select: { id: true, name: true, slug: true },
  });
  if (!host) {
    return { ok: false as const, access, host: null };
  }

  return { ok: true as const, access, host };
}

async function listHostKeys(hostId: string, includeRevoked: boolean) {
  const rows = await prisma.hostApiKey.findMany({
    where: {
      hostId,
      ...(includeRevoked ? {} : { revokedAt: null }),
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: HOST_KEY_SELECT,
  });
  return rows.map((row) => summarizeHostKey(row));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;
  const managed = await requireManagedHost(req, hostId);
  if (!managed.ok) {
    if (managed.host === null) {
      return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: managed.access.error }, { status: managed.access.status });
  }

  const includeRevoked = parseBool(safeRequestUrl(req).searchParams.get("includeRevoked"), true);
  const keys = await listHostKeys(hostId, includeRevoked);
  const active = keys.find((k) => k.state === "active") ?? null;

  return NextResponse.json({
    ok: true,
    host: managed.host,
    keyScopes: HOST_KEY_SCOPE_ORDER,
    defaults: {
      createScopes: HOST_KEY_DEFAULT_SCOPES,
      includeRevokedDefault: true,
    },
    latestActiveKeyId: active?.id ?? null,
    keys,
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await ctx.params;
  const managed = await requireManagedHost(req, hostId);
  if (!managed.ok) {
    if (managed.host === null) {
      return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: managed.access.error }, { status: managed.access.status });
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  if (action === "create") {
    const scopes = toScopes(body?.scopes);
    const expires = parseExpiresAt(body?.expiresAt);
    if (!expires.ok) return NextResponse.json({ ok: false, error: expires.error }, { status: 400 });
    const label = trimLabel(body?.label) ?? "scoped key";

    const versionRows = await prisma.hostApiKey.findMany({
      where: { hostId },
      select: { version: true },
    });
    const nextVersion = nextHostKeyVersion(versionRows);
    const tokenBundle = generateHostKeyTokenBundle(nextVersion);

    const created = await prisma.hostApiKey.create({
      data: {
        hostId,
        tokenHash: tokenBundle.tokenHash,
        prefix: tokenBundle.prefix,
        version: tokenBundle.version,
        label,
        scopeJson: serializeHostKeyScopes(scopes),
        expiresAt: expires.value,
      },
      select: HOST_KEY_SELECT,
    });

    await writeAuditLog({
      req,
      userId: managed.access.identity.userId,
      hostId,
      action: "host.key.create",
      detail: `Created host key ${created.prefix} v${created.version}`,
      meta: {
        hostId,
        keyId: created.id,
        version: created.version,
        scopes,
        expiresAt: expires.value ? expires.value.toISOString() : null,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        action,
        key: summarizeHostKey(created),
        secret: {
          token: tokenBundle.token,
          note: "Token shown once. Save it now.",
        },
      },
      { status: 201 }
    );
  }

  if (action === "rotate") {
    const sourceKeyId =
      typeof body?.sourceKeyId === "string" && body.sourceKeyId.trim()
        ? body.sourceKeyId.trim()
        : null;
    const explicitScopes = body?.scopes !== undefined;
    const expires = parseExpiresAt(body?.expiresAt);
    if (!expires.ok) return NextResponse.json({ ok: false, error: expires.error }, { status: 400 });

    const source = sourceKeyId
      ? await prisma.hostApiKey.findFirst({
          where: { id: sourceKeyId, hostId },
          select: HOST_KEY_SELECT,
        })
      : await prisma.hostApiKey.findFirst({
          where: {
            hostId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: [{ version: "desc" }, { createdAt: "desc" }],
          select: HOST_KEY_SELECT,
        });

    if (!source) {
      return NextResponse.json({ ok: false, error: "No source key available for rotation" }, { status: 409 });
    }

    const versionRows = await prisma.hostApiKey.findMany({
      where: { hostId },
      select: { version: true },
    });
    const computedVersion = nextHostKeyVersion(versionRows);
    const nextVersion = Math.max(source.version + 1, computedVersion);
    const tokenBundle = generateHostKeyTokenBundle(nextVersion);

    const sourceScopes = parseHostKeyScopes(source.scopeJson);
    const scopes = explicitScopes ? toScopes(body?.scopes) : sourceScopes;
    const nextLabel = trimLabel(body?.label) ?? `rotation of ${source.prefix}`;
    const rotateReason = trimLabel(body?.reason) ?? `rotated_by:${managed.access.identity.email}`;
    const expiresAt = expires.value ?? source.expiresAt;

    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.hostApiKey.create({
        data: {
          hostId,
          tokenHash: tokenBundle.tokenHash,
          prefix: tokenBundle.prefix,
          version: tokenBundle.version,
          label: nextLabel,
          scopeJson: serializeHostKeyScopes(scopes),
          expiresAt,
          rotatedFromKeyId: source.id,
        },
        select: HOST_KEY_SELECT,
      });

      const revoked = await tx.hostApiKey.update({
        where: { id: source.id },
        data: {
          revokedAt: new Date(),
          revokedReason: `rotated_to:${created.prefix};${rotateReason}`,
        },
        select: HOST_KEY_SELECT,
      });

      return { created, revoked };
    });

    await writeAuditLog({
      req,
      userId: managed.access.identity.userId,
      hostId,
      action: "host.key.rotate",
      detail: `Rotated ${result.revoked.prefix} -> ${result.created.prefix}`,
      meta: {
        hostId,
        sourceKeyId: result.revoked.id,
        newKeyId: result.created.id,
        newVersion: result.created.version,
        scopes,
      },
    });

    return NextResponse.json({
      ok: true,
      action,
      rotated: {
        from: summarizeHostKey(result.revoked),
        to: summarizeHostKey(result.created),
      },
      secret: {
        token: tokenBundle.token,
        note: "Token shown once. Save it now.",
      },
    });
  }

  if (action === "revoke") {
    const keyId = typeof body?.keyId === "string" ? body.keyId.trim() : "";
    if (!keyId) return NextResponse.json({ ok: false, error: "keyId is required" }, { status: 400 });

    const existing = await prisma.hostApiKey.findFirst({
      where: { id: keyId, hostId },
      select: HOST_KEY_SELECT,
    });
    if (!existing) return NextResponse.json({ ok: false, error: "Key not found" }, { status: 404 });

    const reason = trimLabel(body?.reason) ?? `revoked_by:${managed.access.identity.email}`;
    const revoked = existing.revokedAt
      ? existing
      : await prisma.hostApiKey.update({
          where: { id: existing.id },
          data: {
            revokedAt: new Date(),
            revokedReason: reason,
          },
          select: HOST_KEY_SELECT,
        });

    await writeAuditLog({
      req,
      userId: managed.access.identity.userId,
      hostId,
      action: "host.key.revoke",
      detail: `Revoked host key ${revoked.prefix}`,
      meta: {
        hostId,
        keyId: revoked.id,
        alreadyRevoked: Boolean(existing.revokedAt),
        reason,
      },
    });

    return NextResponse.json({
      ok: true,
      action,
      key: summarizeHostKey(revoked),
      alreadyRevoked: Boolean(existing.revokedAt),
    });
  }

  if (action === "verify") {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "token is required" }, { status: 400 });

    const rawScope = body?.requiredScope ?? body?.scope;
    const requiredScopeRaw = typeof rawScope === "string" ? rawScope.trim() : "";
    const requiredScope = requiredScopeRaw ? normalizeHostKeyScope(requiredScopeRaw) : null;
    if (requiredScopeRaw && !requiredScope) {
      return NextResponse.json({ ok: false, error: "Unsupported scope" }, { status: 400 });
    }

    const verified = await verifyHostTokenForScope({
      hostId,
      token,
      requiredScope: requiredScope ?? undefined,
    });
    if (!verified.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: verified.error,
          code: verified.code,
          requiredScope: verified.requiredScope ?? null,
          key: verified.keySummary ?? null,
        },
        { status: verified.status }
      );
    }

    return NextResponse.json({
      ok: true,
      action,
      requiredScope: requiredScope ?? null,
      key: verified.keySummary,
      host: verified.host,
    });
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported action. Use create | rotate | revoke | verify." },
    { status: 400 }
  );
}
