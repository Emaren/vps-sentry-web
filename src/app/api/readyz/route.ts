import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const res = NextResponse.json(
    {
      ok: true,
      service: "vps-sentry-web",
      ts: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      buildId: process.env.NEXT_BUILD_ID ?? null,
    },
    { status: 200 }
  );

  res.headers.set("cache-control", "no-store, max-age=0");
  return res;
}
