import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildUniqueSlug, slugifyHostName } from "@/lib/host-onboarding";

export const dynamic = "force-dynamic";

async function requireUser() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim();
  if (!email) return null;
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
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

async function findUniqueSlug(userId: string, hostId: string, preferredBase: string): Promise<string> {
  const base = slugifyHostName(preferredBase);
  for (let i = 0; i < 50; i++) {
    const candidate = buildUniqueSlug(base, i);
    const exists = await prisma.host.findFirst({
      where: {
        userId,
        id: { not: hostId },
        slug: candidate,
      },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 48);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { hostId } = await ctx.params;
  const host = await prisma.host.findFirst({
    where: {
      id: hostId,
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      agentVersion: true,
      lastSeenAt: true,
      metaJson: true,
      createdAt: true,
      updatedAt: true,
      apiKeys: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          prefix: true,
          createdAt: true,
          lastUsedAt: true,
          revokedAt: true,
        },
      },
      snapshots: {
        orderBy: { ts: "desc" },
        take: 30,
        select: {
          id: true,
          ts: true,
          ok: true,
          alertsCount: true,
          publicPortsCount: true,
          createdAt: true,
        },
      },
      breaches: {
        orderBy: { updatedAt: "desc" },
        take: 30,
        select: {
          id: true,
          title: true,
          detail: true,
          state: true,
          severity: true,
          openedTs: true,
          fixedTs: true,
          updatedAt: true,
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

  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  return NextResponse.json({ ok: true, host });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { hostId } = await ctx.params;
  const existing = await prisma.host.findFirst({
    where: {
      id: hostId,
      userId: user.id,
    },
    select: { id: true, name: true, slug: true, enabled: true },
  });

  if (!existing) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const nextName = toName(body?.name);
  const nextEnabled = typeof body?.enabled === "boolean" ? body.enabled : null;
  const requestedSlug = body?.slug === null ? null : toSlug(body?.slug);

  let resolvedSlug: string | null | undefined = undefined;
  if (requestedSlug === null && body?.slug === null) {
    resolvedSlug = null;
  } else if (requestedSlug) {
    resolvedSlug = await findUniqueSlug(user.id, existing.id, requestedSlug);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const host = await tx.host.update({
      where: { id: existing.id },
      data: {
        name: nextName ?? undefined,
        enabled: nextEnabled === null ? undefined : nextEnabled,
        slug: resolvedSlug,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        enabled: true,
        updatedAt: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        hostId: existing.id,
        action: "host.update",
        detail: `Updated host '${host.name}'`,
      },
    });

    return host;
  });

  return NextResponse.json({ ok: true, host: updated });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { hostId } = await ctx.params;
  const existing = await prisma.host.findFirst({
    where: {
      id: hostId,
      userId: user.id,
    },
    select: { id: true, name: true },
  });

  if (!existing) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        userId: user.id,
        hostId: existing.id,
        action: "host.delete",
        detail: `Deleted host '${existing.name}'`,
      },
    });
    await tx.host.delete({ where: { id: existing.id } });
  });

  return NextResponse.json({ ok: true, deletedHostId: existing.id });
}
