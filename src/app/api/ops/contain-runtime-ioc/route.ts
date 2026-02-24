import { NextResponse } from "next/server";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const QUARANTINE_ROOTS = ["/var/lib/vps-sentry/quarantine", "/tmp/vps-sentry-quarantine"];
const MAX_CANDIDATES = 5;
const COMMAND_TIMEOUT_MS = Number(process.env.VPS_ACTIONS_TIMEOUT_MS || 15_000);
const COMMAND_MAX_BUFFER_BYTES = Number(process.env.VPS_ACTIONS_MAX_BUFFER_BYTES || 1_000_000);

const USER_WRITABLE_PREFIXES = [
  "/home/",
  "/tmp/",
  "/var/tmp/",
  "/dev/shm/",
  "/run/user/",
];

const SYSTEM_PATH_PREFIXES = [
  "/bin/",
  "/sbin/",
  "/usr/bin/",
  "/usr/sbin/",
  "/usr/lib/",
  "/lib/",
  "/lib64/",
  "/opt/",
  "/snap/",
  "/etc/",
];

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

type SuspiciousCandidate = {
  pid: number;
  user: string;
  proc: string;
  exe: string;
  cmdline: string;
  reasons: string[];
};

type CommandAttempt = {
  command: string;
  args: string[];
  method: string;
};

type CommandResult = {
  ok: boolean;
  method: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
};

type CandidateResult = {
  pid: number;
  user: string;
  proc: string;
  exe: string;
  containable: boolean;
  contained: boolean;
  skipped: boolean;
  detail: string;
  quarantinePath: string | null;
  sha256: string | null;
};

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === "object" ? (v as JsonRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

function asInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return 0;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max = 5000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
}

function cleanExePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("\u0000") || trimmed.includes("\n") || trimmed.includes("\r")) return "";
  const normalized = path.normalize(trimmed);
  if (!path.isAbsolute(normalized)) return "";
  return normalized;
}

function normalizeReasons(raw: unknown): string[] {
  return asArray(raw)
    .map((item) => asString(item))
    .filter((line) => line.length > 0)
    .slice(0, 8);
}

function hasContainmentReason(reasons: string[]): boolean {
  if (reasons.length === 0) return false;
  return reasons.some((reason) => {
    const lower = reason.toLowerCase();
    return (
      lower.includes("user-writable path") ||
      lower.includes("writable runtime path") ||
      lower.includes("outbound fanout") ||
      lower.includes("execution ioc") ||
      lower.includes("suspicious")
    );
  });
}

