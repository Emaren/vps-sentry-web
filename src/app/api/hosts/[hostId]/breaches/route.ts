import { NextResponse } from "next/server";
import type { BreachSeverity, BreachState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit-log";
import { requireOpsAccess, requireViewerAccess } from "@/lib/rbac";
import { safeRequestUrl } from "@/lib/request-url";

export const dynamic = "force-dynamic";
const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function parseLimit(raw: string | null): number {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n)) return 50;
  return Math.max(10, Math.min(200, Math.trunc(n)));
}

function parseState(raw: string | null): BreachState | "all" {
  const v = (raw ?? "all").trim().toLowerCase();
  if (v === "open" || v === "fixed" || v === "ignored") return v;
  return "all";
}

function parseSeverity(raw: string | null): BreachSeverity | "all" {
  const v = (raw ?? "all").trim().toLowerCase();
  if (v === "info" || v === "warn" || v === "critical") return v;
  return "all";
}

function trimString(v: unknown, max = 1400): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max)}...[truncated]`;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function resolveHost(hostId: string, userId: string) {
  return prisma.host.findFirst({
    where: {
      id: hostId,
      userId,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      enabled: true,
      lastSeenAt: true,
    },
  });
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      host: null,
      filters: {
        state: "all",
        severity: "all",
        q: null,
        includeEvidence: false,
        limit: 0,
      },
      pagination: {
        nextCursor: null,
        hasMore: false,
        limit: 0,
      },
      summary: {
        total: 0,
        byState: { open: 0, fixed: 0, ignored: 0 },
        bySeverity: { info: 0, warn: 0, critical: 0 },
      },
      breaches: [],
    });
  }

  const access = await requireViewerAccess();
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { hostId } = await ctx.params;
  const host = await resolveHost(hostId, access.identity.userId);
  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const url = safeRequestUrl(req);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = trimString(url.searchParams.get("cursor"), 64);
  const q = trimString(url.searchParams.get("q"), 180);
  const state = parseState(url.searchParams.get("state"));
  const severity = parseSeverity(url.searchParams.get("severity"));
  const includeEvidence = ["1", "true", "yes"].includes(
    (url.searchParams.get("includeEvidence") ?? "").trim().toLowerCase()
  );

  const where: Prisma.BreachWhereInput = {
    hostId,
    ...(state !== "all" ? { state } : {}),
    ...(severity !== "all" ? { severity } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q } },
            { detail: { contains: q } },
            { code: { contains: q } },
          ],
        }
      : {}),
  };

  const rows = await prisma.breach.findMany({
    where,
    orderBy: [{ openedTs: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      code: true,
      title: true,
      detail: true,
      severity: true,
      state: true,
      openedTs: true,
      fixedTs: true,
      createdAt: true,
      updatedAt: true,
      evidenceJson: true,
    },
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

  const summaryRows = await prisma.breach.groupBy({
    by: ["state", "severity"],
    where: { hostId },
    _count: { _all: true },
  });

  const summaryByState: Record<string, number> = { open: 0, fixed: 0, ignored: 0 };
  const summaryBySeverity: Record<string, number> = { info: 0, warn: 0, critical: 0 };
  for (const row of summaryRows) {
    summaryByState[row.state] = (summaryByState[row.state] ?? 0) + row._count._all;
    summaryBySeverity[row.severity] = (summaryBySeverity[row.severity] ?? 0) + row._count._all;
  }

  return NextResponse.json({
    ok: true,
    host,
    filters: {
      state,
      severity,
      q: q ?? null,
      includeEvidence,
      limit,
    },
    pagination: {
      nextCursor,
      hasMore,
      limit,
    },
    summary: {
      total: summaryRows.reduce((sum, r) => sum + r._count._all, 0),
      byState: summaryByState,
      bySeverity: summaryBySeverity,
    },
    breaches: items.map((b) => ({
      id: b.id,
      code: b.code,
      title: b.title,
      detail: b.detail,
      severity: b.severity,
      state: b.state,
      openedTs: b.openedTs,
      fixedTs: b.fixedTs,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      evidence: includeEvidence ? parseJson(b.evidenceJson) : undefined,
    })),
  });
}

function parseMutationState(raw: unknown): BreachState | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t === "open" || t === "fixed" || t === "ignored") return t;
  return null;
}

function parseMutationSeverity(raw: unknown): BreachSeverity | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t === "info" || t === "warn" || t === "critical") return t;
  return null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, buildPhase: true, action: "noop" });
  }

  const access = await requireOpsAccess();
  if (!access.ok) {
    await writeAuditLog({
      req,
      action: "breach.mutate.denied",
      detail: `status=${access.status} role=${access.role ?? "unknown"} email=${access.email ?? "unknown"}`,
      meta: {
        route: "/api/hosts/[hostId]/breaches",
        method: "POST",
        requiredRole: "ops",
        status: access.status,
        email: access.email ?? null,
        role: access.role ?? null,
      },
    });
    return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
  }

  const { hostId } = await ctx.params;
  const host = await resolveHost(hostId, access.identity.userId);
  if (!host) return NextResponse.json({ ok: false, error: "Host not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";

  if (action === "create") {
    const title = trimString(body?.title, 180);
    if (!title) {
      return NextResponse.json({ ok: false, error: "title is required for create" }, { status: 400 });
    }

    const created = await prisma.breach.create({
      data: {
        hostId,
        code: trimString(body?.code, 80),
        title,
        detail: trimString(body?.detail, 2400),
        severity: parseMutationSeverity(body?.severity) ?? "warn",
        state: "open",
        openedTs: new Date(),
        evidenceJson:
          body?.evidence !== undefined ? JSON.stringify(body.evidence) : null,
      },
      select: {
        id: true,
        code: true,
        title: true,
        detail: true,
        severity: true,
        state: true,
        openedTs: true,
        fixedTs: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAuditLog({
      req,
      userId: access.identity.userId,
      hostId,
      action: "breach.create",
      detail: `Created breach '${created.title}'`,
      meta: {
        breachId: created.id,
      },
    });

    return NextResponse.json({ ok: true, action: "create", breach: created }, { status: 201 });
  }

  const breachId = trimString(body?.breachId, 80);
  if (!breachId) {
    return NextResponse.json({ ok: false, error: "breachId is required" }, { status: 400 });
  }

  const existing = await prisma.breach.findFirst({
    where: { id: breachId, hostId },
    select: {
      id: true,
      state: true,
      title: true,
    },
  });
  if (!existing) return NextResponse.json({ ok: false, error: "Breach not found" }, { status: 404 });

  let nextState: BreachState | null = null;
  if (action === "mark-fixed") nextState = "fixed";
  else if (action === "reopen") nextState = "open";
  else if (action === "ignore") nextState = "ignored";
  else if (action === "set-state") nextState = parseMutationState(body?.state);

  if (!nextState) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported action. Use create | mark-fixed | reopen | ignore | set-state.",
      },
      { status: 400 }
    );
  }

  const updated = await prisma.breach.update({
    where: { id: existing.id },
    data: {
      state: nextState,
      fixedTs: nextState === "fixed" ? new Date() : null,
    },
    select: {
      id: true,
      code: true,
      title: true,
      detail: true,
      severity: true,
      state: true,
      openedTs: true,
      fixedTs: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeAuditLog({
    req,
    userId: access.identity.userId,
    hostId,
    action: "breach.update_state",
    detail: `Breach '${existing.title}' moved ${existing.state} -> ${nextState}`,
    meta: {
      breachId: existing.id,
      from: existing.state,
      to: nextState,
    },
  });

  return NextResponse.json({
    ok: true,
    action,
    breach: updated,
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, buildPhase: true, action: "noop" });
  }

  return POST(req, ctx);
}
