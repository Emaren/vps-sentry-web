// /var/www/vps-sentry-web/src/app/api/status/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const LAST_PATH = "/var/lib/vps-sentry/public/last.json";
const DIFF_PATH = "/var/lib/vps-sentry/public/diff.json";

type ReadResult =
  | { ok: true; path: string; data: unknown }
  | { ok: false; path: string; error: string };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readJsonSafe(path: string): Promise<ReadResult> {
  try {
    const raw = await readFile(path, "utf-8");
    // allow empty file to behave like missing
    if (!raw || !raw.trim()) {
      return { ok: false, path, error: "empty file" };
    }
    return { ok: true, path, data: JSON.parse(raw) };
  } catch (e: unknown) {
    return { ok: false, path, error: errorMessage(e) };
  }
}

function noStoreJson(body: unknown, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  // be explicit: status should never be cached by proxies/CDNs
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET() {
  const ts = new Date().toISOString();

  // Prefer the canonical "published status" file (single source of truth)
  const [statusR, lastR, diffR] = await Promise.all([
    readJsonSafe(STATUS_PATH),
    readJsonSafe(LAST_PATH),
    readJsonSafe(DIFF_PATH),
  ]);

  const status = statusR.ok ? statusR.data : null;
  const last = lastR.ok ? lastR.data : null;
  const diff = diffR.ok ? diffR.data : null;

  // If literally everything is missing/unreadable, return a hard 500.
  if (!status && !last && !diff) {
    return noStoreJson(
      {
        ok: false,
        error: "No readable status files found",
        ts,
        paths: {
          status: STATUS_PATH,
          last: LAST_PATH,
          diff: DIFF_PATH,
        },
        details: {
          status: statusR.ok ? null : statusR.error,
          last: lastR.ok ? null : lastR.error,
          diff: diffR.ok ? null : diffR.error,
        },
      },
      { status: 500 }
    );
  }

  // Otherwise: OK (even if some are missing) + include warnings so UI/debug can show it.
  const warnings: string[] = [];
  if (!status) warnings.push(`status_unavailable: ${statusR.ok ? "n/a" : statusR.error}`);
  if (!last) warnings.push(`last_unavailable: ${lastR.ok ? "n/a" : lastR.error}`);
  if (!diff) warnings.push(`diff_unavailable: ${diffR.ok ? "n/a" : diffR.error}`);

  return noStoreJson({
    ok: true,

    // Canonical payload (what your dashboard should increasingly rely on)
    status,

    // Back-compat payloads (what your dashboard already understands)
    last,
    diff,

    // Meta/debug
    ts,
    paths: {
      status: STATUS_PATH,
      last: LAST_PATH,
      diff: DIFF_PATH,
    },
    warnings: warnings.length ? warnings : undefined,
  });
}