function isContainablePath(exe: string): boolean {
  if (!exe) return false;
  const lower = exe.toLowerCase();
  if (SYSTEM_PATH_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  return USER_WRITABLE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function parseCandidate(row: JsonRecord): SuspiciousCandidate | null {
  const pid = asInt(row.pid);
  if (pid <= 1) return null;

  const exe = cleanExePath(asString(row.exe));
  const reasons = normalizeReasons(row.reasons);
  if (!exe || !isContainablePath(exe) || !hasContainmentReason(reasons)) {
    return null;
  }

  return {
    pid,
    user: asString(row.user) || "unknown",
    proc: asString(row.proc) || "process",
    exe,
    cmdline: asString(row.cmdline),
    reasons,
  };
}

function extractCandidates(status: JsonRecord): SuspiciousCandidate[] {
  const threat = asRecord(status.threat);
  const rows = asArray(threat?.suspicious_processes)
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => item !== null);

  const out: SuspiciousCandidate[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const candidate = parseCandidate(row);
    if (!candidate) continue;
    if (seen.has(candidate.pid)) continue;
    seen.add(candidate.pid);
    out.push(candidate);
    if (out.length >= MAX_CANDIDATES) break;
  }

  return out;
}

async function runCommandAttempts(attempts: CommandAttempt[]): Promise<CommandResult> {
  let lastError = "command failed";
  let lastStdout = "";
  let lastStderr = "";

  for (const attempt of attempts) {
    try {
      const run = await execFileAsync(attempt.command, attempt.args, {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      });
      return {
        ok: true,
        method: attempt.method,
        error: null,
        stdout: String(run.stdout ?? ""),
        stderr: String(run.stderr ?? ""),
      };
    } catch (err: unknown) {
      const e = err as { stdout?: unknown; stderr?: unknown };
      lastStdout = String(e.stdout ?? "");
      lastStderr = String(e.stderr ?? "");
      lastError = errorMessage(err);
    }
  }

  return {
    ok: false,
    method: null,
    error: lastError,
    stdout: lastStdout,
    stderr: lastStderr,
  };
}

function isNoSuchProcess(run: CommandResult): boolean {
  const text = `${run.error ?? ""}\n${run.stderr}`.toLowerCase();
  return text.includes("no such process");
}

function isProcessAliveError(run: CommandResult): boolean {
  const text = `${run.error ?? ""}\n${run.stderr}`.toLowerCase();
  if (!text) return true;
  if (text.includes("no such process")) return false;
  if (text.includes("operation not permitted") || text.includes("permission denied")) return true;
  return true;
}

async function processLikelyAlive(pid: number): Promise<boolean> {
  const check = await runCommandAttempts([
    { command: "kill", args: ["-0", String(pid)], method: "kill -0" },
    { command: "sudo", args: ["-n", "kill", "-0", String(pid)], method: "sudo -n kill -0" },
  ]);
  if (check.ok) return true;
  return isProcessAliveError(check);
}

async function stopProcess(pid: number): Promise<{ ok: boolean; detail: string }> {
  const term = await runCommandAttempts([
    { command: "kill", args: ["-TERM", String(pid)], method: "kill -TERM" },
    { command: "sudo", args: ["-n", "kill", "-TERM", String(pid)], method: "sudo -n kill -TERM" },
  ]);

  if (!term.ok && !isNoSuchProcess(term)) {
    const termErr = truncate(term.error ?? "TERM failed");
    return { ok: false, detail: `TERM failed (${termErr})` };
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  if (!(await processLikelyAlive(pid))) {
    return { ok: true, detail: term.ok ? "Process stopped after TERM." : "Process was already stopped." };
  }

  const kill = await runCommandAttempts([
    { command: "kill", args: ["-KILL", String(pid)], method: "kill -KILL" },
    { command: "sudo", args: ["-n", "kill", "-KILL", String(pid)], method: "sudo -n kill -KILL" },
  ]);

  if (!kill.ok && !isNoSuchProcess(kill)) {
    const killErr = truncate(kill.error ?? "KILL failed");
    return { ok: false, detail: `KILL failed (${killErr})` };
  }

  await new Promise((resolve) => setTimeout(resolve, 150));
  if (!(await processLikelyAlive(pid))) {
    return { ok: true, detail: kill.ok ? "Process stopped after KILL." : "Process was already stopped." };
  }

  return { ok: false, detail: "Process still appears alive after TERM/KILL attempts." };
}

async function ensureQuarantineRoot(): Promise<string | null> {
  for (const root of QUARANTINE_ROOTS) {
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      return root;
    } catch {
      const run = await runCommandAttempts([
        { command: "mkdir", args: ["-p", root], method: "mkdir -p" },
        { command: "sudo", args: ["-n", "mkdir", "-p", root], method: "sudo -n mkdir -p" },
      ]);
      if (run.ok) return root;
    }
  }
  return null;
}

function safeNamePart(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return "runtime-ioc";
  return cleaned.slice(0, 80);
}

async function moveWithFallback(src: string, dst: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await rename(src, dst);
    return { ok: true, detail: "moved via fs.rename" };
  } catch (err: unknown) {
    const fallback = await runCommandAttempts([
      { command: "mv", args: ["--", src, dst], method: "mv" },
      { command: "sudo", args: ["-n", "mv", "--", src, dst], method: "sudo -n mv" },
    ]);
    if (fallback.ok) return { ok: true, detail: `moved via ${fallback.method}` };
    return {
      ok: false,
      detail: `move failed (${truncate(errorMessage(err))}; ${truncate(fallback.error ?? "fallback failed")})`,
    };
  }
}

