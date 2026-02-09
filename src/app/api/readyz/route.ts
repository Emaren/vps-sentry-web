import { NextResponse } from "next/server";
import { safeRequestUrl } from "@/lib/request-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbCheck = {
  ok: boolean;
  latencyMs: number;
  error: string | null;
};

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return error.message;
  try {
    const text = String(error);
    return text && text !== "[object Object]" ? text : "unknown_error";
  } catch {
    return "unknown_error";
  }
}

async function runDbCheck(): Promise<DbCheck> {
  const startedAt = Date.now();
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRawUnsafe("SELECT 1");
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: asErrorMessage(error),
    };
  }
}

export async function GET(req: Request) {
  const url = safeRequestUrl(req);
  const check = url.searchParams.get("check");
  const includeDbCheck = check === "db" || url.searchParams.get("db") === "1";
  const db = includeDbCheck ? await runDbCheck() : null;
  const ok = db ? db.ok : true;

  const res = NextResponse.json(
    {
      ok,
      service: "vps-sentry-web",
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      buildId: process.env.NEXT_BUILD_ID ?? null,
      checks: {
        db,
      },
    },
    { status: ok ? 200 : 503 }
  );

  res.headers.set("cache-control", "no-store, max-age=0");
  return res;
}
