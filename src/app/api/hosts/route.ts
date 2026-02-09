// /var/www/vps-sentry-web/src/app/api/hosts/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const FALLBACK_BASE =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost";

// ---------- build-worker / weird Request hardening ----------

function isBadUrlString(v: unknown): boolean {
  if (typeof v !== "string") return true;
  const s = v.trim();
  if (!s) return true;
  if (s === "[object Object]") return true;
  return false;
}

function canParseUrlString(v: unknown): boolean {
  if (isBadUrlString(v)) return false;
  const s = String(v).trim();
  try {
    // eslint-disable-next-line no-new
    new URL(s, FALLBACK_BASE);
    return true;
  } catch {
    return false;
  }
}

function canParseNextUrl(nextUrl: unknown): boolean {
  if (!nextUrl || typeof nextUrl !== "object") return false;
  const anyNext = nextUrl as any;

  if (!isBadUrlString(anyNext?.href)) return canParseUrlString(anyNext.href);

  if (!isBadUrlString(anyNext?.pathname)) {
    const pathname = String(anyNext.pathname).trim();
    const search = typeof anyNext.search === "string" ? anyNext.search : "";
    return canParseUrlString(`${pathname}${search}`);
  }

  return false;
}

function shouldStub(req: Request): boolean {
  if (IS_BUILD_TIME) return true;

  const anyReq = req as any;

  const okUrl = canParseUrlString(anyReq?.url);

  const hasNextUrl = anyReq?.nextUrl !== undefined;
  const okNextUrl = !hasNextUrl ? true : canParseNextUrl(anyReq?.nextUrl);

  return !(okUrl && okNextUrl);
}

function safeUrlString(req: Request): string {
  const anyReq = req as any;

  const raw = anyReq?.url;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s && s !== "[object Object]") return s;
  }

  const href = anyReq?.nextUrl?.href;
  if (typeof href === "string") {
    const s = href.trim();
    if (s && s !== "[object Object]") return s;
  }

  return "/";
}

/**
 * Some libs might do new URL(req.url) or similar. Give them a minimal Request-like
 * object with a guaranteed-safe string `url` and no `nextUrl`.
 */
function makeSafeReq(req: Request): Request {
  const url = safeUrlString(req);
  const method = (req as any)?.method ?? "GET";
  return { headers: req.headers, url, method } as any as Request;
}

function stubGet() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    hosts: [],
    usage: { current: 0, hostLimit: 1, plan: null },
  });
}

function stubPost() {
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    host: null,
    onboarding: null,
  });
}

// ---------- parsing helpers ----------

function toName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().slice(0, 80);
  return t.length ? t : null;
}

function toSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase().slice(0, 48);
  if (!t) return null;
  const normalized = t
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

function toStringArray(input: unknown, maxItems = 30): string[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

function toFleetGroup(input: unknown): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "string") return undefined;
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || null;
}

function toBoolMaybe(input: unknown): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (typeof input === "string") {
    const t = input.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(t)) return true;
    if (["0", "false", "no", "off"].includes(t)) return false;
  }
  return undefined;
}

function toIntMaybe(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return Math.trunc(input);
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [
    prismaMod,
    baseUrlMod,
    heartbeatMod,
    onboardingMod,
    hostKeysMod,
    fleetPolicyMod,
    rbacMod,
    auditMod,
  ] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/server-base-url"),
    import("@/lib/host-heartbeat"),
    import("@/lib/host-onboarding"),
    import("@/lib/host-keys"),
    import("@/lib/remediate/fleet-policy"),
    import("@/lib/rbac"),
    import("@/lib/audit-log").catch(() => ({} as any)),
  ]);

  const prisma = (prismaMod as any).prisma as any;

  return {
    prisma,

    getBaseUrlFromHeaders: (baseUrlMod as any).getBaseUrlFromHeaders as () => Promise<string>,

    classifyHeartbeat: (heartbeatMod as any).classifyHeartbeat as any,
    readHeartbeatConfig: (heartbeatMod as any).readHeartbeatConfig as any,

    buildIngestEndpoint: (onboardingMod as any).buildIngestEndpoint as any,
    buildShipHookInstallScript: (onboardingMod as any).buildShipHookInstallScript as any,
    buildTestIngestCommand: (onboardingMod as any).buildTestIngestCommand as any,
    buildUniqueSlug: (onboardingMod as any).buildUniqueSlug as any,
    generateHostTokenBundle: (onboardingMod as any).generateHostTokenBundle as any,
    slugifyHostName: (onboardingMod as any).slugifyHostName as any,

    HOST_KEY_DEFAULT_SCOPES: (hostKeysMod as any).HOST_KEY_DEFAULT_SCOPES as any,
    serializeHostKeyScopes: (hostKeysMod as any).serializeHostKeyScopes as any,

    mergeHostFleetPolicyMeta: (fleetPolicyMod as any).mergeHostFleetPolicyMeta as any,
    readHostFleetPolicyConfig: (fleetPolicyMod as any).readHostFleetPolicyConfig as any,

    requireAdminAccess: (rbacMod as any).requireAdminAccess as () => Promise<any>,
    requireViewerAccess: (rbacMod as any).requireViewerAccess as () => Promise<any>,

    writeAuditLog:
      (auditMod as any).writeAuditLog ??
      (async (_input: any) => {
        /* no-op */
      }),
  };
}