async function copyWithFallback(src: string, dst: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await copyFile(src, dst);
    return { ok: true, detail: "copied via fs.copyFile" };
  } catch (err: unknown) {
    const fallback = await runCommandAttempts([
      { command: "cp", args: ["-a", "--", src, dst], method: "cp -a" },
      { command: "sudo", args: ["-n", "cp", "-a", "--", src, dst], method: "sudo -n cp -a" },
    ]);
    if (fallback.ok) return { ok: true, detail: `copied via ${fallback.method}` };
    return {
      ok: false,
      detail: `copy failed (${truncate(errorMessage(err))}; ${truncate(fallback.error ?? "fallback failed")})`,
    };
  }
}

async function chmodZeroWithFallback(target: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await chmod(target, 0o000);
    return { ok: true, detail: "locked via fs.chmod" };
  } catch (err: unknown) {
    const fallback = await runCommandAttempts([
      { command: "chmod", args: ["000", "--", target], method: "chmod 000" },
      { command: "sudo", args: ["-n", "chmod", "000", "--", target], method: "sudo -n chmod 000" },
    ]);
    if (fallback.ok) return { ok: true, detail: `locked via ${fallback.method}` };
    return {
      ok: false,
      detail: `chmod failed (${truncate(errorMessage(err))}; ${truncate(fallback.error ?? "fallback failed")})`,
    };
  }
}

async function createLockedPlaceholder(target: string): Promise<{ ok: boolean; detail: string }> {
  try {
    await writeFile(target, "", { mode: 0o000, flag: "wx" });
    return { ok: true, detail: "placeholder created via fs.writeFile" };
  } catch (err: unknown) {
    const create = await runCommandAttempts([
      { command: "touch", args: ["--", target], method: "touch" },
      { command: "sudo", args: ["-n", "touch", "--", target], method: "sudo -n touch" },
    ]);
    if (!create.ok) {
      return {
        ok: false,
        detail: `placeholder create failed (${truncate(errorMessage(err))}; ${truncate(create.error ?? "fallback failed")})`,
      };
    }
    const lock = await chmodZeroWithFallback(target);
    if (!lock.ok) {
      return { ok: false, detail: `placeholder created but lock failed (${lock.detail})` };
    }
    return { ok: true, detail: `placeholder created via ${create.method}; ${lock.detail}` };
  }
}

async function hashFileSha256(target: string): Promise<string | null> {
  try {
    const payload = await readFile(target);
    return createHash("sha256").update(payload).digest("hex");
  } catch {
    return null;
  }
}

async function quarantineExecutable(candidate: SuspiciousCandidate): Promise<{
  ok: boolean;
  detail: string;
  path: string | null;
  sha256: string | null;
}> {
  const root = await ensureQuarantineRoot();
  if (!root) {
    return {
      ok: false,
      detail: "Could not create/access quarantine root (/var/lib/vps-sentry/quarantine or /tmp/vps-sentry-quarantine).",
      path: null,
      sha256: null,
    };
  }

  const stamp = nowStamp();
  const safeBase = safeNamePart(path.basename(candidate.exe));
  const quarantinePath = path.join(root, `${safeBase}.pid${candidate.pid}.${stamp}.quarantine`);

  const move = await moveWithFallback(candidate.exe, quarantinePath);
  if (move.ok) {
    const placeholder = await createLockedPlaceholder(candidate.exe);
    const digest = await hashFileSha256(quarantinePath);
    const detail = placeholder.ok
      ? `Executable moved to quarantine (${quarantinePath}); ${placeholder.detail}.`
      : `Executable moved to quarantine (${quarantinePath}); placeholder warning: ${placeholder.detail}`;
    return {
      ok: true,
      detail,
      path: quarantinePath,
      sha256: digest,
    };
  }

  const copy = await copyWithFallback(candidate.exe, quarantinePath);
  if (!copy.ok) {
    return {
      ok: false,
      detail: `Could not move/copy executable to quarantine. ${copy.detail}`,
      path: null,
      sha256: null,
    };
  }

  const lock = await chmodZeroWithFallback(candidate.exe);
  const digest = await hashFileSha256(quarantinePath);
  if (!lock.ok) {
    return {
      ok: false,
      detail: `Copied executable to quarantine (${quarantinePath}) but failed to lock original path. ${lock.detail}`,
      path: quarantinePath,
      sha256: digest,
    };
  }

  return {
    ok: true,
    detail: `Copied executable to quarantine (${quarantinePath}) and locked original path.`,
    path: quarantinePath,
    sha256: digest,
  };
}

