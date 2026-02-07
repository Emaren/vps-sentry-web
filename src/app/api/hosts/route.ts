import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBaseUrlFromHeaders } from "@/lib/server-base-url";
import { classifyHeartbeat, readHeartbeatConfig } from "@/lib/host-heartbeat";
import {
  buildIngestEndpoint,
  buildShipHookInstallScript,
  buildTestIngestCommand,
  buildUniqueSlug,
  generateHostTokenBundle,
  slugifyHostName,
} from "@/lib/host-onboarding";

export const dynamic = "force-dynamic";

async function requireUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return null;
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      plan: true,
      hostLimit: true,
    },
  });
  return user;
}

function toName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().slice(0, 80);
  return t.length ? t : null;
}

function toSlug(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toLowerCase().slice(0, 48);
  if (!t) return null;
  const normalized = t.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || null;
}

async function findUniqueSlug(userId: string, preferredBase: string): Promise<string> {
  const base = slugifyHostName(preferredBase);
  for (let i = 0; i < 50; i++) {
    const candidate = buildUniqueSlug(base, i);
    const exists = await prisma.host.findFirst({
      where: { userId, slug: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  // extremely unlikely fallback
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const heartbeatConfig = readHeartbeatConfig();

  const hosts = await prisma.host.findMany({
    where: { userId: user.id },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
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
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          lastUsedAt: true,
          createdAt: true,
          prefix: true,
        },
      },
      _count: {
        select: {
          snapshots: true,
          breaches: true,
          apiKeys: true,
        },
      },
    },
  });

  const hostIds = hosts.map((h) => h.id);
  const openBreaches = hostIds.length
    ? await prisma.breach.groupBy({
        by: ["hostId"],
        where: {
          hostId: { in: hostIds },
          state: "open",
        },
        _count: { _all: true },
      })
    : [];

  const openByHost = new Map<string, number>();
  for (const row of openBreaches) {
    openByHost.set(row.hostId, row._count._all);
  }

  const items = hosts.map((h) => {
    const latest = h.snapshots[0] ?? null;
    const latestKey = h.apiKeys[0] ?? null;
    const heartbeat = classifyHeartbeat(h.lastSeenAt, new Date(), heartbeatConfig);

    return {
      id: h.id,
      name: h.name,
      slug: h.slug,
      enabled: h.enabled,
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
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const requestedName = toName(body?.name) ?? "New VPS Host";
  const requestedSlug = toSlug(body?.slug);

  const existingCount = await prisma.host.count({ where: { userId: user.id } });
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

  const slug = await findUniqueSlug(user.id, requestedSlug ?? requestedName);
  const tokenBundle = generateHostTokenBundle();

  const created = await prisma.$transaction(async (tx) => {
    const host = await tx.host.create({
      data: {
        userId: user.id,
        name: requestedName,
        slug,
        enabled: true,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        enabled: true,
        createdAt: true,
      },
    });

    await tx.hostApiKey.create({
      data: {
        hostId: host.id,
        tokenHash: tokenBundle.tokenHash,
        prefix: tokenBundle.prefix,
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

  const baseUrl = await getBaseUrlFromHeaders();
  const ingestEndpoint = buildIngestEndpoint(baseUrl, created.id);
  const testIngestCommand = buildTestIngestCommand({
    ingestEndpoint,
    token: tokenBundle.token,
  });
  const installHookScript = buildShipHookInstallScript({
    ingestEndpoint,
    token: tokenBundle.token,
  });

  return NextResponse.json({
    ok: true,
    host: created,
    onboarding: {
      ingestEndpoint,
      token: tokenBundle.token,
      tokenPrefix: tokenBundle.prefix,
      testIngestCommand,
      installHookScript,
      note: "Token is shown once. Save it now.",
    },
  });
}
