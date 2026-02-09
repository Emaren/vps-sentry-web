// /var/www/vps-sentry-web/src/app/api/hosts/[hostId]/keys/verify/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function parseBool(v: string | null, fallback = false): boolean {
  if (!v) return fallback;
  const t = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return fallback;
}

async function runVerify(input: {
  req: Request;
  hostId: string;
  requiredScopeRaw: unknown;
  touchRaw: string | null;
}) {
  const [{ HOST_KEY_SCOPE_ORDER, normalizeHostKeyScope }, keyAuth] = await Promise.all([
    import("@/lib/host-keys"),
    import("@/lib/host-key-auth"),
  ]);

  const token = keyAuth.readBearerToken(input.req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const raw = input.requiredScopeRaw;
  let requiredScope: ReturnType<typeof normalizeHostKeyScope> | null = null;

  if (raw !== undefined && raw !== null && raw !== "") {
    if (typeof raw !== "string") {
      return NextResponse.json({ ok: false, error: "scope must be a string" }, { status: 400 });
    }
    requiredScope = normalizeHostKeyScope(raw);
    if (!requiredScope) {
      return NextResponse.json(
        { ok: false, error: `Unsupported scope. Allowed: ${HOST_KEY_SCOPE_ORDER.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const verified = await keyAuth.verifyHostTokenForScope({
    hostId: input.hostId,
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

  const touch = parseBool(input.touchRaw, false);
  if (touch) {
    await keyAuth.touchHostKeyLastUsed(verified.key.id);
  }

  return NextResponse.json({
    ok: true,
    requiredScope: requiredScope ?? null,
    touched: touch,
    key: verified.keySummary,
    host: verified.host,
  });
}

// Next 16 route checker expects ctx.params to be a Promise (same pattern as pages)
export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      requiredScope: null,
      touched: false,
      key: null,
      host: null,
    });
  }

  const { hostId } = await ctx.params;

  const { safeRequestUrl } = await import("@/lib/request-url");
  const url = safeRequestUrl(req);

  return runVerify({
    req,
    hostId,
    requiredScopeRaw: url.searchParams.get("scope") ?? url.searchParams.get("requiredScope"),
    touchRaw: url.searchParams.get("touch"),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({
      ok: true,
      buildPhase: true,
      requiredScope: null,
      touched: false,
      key: null,
      host: null,
    });
  }

  const { hostId } = await ctx.params;

  const { safeRequestUrl } = await import("@/lib/request-url");
  const url = safeRequestUrl(req);

  const body = await req.json().catch(() => ({} as any));

  return runVerify({
    req,
    hostId,
    requiredScopeRaw:
      body?.scope ??
      body?.requiredScope ??
      url.searchParams.get("scope") ??
      url.searchParams.get("requiredScope"),
    touchRaw: url.searchParams.get("touch"),
  });
}