async function findUniqueSlug(
  deps: Awaited<ReturnType<typeof loadDeps>>,
  userId: string,
  preferredBase: string
): Promise<string> {
  const base = deps.slugifyHostName(preferredBase);
  for (let i = 0; i < 50; i++) {
    const candidate = deps.buildUniqueSlug(base, i);
    const exists = await deps.prisma.host.findFirst({
      where: { userId, slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

// ---------- routes ----------

export async function GET(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubGet();

  const deps = await loadDeps();

  const access = await deps.requireViewerAccess();
  if (!access?.ok) {
    return NextResponse.json(
      { ok: false, error: access?.error ?? "Access denied" },
      { status: typeof access?.status === "number" ? access.status : 403 }
    );
  }

  const user = await deps.prisma.user.findUnique({
    where: { id: access.identity.userId },
    select: { id: true, email: true, plan: true, hostLimit: true },
  });
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const heartbeatConfig = deps.readHeartbeatConfig();

  const hosts = await deps.prisma.host.findMany({
    where: { userId: user.id },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      metaJson: true,
      agentVersion: true,
      lastSeenAt: true,
      createdAt: true,
      updatedAt: true,
      snapshots: {
        orderBy: { ts: "desc" },
        take: 1,
        select: {
          id: true,
          ts: true,
          ok: true,
          alertsCount: true,
          publicPortsCount: true,
        },
      },
      apiKeys: {
        where: { revokedAt: null },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          lastUsedAt: true,
          createdAt: true,
          prefix: true,
          version: true,
          scopeJson: true,
        },
      },
      _count: {
        select: { snapshots: true, breaches: true, apiKeys: true },
      },
    },
  });

  const hostIds = hosts.map((h: any) => h.id);
  const openBreaches =
    hostIds.length > 0
      ? await deps.prisma.breach.groupBy({
          by: ["hostId"],
          where: { hostId: { in: hostIds }, state: "open" },
          _count: { _all: true },
        })
      : [];

  const openByHost = new Map<string, number>();
  for (const row of openBreaches) {
    openByHost.set(row.hostId, row._count._all);
  }

  const items = hosts.map((h: any) => {
    const latest = h.snapshots[0] ?? null;
    const latestKey = h.apiKeys[0] ?? null;
    const heartbeat = deps.classifyHeartbeat(h.lastSeenAt, new Date(), heartbeatConfig);

    return {
      id: h.id,
      name: h.name,
      slug: h.slug,
      enabled: h.enabled,
      fleetPolicy: deps.readHostFleetPolicyConfig(h.metaJson),
      agentVersion: h.agentVersion,
      lastSeenAt: h.lastSeenAt,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
      latestSnapshot: latest,
      heartbeat,
      activeKey: latestKey
        ? {
            id: latestKey.id,
            prefix: latestKey.prefix,
            version: latestKey.version,
            scopeJson: latestKey.scopeJson,
            lastUsedAt: latestKey.lastUsedAt,
            createdAt: latestKey.createdAt,
          }
        : null,
      counts: {
        snapshots: h._count.snapshots,
        breachesTotal: h._count.breaches,
        breachesOpen: openByHost.get(h.id) ?? 0,
        apiKeysTotal: h._count.apiKeys,
      },
    };
  });

  return NextResponse.json({
    ok: true,
    hosts: items,
    usage: {
      current: items.length,
      hostLimit: user.hostLimit ?? 1,
      plan: user.plan,
    },
  });
}

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stubPost();

  const deps = await loadDeps();
  const safeReq = makeSafeReq(req);

  const access = await deps.requireAdminAccess();
  if (!access?.ok) {
    await deps.writeAuditLog({
      req: safeReq,
      action: "host.create.denied",
      detail: `status=${access?.status ?? 403} role=${access?.role ?? "unknown"} email=${access?.email ?? "unknown"}`,
      meta: {
        route: "/api/hosts",
        status: access?.status ?? 403,
        requiredRole: "admin",
        email: access?.email ?? null,
        role: access?.role ?? null,
      },
    });
    return NextResponse.json(
      { ok: false, error: access?.error ?? "Access denied" },
      { status: typeof access?.status === "number" ? access.status : 403 }
    );
  }

  const user = await deps.prisma.user.findUnique({
    where: { id: access.identity.userId },
    select: { id: true, email: true, plan: true, hostLimit: true },
  });
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body: any = await req.json().catch(() => ({}));
  const requestedName = toName(body?.name) ?? "New VPS Host";
  const requestedSlug = toSlug(body?.slug);
  const fleetGroup = toFleetGroup(body?.fleetGroup);
  const fleetTags = toStringArray(body?.fleetTags);
  const fleetScopes = toStringArray(body?.fleetScopes);
  const fleetRolloutPaused = toBoolMaybe(body?.fleetRolloutPaused);
  const fleetRolloutPriority = toIntMaybe(body?.fleetRolloutPriority);

  const hasFleetPatch =
    fleetGroup !== undefined ||
    fleetTags !== undefined ||
    fleetScopes !== undefined ||
    fleetRolloutPaused !== undefined ||
    fleetRolloutPriority !== undefined;

  const initialMetaJson = hasFleetPatch
    ? deps.mergeHostFleetPolicyMeta({
        currentMetaJson: null,
        patch: {
          group: fleetGroup,
          tags: fleetTags,
          scopes: fleetScopes,
          rolloutPaused: fleetRolloutPaused,
          rolloutPriority: fleetRolloutPriority,
        },
      })
    : null;

  const existingCount = await deps.prisma.host.count({ where: { userId: user.id } });
  const hostLimit = user.hostLimit ?? 1;
  if (existingCount >= hostLimit) {
    return NextResponse.json(
      {
        ok: false,
        error: `Host limit reached (${hostLimit}). Upgrade your plan to add more hosts.`,
        usage: { current: existingCount, hostLimit },
      },
      { status: 403 }
    );
  }

  const slug = await findUniqueSlug(deps, user.id, requestedSlug ?? requestedName);
  const tokenBundle = deps.generateHostTokenBundle({ version: 1 });

  const created = await deps.prisma.$transaction(async (tx: any) => {
    const host = await tx.host.create({
      data: {
        userId: user.id,
        name: requestedName,
        slug,
        enabled: true,
        metaJson: initialMetaJson ?? undefined,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        enabled: true,
        metaJson: true,
        createdAt: true,
      },
    });

    await tx.hostApiKey.create({
      data: {
        hostId: host.id,
        tokenHash: tokenBundle.tokenHash,
        prefix: tokenBundle.prefix,
        version: tokenBundle.version,
        label: "primary",
        scopeJson: deps.serializeHostKeyScopes(deps.HOST_KEY_DEFAULT_SCOPES),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        hostId: host.id,
        action: "host.create",
        detail: `Created host '${host.name}' (${host.slug ?? host.id})`,
      },
    });

    return host;
  });

  const baseUrl = await deps.getBaseUrlFromHeaders();
  const ingestEndpoint = deps.buildIngestEndpoint(baseUrl, created.id);
  const testIngestCommand = deps.buildTestIngestCommand({
    ingestEndpoint,
    token: tokenBundle.token,
  });
  const installHookScript = deps.buildShipHookInstallScript({
    ingestEndpoint,
    token: tokenBundle.token,
  });

  return NextResponse.json({
    ok: true,
    host: {
      ...created,
      fleetPolicy: deps.readHostFleetPolicyConfig(created.metaJson),
    },
    onboarding: {
      ingestEndpoint,
      token: tokenBundle.token,
      tokenPrefix: tokenBundle.prefix,
      tokenVersion: tokenBundle.version,
      tokenScopes: deps.HOST_KEY_DEFAULT_SCOPES,
      testIngestCommand,
      installHookScript,
      note: "Token is shown once. Save it now.",
    },
  });
}
