// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/keys/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

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

function parseExpiresAt(
  raw: unknown
): { ok: true; value: Date | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: null };
  if (raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "expiresAt must be an ISO date string" };
  const ts = new Date(raw);
  if (!Number.isFinite(ts.getTime())) return { ok: false, error: "Invalid expiresAt timestamp" };
  return { ok: true, value: ts };
}

async function loadDeps() {
  const [prismaMod, rbacMod, auditMod, reqUrlMod, hostKeysMod, hostKeyAuthMod] =
    await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/rbac"),
      import("@/lib/audit-log"),
      import("@/lib/request-url"),
      import("@/lib/host-keys"),
      import("@/lib/host-key-auth"),
    ]);

  return {
    prisma: prismaMod.prisma,
    requireAdminAccess: rbacMod.requireAdminAccess,
    writeAuditLog: auditMod.writeAuditLog,
    safeRequestUrl: reqUrlMod.safeRequestUrl,
    hostKeys: hostKeysMod,
    hostKeyAuth: hostKeyAuthMod,
  };
}

type ManagedOk = {
  ok: true;
  host: { id: string; name: string; slug: string | null };
  identity: { userId: string; email?: string | null; role?: string | null };
};

type ManagedFail = {
  ok: false;
  status: number;
  error: string;
  identity?: { userId?: string; email?: string | null; role?: string | null };
};

async function requireManagedHost(
  deps: Awaited<ReturnType<typeof loadDeps>>,
  req: Request,
  hostId: string
): Promise<ManagedOk | ManagedFail> {
  const access: any = await deps.requireAdminAccess();

  // Normalize shape defensively so we don't fight Next-auth/RBAC unions here.
  if (!access || access.ok !== true) {
    const status = typeof access?.status === "number" ? access.status : 403;
    const error = typeof access?.error === "string" ? access.error : "Access denied";
    const email = typeof access?.email === "string" ? access.email : null;
    const role = typeof access?.role === "string" || access?.role === null ? access.role : null;

    await deps.writeAuditLog({
      req,
      action: "host.key.manage.denied",
      detail: `status=${status} role=${role ?? "unknown"} email=${email ?? "unknown"}`,
      meta: {
        route: "/api/hosts/[hostId]/keys",
        requiredRole: "admin",
        status,
        email,
        role,
        hostId,
      },
    });

    return { ok: false, status, error, identity: { email, role } };
  }

  const userId: string | undefined = access?.identity?.userId;
  const email = typeof access?.identity?.email === "string" ? access.identity.email : null;
  const role =
    typeof access?.identity?.role === "string" || access?.identity?.role === null
      ? access.identity.role
      : null;

  if (!userId) {
    return { ok: false, status: 403, error: "Access identity missing userId" };
  }

  const host = await deps.prisma.host.findFirst({
    where: { id: hostId, userId },
    select: { id: true, name: true, slug: true },
  });

  if (!host) {
    return { ok: false, status: 404, error: "Host not found" };
  }

  return { ok: true, host, identity: { userId, email, role } };
}

