// /var/www/vps-sentry-web/src/app/api/status/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function envTrim(key: string): string | null {
  const v = process.env[key]?.trim();
  return v && v.length ? v : null;
}

// Defaults stay the same, but now you can override in systemd env:
const STATUS_PATH = envTrim("VPS_SENTRY_STATUS_PATH") ?? "/var/lib/vps-sentry/public/status.json";
const LAST_PATH = envTrim("VPS_SENTRY_LAST_PATH") ?? "/var/lib/vps-sentry/public/last.json";
const DIFF_PATH = envTrim("VPS_SENTRY_DIFF_PATH") ?? "/var/lib/vps-sentry/public/diff.json";

// If you *really* want this endpoint public (not recommended), set VPS_SENTRY_STATUS_PUBLIC=1
const IS_PUBLIC =
  envTrim("VPS_SENTRY_STATUS_PUBLIC") === "1" ||
  envTrim("VPS_SENTRY_STATUS_PUBLIC")?.toLowerCase() === "true";

// Hide absolute filesystem paths unless you explicitly allow it
const SHOW_PATHS =
  envTrim("VPS_SENTRY_STATUS_SHOW_PATHS") === "1" ||
  envTrim("VPS_SENTRY_STATUS_SHOW_PATHS")?.toLowerCase() === "true";

type ReadResult =
  | { ok: true; path: string; data: any }
  | { ok: false; path: string; error: string };

async function readJsonSafe(path: string): Promise<ReadResult> {
  try {
    const raw = await readFile(path, "utf-8");
    // allow empty file to behave like missing
    if (!raw || !raw.trim()) {
      return { ok: false, path, error: "empty file" };
    }
    return { ok: true, path, data: JSON.parse(raw) };
  } catch (e: any) {
    return { ok: false, path, error: String(e?.message ?? e) };
  }
}

function noStoreJson(body: any, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  // be explicit: status should never be cached by proxies/CDNs
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET() {
  // ---- Auth gate (prevents leaking ports/alerts to the public internet) ----
  if (!IS_PUBLIC) {
    const session = await getServerSession(authOptions);
    if (!session) {
      return noStoreJson({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
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
    return noStoreJson(
      {
        ok: false,
        error: "No readable status files found",
        ts,
        ...(SHOW_PATHS
          ? {
              paths: { status: STATUS_PATH, last: LAST_PATH, diff: DIFF_PATH },
            }
          : {}),
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

  const body: any = {
    ok: true,

    // Canonical payload (what your dashboard should increasingly rely on)
    status,

    // Back-compat payloads (what your dashboard already understands)
    last,
    diff,

    // Meta/debug
    ts,
    warnings: warnings.length ? warnings : undefined,
  };

  if (SHOW_PATHS) {
    body.paths = { status: STATUS_PATH, last: LAST_PATH, diff: DIFF_PATH };
  }

  return noStoreJson(body);
}
