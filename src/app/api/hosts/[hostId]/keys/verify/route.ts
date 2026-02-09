import { NextResponse } from "next/server";
import { HOST_KEY_SCOPE_ORDER, normalizeHostKeyScope } from "@/lib/host-keys";
import { safeRequestUrl } from "@/lib/request-url";
import {
  readBearerToken,
  touchHostKeyLastUsed,
  verifyHostTokenForScope,
} from "@/lib/host-key-auth";

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

function parseRequiredScope(
  raw: unknown
):
  | { ok: true; requiredScope: ReturnType<typeof normalizeHostKeyScope> }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, requiredScope: null };
  if (typeof raw !== "string") return { ok: false, error: "scope must be a string" };
  const normalized = normalizeHostKeyScope(raw);
  if (!normalized) {
    return {
      ok: false,
      error: `Unsupported scope. Allowed: ${HOST_KEY_SCOPE_ORDER.join(", ")}`,
    };
  }
  return { ok: true, requiredScope: normalized };
}

async function runVerify(input: {
  req: Request;
  hostId: string;
  requiredScopeRaw: unknown;
  touchRaw: string | null;
}) {
  const token = readBearerToken(input.req);
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Missing Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const parsedScope = parseRequiredScope(input.requiredScopeRaw);
  if (!parsedScope.ok) {
    return NextResponse.json({ ok: false, error: parsedScope.error }, { status: 400 });
  }

  const verified = await verifyHostTokenForScope({
    hostId: input.hostId,
    token,
    requiredScope: parsedScope.requiredScope ?? undefined,
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

  const touch = parseBool(input.touchRaw, false);
  if (touch) {
    await touchHostKeyLastUsed(verified.key.id);
  }

  return NextResponse.json({
    ok: true,
    requiredScope: parsedScope.requiredScope ?? null,
    touched: touch,
    key: verified.keySummary,
    host: verified.host,
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
      requiredScope: null,
      touched: false,
      key: null,
      host: null,
    });
  }

  const { hostId } = await ctx.params;
  const url = safeRequestUrl(req);
  return runVerify({
    req,
    hostId,
    requiredScopeRaw: url.searchParams.get("scope") ?? url.searchParams.get("requiredScope"),
    touchRaw: url.searchParams.get("touch"),
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ hostId: string }> }
) {
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
  const url = safeRequestUrl(req);
  const body = await req.json().catch(() => ({}));
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
