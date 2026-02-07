// src/app/api/readyz/route.ts

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ReadyCheck = {
  name: string;
  ok: boolean;
  ms?: number;
  detail?: string;
};

function msSince(t0: number) {
  return Math.round(performance.now() - t0);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function GET() {
  const started = performance.now();
  const checks: ReadyCheck[] = [];

  // 1) DB connectivity (authoritative “ready” check)
  {
    const t0 = performance.now();
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, 1500, "db");
      checks.push({ name: "db", ok: true, ms: msSince(t0) });
    } catch (e: any) {
      checks.push({
        name: "db",
        ok: false,
        ms: msSince(t0),
        detail: e?.message ? String(e.message) : "db check failed",
      });
    }
  }

  // 2) Required env (don’t leak values)
  {
    const t0 = performance.now();
    const required = ["DATABASE_URL"];
    const missing = required.filter((k) => !(process.env[k]?.trim?.() ?? ""));
    checks.push({
      name: "env",
      ok: missing.length === 0,
      ms: msSince(t0),
      detail: missing.length ? `missing: ${missing.join(", ")}` : undefined,
    });
  }

  const ok = checks.every((c) => c.ok);

  return NextResponse.json(
    {
      ok,
      ts: new Date().toISOString(),
      ms: Math.round(performance.now() - started),
      checks,
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    }
  );
}