async function listHostKeys(
  deps: Awaited<ReturnType<typeof loadDeps>>,
  hostId: string,
  includeRevoked: boolean
) {
  const rows = await deps.prisma.hostApiKey.findMany({
    where: {
      hostId,
      ...(includeRevoked ? {} : { revokedAt: null }),
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select: HOST_KEY_SELECT,
  });

  return rows.map((row: any) => deps.hostKeyAuth.summarizeHostKey(row));
}

// IMPORTANT: Next 16 app-route type checker wants ctx.params as a Promise (matches your verify route)
export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      host: null,
      keyScopes: [],
      defaults: { createScopes: [], includeRevokedDefault: true },
      latestActiveKeyId: null,
      keys: [],
    });
  }

  const deps = await loadDeps();
  const { hostId } = await ctx.params;

  const managed = await requireManagedHost(deps, req, hostId);
  if (!managed.ok) {
    return NextResponse.json({ ok: false, error: managed.error }, { status: managed.status });
  }

  const includeRevoked = parseBool(deps.safeRequestUrl(req).searchParams.get("includeRevoked"), true);
  const keys = await listHostKeys(deps, hostId, includeRevoked);
  const active = keys.find((k: any) => k.state === "active") ?? null;

  return NextResponse.json({
    ok: true,
    host: managed.host,
    keyScopes: deps.hostKeys.HOST_KEY_SCOPE_ORDER,
    defaults: {
      createScopes: deps.hostKeys.HOST_KEY_DEFAULT_SCOPES,
      includeRevokedDefault: true,
    },
    latestActiveKeyId: active?.id ?? null,
    keys,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, buildPhase: true, action: "noop" });
  }

  const deps = await loadDeps();
  const { hostId } = await ctx.params;

  const managed = await requireManagedHost(deps, req, hostId);
  if (!managed.ok) {
    return NextResponse.json({ ok: false, error: managed.error }, { status: managed.status });
  }

  const body: any = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  const toScopes = (raw: unknown) =>
    deps.hostKeys.normalizeHostKeyScopes(raw, deps.hostKeys.HOST_KEY_DEFAULT_SCOPES);

  // -------------------- create --------------------
  if (action === "create") {
    const scopes = toScopes(body?.scopes);
    const expires = parseExpiresAt(body?.expiresAt);
    if (!expires.ok) return NextResponse.json({ ok: false, error: expires.error }, { status: 400 });

    const label = trimLabel(body?.label) ?? "scoped key";

    const versionRows = await deps.prisma.hostApiKey.findMany({
      where: { hostId },
      select: { version: true },
    });

    const nextVersion = deps.hostKeys.nextHostKeyVersion(versionRows);
    const tokenBundle = deps.hostKeys.generateHostKeyTokenBundle(nextVersion);

    const created = await deps.prisma.hostApiKey.create({
      data: {
        hostId,
        tokenHash: tokenBundle.tokenHash,
        prefix: tokenBundle.prefix,
        version: tokenBundle.version,
        label,
        scopeJson: deps.hostKeys.serializeHostKeyScopes(scopes),
        expiresAt: expires.value,
      },
      select: HOST_KEY_SELECT,
    });

    await deps.writeAuditLog({
      req,
      userId: managed.identity.userId,
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
        key: deps.hostKeyAuth.summarizeHostKey(created),
        secret: { token: tokenBundle.token, note: "Token shown once. Save it now." },
      },
      { status: 201 }
    );
  }

  // -------------------- rotate --------------------
  if (action === "rotate") {
    const sourceKeyId =
      typeof body?.sourceKeyId === "string" && body.sourceKeyId.trim()
        ? body.sourceKeyId.trim()
        : null;

    const explicitScopes = body?.scopes !== undefined;

    const expires = parseExpiresAt(body?.expiresAt);
    if (!expires.ok) return NextResponse.json({ ok: false, error: expires.error }, { status: 400 });

    const source = sourceKeyId
      ? await deps.prisma.hostApiKey.findFirst({
          where: { id: sourceKeyId, hostId },
          select: HOST_KEY_SELECT,
        })
      : await deps.prisma.hostApiKey.findFirst({
          where: {
            hostId,
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
          orderBy: [{ version: "desc" }, { createdAt: "desc" }],
          select: HOST_KEY_SELECT,
        });

    if (!source) {
      return NextResponse.json(
        { ok: false, error: "No source key available for rotation" },
        { status: 409 }
      );
    }

    const versionRows = await deps.prisma.hostApiKey.findMany({
      where: { hostId },
      select: { version: true },
    });

    const computedVersion = deps.hostKeys.nextHostKeyVersion(versionRows);
    const nextVersion = Math.max(source.version + 1, computedVersion);

    const tokenBundle = deps.hostKeys.generateHostKeyTokenBundle(nextVersion);

    const sourceScopes = deps.hostKeys.parseHostKeyScopes(source.scopeJson);
    const scopes = explicitScopes ? toScopes(body?.scopes) : sourceScopes;

    const nextLabel = trimLabel(body?.label) ?? `rotation of ${source.prefix}`;
    const rotateReason =
      trimLabel(body?.reason) ?? `rotated_by:${managed.identity.email ?? "unknown"}`;
    const expiresAt = expires.value ?? source.expiresAt;

    const result = await deps.prisma.$transaction(async (tx: any) => {
      const created = await tx.hostApiKey.create({
        data: {
          hostId,
          tokenHash: tokenBundle.tokenHash,
          prefix: tokenBundle.prefix,
          version: tokenBundle.version,
          label: nextLabel,
          scopeJson: deps.hostKeys.serializeHostKeyScopes(scopes),
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

    await deps.writeAuditLog({
      req,
      userId: managed.identity.userId,
      hostId,
      action: "host.key.rotate",
      detail: `Rotated ${result.revoked.prefix} -> ${result.created.prefix}`,
      meta: {
        hostId,
        sourceKeyId: result.revoked.id,
        newKeyId: result.created.id,
        newVersion: result.created.version,
        scopes,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
    });

    return NextResponse.json({
      ok: true,
      action,
      rotated: {
        from: deps.hostKeyAuth.summarizeHostKey(result.revoked),
        to: deps.hostKeyAuth.summarizeHostKey(result.created),
      },
      secret: { token: tokenBundle.token, note: "Token shown once. Save it now." },
    });
  }

  // -------------------- revoke --------------------
  if (action === "revoke") {
    const keyId = typeof body?.keyId === "string" ? body.keyId.trim() : "";
    if (!keyId) return NextResponse.json({ ok: false, error: "keyId is required" }, { status: 400 });

    const existing = await deps.prisma.hostApiKey.findFirst({
      where: { id: keyId, hostId },
      select: HOST_KEY_SELECT,
    });
    if (!existing) return NextResponse.json({ ok: false, error: "Key not found" }, { status: 404 });

    const reason = trimLabel(body?.reason) ?? `revoked_by:${managed.identity.email ?? "unknown"}`;

    const revoked = existing.revokedAt
      ? existing
      : await deps.prisma.hostApiKey.update({
          where: { id: existing.id },
          data: { revokedAt: new Date(), revokedReason: reason },
          select: HOST_KEY_SELECT,
        });

    await deps.writeAuditLog({
      req,
      userId: managed.identity.userId,
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
      key: deps.hostKeyAuth.summarizeHostKey(revoked),
      alreadyRevoked: Boolean(existing.revokedAt),
    });
  }

  // -------------------- verify --------------------
  if (action === "verify") {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "token is required" }, { status: 400 });

    const rawScope = body?.requiredScope ?? body?.scope;
    const requiredScopeRaw = typeof rawScope === "string" ? rawScope.trim() : "";
    const requiredScope = requiredScopeRaw
      ? deps.hostKeys.normalizeHostKeyScope(requiredScopeRaw)
      : null;

    if (requiredScopeRaw && !requiredScope) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported scope. Allowed: ${deps.hostKeys.HOST_KEY_SCOPE_ORDER.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const verified = await deps.hostKeyAuth.verifyHostTokenForScope({
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
          host: null,
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
