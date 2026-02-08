// /var/www/vps-sentry-web/src/app/api/status/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const LAST_PATH = "/var/lib/vps-sentry/public/last.json";
const DIFF_PATH = "/var/lib/vps-sentry/public/diff.json";
const STATUS_CACHE_TTL_MS = readStatusCacheTtlMs();

type StatusCacheEntry = {
  expiresAt: number;
  status: number;
  body: unknown;
};

function readStatusCacheTtlMs(): number {
  const raw = Number(process.env.VPS_STATUS_CACHE_TTL_MS ?? "1200");
  if (!Number.isFinite(raw)) return 1200;
  if (raw < 0) return 0;
  if (raw > 10_000) return 10_000;
  return Math.trunc(raw);
}

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

function readStatusCache(): StatusCacheEntry | null {
  if (STATUS_CACHE_TTL_MS <= 0) return null;
  const g = globalThis as unknown as { __vpsStatusApiCache?: StatusCacheEntry };
  if (!g.__vpsStatusApiCache) return null;
  if (g.__vpsStatusApiCache.expiresAt <= Date.now()) {
    g.__vpsStatusApiCache = undefined;
    return null;
  }
  return g.__vpsStatusApiCache;
}

function writeStatusCache(entry: StatusCacheEntry) {
  if (STATUS_CACHE_TTL_MS <= 0) return;
  const g = globalThis as unknown as { __vpsStatusApiCache?: StatusCacheEntry };
  g.__vpsStatusApiCache = entry;
}

export async function GET() {
  const cached = readStatusCache();
  if (cached) {
    return noStoreJson(cached.body, { status: cached.status });
  }

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
    const body = {
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
    };
    writeStatusCache({
      body,
      status: 500,
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
    });
    return noStoreJson(body, { status: 500 });
  }

  // Otherwise: OK (even if some are missing) + include warnings so UI/debug can show it.
  const warnings: string[] = [];
  if (!status) warnings.push(`status_unavailable: ${statusR.ok ? "n/a" : statusR.error}`);
  if (!last) warnings.push(`last_unavailable: ${lastR.ok ? "n/a" : lastR.error}`);
  if (!diff) warnings.push(`diff_unavailable: ${diffR.ok ? "n/a" : diffR.error}`);

  const body = {
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
  };

  writeStatusCache({
    body,
    status: 200,
    expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
  });

  return noStoreJson(body);
}
