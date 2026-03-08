import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { safeRequestUrl } from "@/lib/request-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbCheck = {
  ok: boolean;
  latencyMs: number;
  error: string | null;
};

type PublishedStatusCheck = {
  ok: boolean;
  error: string | null;
  files: {
    status: boolean;
    last: boolean;
    diff: boolean;
  };
};

const PUBLISHED_STATUS_FILES = {
  status: "/var/lib/vps-sentry/public/status.json",
  last: "/var/lib/vps-sentry/public/last.json",
  diff: "/var/lib/vps-sentry/public/diff.json",
} as const;

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

async function canReadJson(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return false;
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

async function runPublishedStatusCheck(): Promise<PublishedStatusCheck> {
  const [statusOk, lastOk, diffOk] = await Promise.all([
    canReadJson(PUBLISHED_STATUS_FILES.status),
    canReadJson(PUBLISHED_STATUS_FILES.last),
    canReadJson(PUBLISHED_STATUS_FILES.diff),
  ]);

  const ok = statusOk && lastOk && diffOk;
  return {
    ok,
    error: ok ? null : "published_status_unreadable",
    files: {
      status: statusOk,
      last: lastOk,
      diff: diffOk,
    },
  };
}

export async function GET(req: Request) {
  const url = safeRequestUrl(req);
  const check = url.searchParams.get("check");
  const includeDbCheck = check === "db" || url.searchParams.get("db") === "1";
  const includeStatusCheck = check === "status" || check === "full" || check === null;
  const db = includeDbCheck ? await runDbCheck() : null;
  const status = includeStatusCheck ? await runPublishedStatusCheck() : null;
  const ok = (status ? status.ok : true) && (db ? db.ok : true);

  const res = NextResponse.json(
    {
      ok,
      service: "vps-sentry-web",
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      buildId: process.env.NEXT_BUILD_ID ?? null,
      checks: {
        db,
        status,
      },
    },
    { status: ok ? 200 : 503 }
  );

  res.headers.set("cache-control", "no-store, max-age=0");
  return res;
}
