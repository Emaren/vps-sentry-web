import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

const LAST_PATH = "/var/lib/vps-sentry/public/last.json";
const DIFF_PATH = "/var/lib/vps-sentry/public/diff.json";

async function readJson(path: string) {
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw);
}

export async function GET() {
  try {
    const [last, diff] = await Promise.all([
      readJson(LAST_PATH).catch(() => null),
      readJson(DIFF_PATH).catch(() => null),
    ]);

    return NextResponse.json({
      ok: true,
      last,
      diff,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
