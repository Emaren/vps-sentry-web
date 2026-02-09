// /var/www/vps-sentry-web/src/app/api/support/bundle/route.ts
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

function toAbsoluteUrlString(u: string): string {
  const s = String(u ?? "/").trim() || "/";
  try {
    return new URL(s).toString();
  } catch {
    return new URL(s, FALLBACK_BASE).toString();
  }
}

/**
 * Minimal Request-like object with safe *absolute* string `url` and no `nextUrl`.
 * Use this when passing req into helpers that might do new URL(req.url).
 */
function makeSafeReq(req: Request): Request {
  const url = toAbsoluteUrlString(safeUrlString(req));
  const method = (req as any)?.method ?? "GET";
  return { headers: req.headers, url, method } as any as Request;
}

// ---------- stubs ----------

function stub(req: Request) {
  const safeReq = makeSafeReq(req);
  const url = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);
  return NextResponse.json({
    ok: true,
    buildPhase: true,
    route: "/api/support/bundle",
    note: "stubbed during build collection",
    query: Object.fromEntries(url.searchParams.entries()),
  });
}

// ---------- original logic helpers ----------

type BundleOptions = {
  hostId?: string | null;
  includeRaw?: boolean;
  limit?: number;
  download?: boolean;
};

function parseBool(v: string | null): boolean {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

function parseLimit(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(20, Math.min(500, Math.trunc(n)));
}

function safeTrimString(v: unknown, max = 256): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

// ---------- lazy deps (avoid import-time surprises during build collection) ----------

async function loadDeps() {
  const [prismaMod, bundleMod, auditMod, rbacMod] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/support/bundle"),
    import("@/lib/audit-log").catch(() => ({} as any)),
    import("@/lib/rbac"),
  ]);

  const prisma = (prismaMod as any).prisma as any;

  const buildSupportBundle = (bundleMod as any).buildSupportBundle as (input: any) => Promise<any>;
  const SupportBundleError = (bundleMod as any).SupportBundleError as any;

  const writeAuditLog =
    (auditMod as any).writeAuditLog ??
    (async (_input: any) => {
      /* no-op */
    });

  const requireOpsAccess = (rbacMod as any).requireOpsAccess as () => Promise<any>;

  return { prisma, buildSupportBundle, SupportBundleError, writeAuditLog, requireOpsAccess };
}

// ---------- core handler ----------

async function buildAndRespond(req: Request, opts: BundleOptions) {
  const deps = await loadDeps();

  const access = await deps.requireOpsAccess();
  if (!access?.ok) {
    await deps.writeAuditLog({
      req,
      action: "support.bundle.denied",
      detail: `status=${access?.status ?? 403} role=${access?.role ?? "unknown"} email=${access?.email ?? "unknown"}`,
      meta: {
        route: "/api/support/bundle",
        status: access?.status ?? 403,
        requiredRole: "ops",
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
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bundle = await deps.buildSupportBundle({
      userId: user.id,
      hostId: opts.hostId ?? null,
      includeRaw: opts.includeRaw,
      limit: opts.limit,
    });

    await deps.writeAuditLog({
      req,
      userId: user.id,
      hostId: opts.hostId ?? null,
      action: "support.bundle.generated",
      detail: `Support bundle generated by ${user.email ?? user.id}`,
      meta: {
        route: "/api/support/bundle",
        hostId: opts.hostId ?? null,
        includeRaw: Boolean(opts.includeRaw),
        limit: opts.limit ?? null,
        download: Boolean(opts.download),
      },
    });

    const res = NextResponse.json(bundle);
    res.headers.set("Cache-Control", "no-store, max-age=0");

    if (opts.download) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      res.headers.set(
        "Content-Disposition",
        `attachment; filename="vps-sentry-support-${stamp}.json"`
      );
    }

    return res;
  } catch (err: unknown) {
    const SupportBundleError = deps.SupportBundleError;

    if (SupportBundleError && err instanceof SupportBundleError) {
      const status =
        typeof (err as any)?.status === "number" ? (err as any).status : 400;
      return NextResponse.json({ ok: false, error: (err as any).message }, { status });
    }

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// ---------- routes ----------

export async function GET(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stub(req);

  const safeReq = makeSafeReq(req);
  const url = new URL(String((safeReq as any).url ?? "/"), FALLBACK_BASE);

  const opts: BundleOptions = {
    hostId: safeTrimString(url.searchParams.get("hostId"), 128),
    includeRaw: parseBool(url.searchParams.get("includeRaw")),
    limit: parseLimit(url.searchParams.get("limit")),
    download: parseBool(url.searchParams.get("download")),
  };

  return buildAndRespond(safeReq, opts);
}

export async function POST(req: Request) {
  // MUST be first: Next build worker can invoke route handlers with a weird req.url object
  if (shouldStub(req)) return stub(req);

  const safeReq = makeSafeReq(req);
  const body: any = await req.json().catch(() => ({}));

  const limitRaw =
    typeof body?.limit === "number"
      ? String(body.limit)
      : typeof body?.limit === "string"
      ? body.limit
      : null;

  const opts: BundleOptions = {
    hostId: safeTrimString(body?.hostId, 128),
    includeRaw: Boolean(body?.includeRaw),
    limit: parseLimit(limitRaw),
    download: Boolean(body?.download),
  };

  return buildAndRespond(safeReq, opts);
}
