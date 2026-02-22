// /var/www/VPSSentry/vps-sentry-web/src/app/api/status/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { incrementCounter, logEvent, runObservedRoute } from "@/lib/observability";

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

type Dict = Record<string, unknown>;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asDict(v: unknown): Dict | null {
  if (!v || typeof v !== "object") return null;
  if (Array.isArray(v)) return null;
  return v as Dict;
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function asInt(v: unknown): number | null {
  const n = asNumber(v);
  if (n === null) return null;
  const i = Math.trunc(n);
  return Number.isFinite(i) ? i : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function pickArray(...candidates: Array<unknown>): unknown[] | null {
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

function pickNestedArray(obj: Dict | null, a: string, b: string): unknown[] | null {
  if (!obj) return null;
  const inner = asDict(obj[a]);
  if (!inner) return null;
  const v = inner[b];
  return Array.isArray(v) ? v : null;
}

function normalizePortsAndVitals(input: {
  status: Dict | null;
  last: Dict | null;
}): { portsLocal: unknown[]; portsPublic: unknown[]; vitals: unknown } {
  const s = input.status;
  const l = input.last;

  // Ports may exist in either file (or nested under ports.local/public in older schemas).
  const portsLocal =
    pickArray(
      s?.ports_local,
      pickNestedArray(s, "ports", "local"),
      l?.ports_local,
      pickNestedArray(l, "ports", "local"),
    ) ?? [];

  const portsPublic =
    pickArray(
      s?.ports_public,
      pickNestedArray(s, "ports", "public"),
      l?.ports_public,
      pickNestedArray(l, "ports", "public"),
    ) ?? [];

  // Prefer vitals from last (it’s usually the richer snapshot), fall back to status.
  const vitals = l?.vitals ?? s?.vitals ?? {};

  return { portsLocal, portsPublic, vitals };
}

async function readJsonSafe(path: string): Promise<ReadResult> {
  try {
    const raw = await readFile(path, "utf-8");
    if (!raw || !raw.trim()) return { ok: false, path, error: "empty file" };
    return { ok: true, path, data: JSON.parse(raw) };
  } catch (e: unknown) {
    return { ok: false, path, error: errorMessage(e) };
  }
}

function noStoreJson(body: unknown, init?: { status?: number }) {
  const res = NextResponse.json(body, { status: init?.status ?? 200 });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function readStatusCache(): StatusCacheEntry | null {
  if (STATUS_CACHE_TTL_MS <= 0) return null;
  const g = globalThis as unknown as { __vpsStatusApiCache?: StatusCacheEntry };
  const cur = g.__vpsStatusApiCache;
  if (!cur) return null;
  if (cur.expiresAt <= Date.now()) {
    g.__vpsStatusApiCache = undefined;
    return null;
  }
  return cur;
}

function writeStatusCache(entry: StatusCacheEntry) {
  if (STATUS_CACHE_TTL_MS <= 0) return;
  const g = globalThis as unknown as { __vpsStatusApiCache?: StatusCacheEntry };
  g.__vpsStatusApiCache = entry;
}

/**
 * Fast "ps" snapshot for a PID set. Never throws.
 * ps rss is KB on Linux with "rss="; we convert to MB.
 */
async function readPsVitalsByPid(
  pids: number[],
): Promise<Map<number, { cpuPercent: number; rssMb: number }>> {
  const out = new Map<number, { cpuPercent: number; rssMb: number }>();
  const uniq = Array.from(new Set(pids.filter((p) => Number.isFinite(p) && p > 1)));
  if (uniq.length === 0) return out;

  const pidArg = uniq.join(",");
  const args = ["-o", "pid=,pcpu=,rss=", "-p", pidArg];

  const { stdout } = await new Promise<{ stdout: string }>((resolve) => {
    execFile(
      "ps",
      args,
      { timeout: 1500, maxBuffer: 1024 * 1024 },
      (_err, stdoutRaw) => resolve({ stdout: String(stdoutRaw ?? "") }),
    );
  });

  const lines = stdout.trim() ? stdout.trim().split("\n") : [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const cpu = Number(parts[1]);
    const rssKb = Number(parts[2]);
    if (!Number.isFinite(pid)) continue;
    out.set(pid, {
      cpuPercent: Number.isFinite(cpu) ? cpu : 0,
      rssMb: Number.isFinite(rssKb) ? Math.round((rssKb / 1024) * 10) / 10 : 0,
    });
  }
  return out;
}

/**
 * Your UI says: ports -> PID -> look in vitals.processes.top.
 * Problem: top is only "top N", so lots of PIDs show "—".
 *
 * Fix: ensure the PIDs we care about (ports_local PIDs) are present in
 * vitals.processes.top by appending lightweight ps-derived rows when missing.
 *
 * This is best-effort and never breaks the response if ps fails.
 */
async function enrichVitalsTopForPortPids(vitals: unknown, portsLocal: unknown[]): Promise<unknown> {
  const v = asDict(vitals) ?? {};
  const processes = asDict(v["processes"]) ?? {};
  const topRaw = Array.isArray(processes["top"]) ? (processes["top"] as unknown[]) : [];

  const top: Dict[] = [];
  const have = new Set<number>();
  for (const t of topRaw) {
    const d = asDict(t);
    if (!d) continue;
    top.push(d);
    const pid = asInt(d["pid"]);
    if (pid !== null) have.add(pid);
  }

  // Collect port->pid and a reasonable name for that PID.
  const pidToName = new Map<number, string>();
  const want: number[] = [];

  for (const rec of portsLocal) {
    const d = asDict(rec);
    if (!d) continue;

    const pid = asInt(d["pid"]);
    const port = asInt(d["port"]);
    const proc = asString(d["proc"]) ?? "process";

    if (pid === null || pid <= 1) continue;

    // Optional: ignore obvious noise to keep top smaller.
    // Keep app-ish ports (your stack is ~3000-3999 + 3310-3390 etc).

    if (!pidToName.has(pid)) pidToName.set(pid, proc);
    if (!have.has(pid)) want.push(pid);
  }

  const uniqWant = Array.from(new Set(want));
  if (uniqWant.length === 0) return vitals;

  const cpu = asDict(v["cpu"]);
  const mem = asDict(v["memory"]);
  const cores = asNumber(cpu?.["cores"]) ?? 1;
  const totalMb = asNumber(mem?.["total_mb"]) ?? null;

  const ps = await readPsVitalsByPid(uniqWant);

  const extras: Dict[] = [];
  for (const pid of uniqWant) {
    const row = ps.get(pid);
    if (!row) continue;

    const cpuCap = Math.max(0, Math.min(row.cpuPercent, 100 * cores));
    const memCap =
      totalMb && totalMb > 0 ? Math.max(0, Math.min((row.rssMb / totalMb) * 100, 100)) : 0;

    extras.push({
      pid,
      name: pidToName.get(pid) ?? "process",
      cpu_share_percent: Math.round(cpuCap * 10) / 10,
      cpu_capacity_percent: Math.round(cpuCap * 10) / 10,
      memory_mb: row.rssMb,
      memory_capacity_percent: Math.round(memCap * 10) / 10,
    });
  }

  if (extras.length === 0) return vitals;

  // De-dupe by pid + cap total size so we don't bloat payloads.
  const merged: Dict[] = [];
  const seen = new Set<number>();

  for (const d of top) {
    const pid = asInt(d["pid"]);
    if (pid !== null) seen.add(pid);
    merged.push(d);
  }

  for (const d of extras) {
    const pid = asInt(d["pid"]);
    if (pid === null || seen.has(pid)) continue;
    seen.add(pid);
    merged.push(d);
  }

  const MAX_TOP = 50;
  const mergedTop = merged.slice(0, MAX_TOP);

  const processesOut: Dict = { ...processes, top: mergedTop };
  const vitalsOut: Dict = { ...v, processes: processesOut };
  return vitalsOut;
}

export async function GET(req: Request) {
  return runObservedRoute(req, { route: "/api/status", source: "status-api" }, async (obsCtx) => {
    const cached = readStatusCache();
    if (cached) {
      incrementCounter("status.api.cache.hit.total", 1);
      logEvent("debug", "status.api.cache.hit", obsCtx, { status: cached.status });
      return noStoreJson(cached.body, { status: cached.status });
    }

    incrementCounter("status.api.cache.miss.total", 1);
    const ts = new Date().toISOString();

    const [statusR, lastR, diffR] = await Promise.all([
      readJsonSafe(STATUS_PATH),
      readJsonSafe(LAST_PATH),
      readJsonSafe(DIFF_PATH),
    ]);

    const statusRaw = statusR.ok ? asDict(statusR.data) : null;
    const lastRaw = lastR.ok ? asDict(lastR.data) : null;
    const diff = diffR.ok ? diffR.data : null;

    // If literally everything is missing/unreadable, return hard 500.
    if (!statusRaw && !lastRaw && !diff) {
      incrementCounter("status.api.unavailable.total", 1);
      const body = {
        ok: false,
        error: "No readable status files found",
        ts,
        paths: { status: STATUS_PATH, last: LAST_PATH, diff: DIFF_PATH },
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

      logEvent("error", "status.api.no_files", obsCtx, { details: body.details });
      return noStoreJson(body, { status: 500 });
    }

    // OK (even if some are missing) + include warnings.
    const warnings: string[] = [];
    if (!statusRaw) warnings.push(`status_unavailable: ${statusR.ok ? "n/a" : statusR.error}`);
    if (!lastRaw) warnings.push(`last_unavailable: ${lastR.ok ? "n/a" : lastR.error}`);
    if (!diff) warnings.push(`diff_unavailable: ${diffR.ok ? "n/a" : diffR.error}`);

    const { portsLocal, portsPublic, vitals } = normalizePortsAndVitals({
      status: statusRaw,
      last: lastRaw,
    });

    // 🔥 Make CPU/RAM “—” go away: add ps-derived rows for port PIDs into vitals.processes.top.
    const vitalsEnriched = await enrichVitalsTopForPortPids(vitals, portsLocal);

    // Ensure BOTH payloads carry ports_local/ports_public + vitals so downstream can rely on either.
    const statusOut: Dict | null = statusRaw
      ? { ...statusRaw, ports_local: portsLocal, ports_public: portsPublic, vitals: vitalsEnriched }
      : lastRaw
        ? { ...lastRaw, ports_local: portsLocal, ports_public: portsPublic, vitals: vitalsEnriched }
        : null;

    const lastOut: Dict | null = lastRaw
      ? { ...lastRaw, ports_local: portsLocal, ports_public: portsPublic, vitals: vitalsEnriched }
      : statusRaw
        ? { ...statusRaw, ports_local: portsLocal, ports_public: portsPublic, vitals: vitalsEnriched }
        : null;

    const body = {
      ok: true,
      status: statusOut,
      last: lastOut,
      diff,
      ts,
      paths: { status: STATUS_PATH, last: LAST_PATH, diff: DIFF_PATH },
      warnings: warnings.length ? warnings : undefined,
    };

    writeStatusCache({
      body,
      status: 200,
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
    });

    if (warnings.length) {
      incrementCounter("status.api.partial.total", 1);
      logEvent("warn", "status.api.partial", obsCtx, { warnings });
    } else {
      incrementCounter("status.api.ok.total", 1);
    }

    return noStoreJson(body);
  });
}