import { access, mkdir, realpath, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { requireRoleAccess } from "@/lib/rbac";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const BIN_DIR = process.env.VPS_ACTIONS_BIN_DIR || "/var/www/VPSSentry/bin";
const COMMAND_TIMEOUT_MS = Number(process.env.VPS_ACTIONS_TIMEOUT_MS || 120_000);
const MAX_BUFFER_BYTES = Number(process.env.VPS_ACTIONS_MAX_BUFFER_BYTES || 1_000_000);

const DEFAULT_ALLOWED_SRC_ROOTS = ["/var/www", "/var/lib/vps-sentry", "/etc/vps-sentry", "/var/www/VPSSentry"];
const DEFAULT_ALLOWED_OUTDIR_ROOTS = ["/var/www/VPSSentry/context"];

type ArchiveMode = "zip" | "tgz" | "both";

type ExecError = Error & {
  code?: number | string;
  stdout?: string;
  stderr?: string;
};

function parseRoots(raw: string): string[] {
  return raw
    .split(/[,\n]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function canonicalizePathMaybe(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

async function resolveAllowedRoots(rawEnv: string | undefined, defaults: string[]): Promise<string[]> {
  const parsed = parseRoots(rawEnv ?? "");
  const roots = parsed.length > 0 ? parsed : defaults;
  const out = await Promise.all(roots.map((root) => canonicalizePathMaybe(root)));
  return out.filter(Boolean);
}

function isWithinRoot(target: string, root: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeMode(raw: unknown): ArchiveMode | null {
  if (typeof raw !== "string" || !raw.trim()) return "both";
  const mode = raw.trim().toLowerCase();
  if (mode === "zip" || mode === "tgz" || mode === "both") return mode;
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolveSourceDir(inputPath: string, allowedRoots: string[]): Promise<string> {
  if (!inputPath) throw new Error("src is required");
  if (!path.isAbsolute(inputPath)) throw new Error("src must be an absolute path");

  const sourceRealPath = await realpath(path.resolve(inputPath));
  const sourceStat = await stat(sourceRealPath);
  if (!sourceStat.isDirectory()) throw new Error("src must be a directory");

  const allowed = allowedRoots.some((root) => isWithinRoot(sourceRealPath, root));
  if (!allowed) throw new Error("src not allowed (outside allowed roots)");

  return sourceRealPath;
}

async function resolveOutdir(inputPath: string, allowedRoots: string[]): Promise<string> {
  if (!inputPath) throw new Error("outdir is required");
  if (!path.isAbsolute(inputPath)) throw new Error("outdir must be an absolute path");

  const outdirResolved = path.resolve(inputPath);
  const lexicalAllowed = allowedRoots.some((root) => isWithinRoot(outdirResolved, root));
  if (!lexicalAllowed) throw new Error("outdir not allowed (outside allowed roots)");

  await mkdir(outdirResolved, { recursive: true });
  const outdirRealPath = await realpath(outdirResolved);
  const realAllowed = allowedRoots.some((root) => isWithinRoot(outdirRealPath, root));
  if (!realAllowed) throw new Error("outdir not allowed after symlink resolution");

  const outdirStat = await stat(outdirRealPath);
  if (!outdirStat.isDirectory()) throw new Error("outdir must be a directory");

  return outdirRealPath;
}

export async function POST(req: Request) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, skipped: "build" });
  }

  return runObservedRoute(req, { route: "/api/ops/archive-dir", source: "ops-archive-dir" }, async (obsCtx) => {
    const accessResult = await requireRoleAccess("ops");
    if (!accessResult.ok) {
      incrementCounter("ops.archive_dir.denied.total", 1, {
        status: String(accessResult.status),
      });
      await writeAuditLog({
        req,
        action: "ops.archive_dir.denied",
        detail: `status=${accessResult.status}`,
        meta: {
          route: "/api/ops/archive-dir",
          status: accessResult.status,
          requiredRole: "ops",
          email: accessResult.email ?? null,
          role: accessResult.role ?? null,
        },
      });
      return NextResponse.json({ ok: false, error: accessResult.error }, { status: accessResult.status });
    }

    obsCtx.userId = accessResult.identity.userId;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const src = typeof body.src === "string" ? body.src.trim() : "";
    const outdirRaw =
      typeof body.outdir === "string" && body.outdir.trim()
        ? body.outdir.trim()
        : DEFAULT_ALLOWED_OUTDIR_ROOTS[0];
    const mode = normalizeMode(body.mode);

    if (!mode) {
      return NextResponse.json({ ok: false, error: "mode must be zip, tgz, or both" }, { status: 400 });
    }

    const scriptPath = path.join(BIN_DIR, "archive-dir");
    try {
      await access(scriptPath);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "archive-dir not found on server",
          scriptPath,
        },
        { status: 404 }
      );
    }

    const [allowedSourceRoots, allowedOutdirRoots] = await Promise.all([
      resolveAllowedRoots(process.env.VPS_ARCHIVE_ALLOWED_ROOTS, DEFAULT_ALLOWED_SRC_ROOTS),
      resolveAllowedRoots(process.env.VPS_ARCHIVE_OUTDIR_ROOTS, DEFAULT_ALLOWED_OUTDIR_ROOTS),
    ]);

    let sourceDir = "";
    let outdir = "";
    try {
      sourceDir = await resolveSourceDir(src, allowedSourceRoots);
      outdir = await resolveOutdir(outdirRaw, allowedOutdirRoots);
    } catch (error: unknown) {
      return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 400 });
    }

    const args: string[] = ["--src", sourceDir, "--outdir", outdir, "--json"];
    if (mode === "zip") args.push("--zip-only");
    else if (mode === "tgz") args.push("--tgz-only");
    else args.push("--both");

    const started = Date.now();
    try {
      const run = await execFileAsync(scriptPath, args, {
        cwd: "/var/www/VPSSentry",
        env: { ...process.env },
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
      });

      const stdout = String(run.stdout ?? "").trim();
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const durationMs = Date.now() - started;

      incrementCounter("ops.archive_dir.ok.total", 1, { mode });
      await writeAuditLog({
        req,
        userId: accessResult.identity.userId,
        action: "ops.archive_dir.ok",
        detail: `src=${sourceDir} outdir=${outdir} mode=${mode} durationMs=${durationMs}`,
        meta: {
          route: "/api/ops/archive-dir",
          src: sourceDir,
          outdir,
          mode,
          durationMs,
        },
      });

      return NextResponse.json({ ok: true, durationMs, result: parsed });
    } catch (error: unknown) {
      const durationMs = Date.now() - started;
      const execError = error as ExecError;
      const stderr = String(execError.stderr ?? execError.stdout ?? "");

      incrementCounter("ops.archive_dir.failed.total", 1, { mode });
      await writeAuditLog({
        req,
        userId: accessResult.identity.userId,
        action: "ops.archive_dir.failed",
        detail: `src=${sourceDir} outdir=${outdir} mode=${mode} durationMs=${durationMs} error=${errorMessage(error)}`,
        meta: {
          route: "/api/ops/archive-dir",
          src: sourceDir,
          outdir,
          mode,
          durationMs,
          error: errorMessage(error),
          stderr: stderr.slice(0, 1000),
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: errorMessage(error),
          stderr,
          durationMs,
        },
        { status: 409 }
      );
    }
  });
}
