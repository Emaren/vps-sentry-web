// src/app/api/healthz/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function tryReadBuildId(): string | null {
  try {
    // In prod, this will exist after `pnpm build`
    // e.g. /var/www/vps-sentry-web/.next/BUILD_ID
    const p = join(process.cwd(), ".next", "BUILD_ID");
    return readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
}

export async function GET() {
  const now = new Date();

  return NextResponse.json(
    {
      ok: true,
      ts: now.toISOString(),
      uptime_s: Math.round(process.uptime()),
      node: process.version,
      env: process.env.NODE_ENV ?? null,
      buildId: tryReadBuildId(),
      version: process.env.APP_VERSION ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