async function readStatusJson(): Promise<JsonRecord | null> {
  try {
    const raw = await readFile(STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw) as JsonRecord;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/contain-runtime-ioc", source: "ops-contain-runtime-ioc" },
    async () => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      const status = await readStatusJson();
      if (!status) {
        incrementCounter("ops.contain_runtime_ioc.failed.total", 1, { reason: "status_unavailable" });
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.contain_runtime_ioc.failed",
          detail: "status.json unavailable or unreadable",
          meta: { statusPath: STATUS_PATH },
        });
        return NextResponse.json(
          { ok: false, error: "Status snapshot unavailable for runtime IOC containment." },
          { status: 503 }
        );
      }

      const host = asString(status.host) || "unknown";
      const snapshotTs = asString(status.ts) || null;
      const candidates = extractCandidates(status);

      if (candidates.length === 0) {
        incrementCounter("ops.contain_runtime_ioc.ok.total", 1, { result: "noop" });
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.contain_runtime_ioc.ok",
          detail: "No containable runtime IOC candidates in latest snapshot.",
          meta: { host, snapshotTs, considered: 0 },
        });
        return NextResponse.json({
          ok: true,
          host,
          snapshotTs,
          considered: 0,
          containable: 0,
          contained: 0,
          skipped: 0,
          failed: 0,
          results: [],
        });
      }

      const results: CandidateResult[] = [];
      for (const candidate of candidates) {
        const stop = await stopProcess(candidate.pid);
        if (!stop.ok) {
          results.push({
            pid: candidate.pid,
            user: candidate.user,
            proc: candidate.proc,
            exe: candidate.exe,
            containable: true,
            contained: false,
            skipped: false,
            detail: stop.detail,
            quarantinePath: null,
            sha256: null,
          });
          continue;
        }

        const quarantine = await quarantineExecutable(candidate);
        results.push({
          pid: candidate.pid,
          user: candidate.user,
          proc: candidate.proc,
          exe: candidate.exe,
          containable: true,
          contained: quarantine.ok,
          skipped: false,
          detail: `${stop.detail} ${quarantine.detail}`,
          quarantinePath: quarantine.path,
          sha256: quarantine.sha256,
        });
      }

      const considered = candidates.length;
      const containable = candidates.length;
      const contained = results.filter((row) => row.contained).length;
      const failed = results.filter((row) => !row.contained && !row.skipped).length;
      const skipped = results.filter((row) => row.skipped).length;

      incrementCounter("ops.contain_runtime_ioc.ok.total", 1, {
        result: failed > 0 ? "partial" : "success",
      });

      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: failed > 0 ? "ops.contain_runtime_ioc.partial" : "ops.contain_runtime_ioc.ok",
        detail: `host=${host} considered=${considered} contained=${contained} failed=${failed}`,
        meta: {
          host,
          snapshotTs,
          considered,
          containable,
          contained,
          skipped,
          failed,
          results: results.map((row) => ({
            pid: row.pid,
            user: row.user,
            proc: row.proc,
            exe: row.exe,
            contained: row.contained,
            quarantinePath: row.quarantinePath,
            sha256: row.sha256,
            detail: truncate(row.detail, 400),
          })),
        },
      });

      return NextResponse.json({
        ok: true,
        host,
        snapshotTs,
        considered,
        containable,
        contained,
        skipped,
        failed,
        results,
      });
    }
  );
}
