// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/timeline/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function parseIntSafe(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseDateSafe(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function loadDeps() {
  const [prismaMod, rbacMod, reqUrlMod] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/rbac"),
    import("@/lib/request-url"),
  ]);

  return {
    prisma: prismaMod.prisma,
    requireAdminAccess: (rbacMod as any).requireAdminAccess,
    safeRequestUrl: reqUrlMod.safeRequestUrl,
  };
}

async function requireManagedHost(
  deps: Awaited<ReturnType<typeof loadDeps>>,
  hostId: string
): Promise<
  | { ok: true; userId: string; host: { id: string; name: string; slug: string | null } }
  | { ok: false; status: number; error: string }
> {
  const access: any = await deps.requireAdminAccess?.();
  if (!access || access.ok !== true) {
    return {
      ok: false,
      status: typeof access?.status === "number" ? access.status : 403,
      error: typeof access?.error === "string" ? access.error : "Access denied",
    };
  }

  const userId: string | undefined = access?.identity?.userId;
  if (!userId) return { ok: false, status: 403, error: "Access identity missing userId" };

  const host = await deps.prisma.host.findFirst({
    where: { id: hostId, userId },
    select: { id: true, name: true, slug: true },
  });

  if (!host) return { ok: false, status: 404, error: "Host not found" };
  return { ok: true, userId, host };
}

// Use ONE stable select shape so Prisma inference stays sane (no conditional unions)
const SNAPSHOT_SELECT = {
  id: true,
  hostId: true,
  ts: true,
  ok: true,
  alertsCount: true,
  publicPortsCount: true,
  createdAt: true,
  // payload fields (we can strip them when includePayload=0)
  statusJson: true,
  lastJson: true,
  diffJson: true,
} as const;

export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      host: null,
      points: [],
      nextCursor: null,
    });
  }

  const deps = await loadDeps();
  const { hostId } = await ctx.params;

  const managed = await requireManagedHost(deps, hostId);
  if (!managed.ok) {
    return NextResponse.json({ ok: false, error: managed.error }, { status: managed.status });
  }

  const url = deps.safeRequestUrl(req);

  const limit = Math.min(500, Math.max(1, parseIntSafe(url.searchParams.get("limit"), 200)));
  const includePayload = url.searchParams.get("includePayload") === "1";

  const since = parseDateSafe(url.searchParams.get("since"));
  const until =
    parseDateSafe(url.searchParams.get("until")) ??
    parseDateSafe(url.searchParams.get("before"));

  const cursorTs = parseDateSafe(url.searchParams.get("cursor"));

  const where: any = { hostId };
  const tsFilter: any = {};
  if (since) tsFilter.gte = since;
  if (until) tsFilter.lte = until;
  if (cursorTs) tsFilter.lt = cursorTs; // desc pagination
  if (Object.keys(tsFilter).length) where.ts = tsFilter;

  const rows = await deps.prisma.hostSnapshot.findMany({
    where,
    orderBy: [{ ts: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: SNAPSHOT_SELECT,
  });

  const last = rows.length ? rows[rows.length - 1] : null;
  const nextCursor = last?.ts ? last.ts.toISOString() : null;

  const points = includePayload
    ? rows
    : rows.map(({ statusJson, lastJson, diffJson, ...rest }) => rest);

  return NextResponse.json({
    ok: true,
    host: managed.host,
    points,
    nextCursor,
  });
}
