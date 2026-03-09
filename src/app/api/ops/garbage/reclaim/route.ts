import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const COMMAND_TIMEOUT_MS = Number(process.env.VPS_ACTIONS_TIMEOUT_MS || 120_000);
const COMMAND_MAX_BUFFER_BYTES = Number(process.env.VPS_ACTIONS_MAX_BUFFER_BYTES || 1_000_000);
const execFileAsync = promisify(execFile);

type CommandAttempt = {
  command: string;
  args: string[];
  method: string;
};

type CommandResult = {
  ok: boolean;
  method: string | null;
  stdout: string;
  stderr: string;
  error: string | null;
};

type CleanupPayload = {
  ok: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  freedBytesEstimated: number | null;
  freedBytesActual: number | null;
  deletedCount: number | null;
  errorList: string[];
  estimate: unknown | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function parseCleanupPayload(raw: string): CleanupPayload | null {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = asRecord(parsedValue);
  if (!parsed) return null;
  const errors = Array.isArray(parsed.errors)
    ? parsed.errors.filter((row): row is string => typeof row === "string" && row.trim().length > 0)
    : [];
  return {
    ok: parsed.ok === true,
    startedAt: asString(parsed.started_at),
    finishedAt: asString(parsed.finished_at),
    freedBytesEstimated: asNumber(parsed.freed_bytes_estimated),
    freedBytesActual: asNumber(parsed.freed_bytes_actual),
    deletedCount: asNumber(parsed.deleted_count),
    errorList: errors,
    estimate: parsed.estimate ?? null,
  };
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
        stdout: String(run.stdout ?? ""),
        stderr: String(run.stderr ?? ""),
        error: null,
      };
    } catch (err: unknown) {
      const execErr = err as { stdout?: unknown; stderr?: unknown };
      lastStdout = String(execErr.stdout ?? "");
      lastStderr = String(execErr.stderr ?? "");
      lastError = errorMessage(err);
    }
  }

  return {
    ok: false,
    method: null,
    stdout: lastStdout,
    stderr: lastStderr,
    error: lastError,
  };
}

async function readStatusGarbageEstimate(): Promise<unknown | null> {
  try {
    const raw = await readFile(STATUS_PATH, "utf8");
    const parsed = asRecord(JSON.parse(raw) as unknown);
    return parsed?.garbage_estimate ?? null;
  } catch {
    return null;
  }
}

function buildPrivilegeHint(): string {
  return [
    "Grant non-interactive sudo for the web service user (tony) so the dashboard can run safe garbage reclaim.",
    "Example /etc/sudoers.d/90-vps-sentry-maintenance:",
    "tony ALL=(root) NOPASSWD: /usr/local/bin/vps-sentry-maintenance, /usr/local/bin/vps-sentry-garbage-reclaim",
  ].join(" ");
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/garbage/reclaim", source: "ops-garbage-reclaim" },
    async () => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const profile = typeof body.profile === "string" ? body.profile.trim().toLowerCase() : "safe";
      if (profile !== "safe") {
        return NextResponse.json({ ok: false, error: "Only the safe cleanup profile is supported." }, { status: 400 });
      }

      const attempts: CommandAttempt[] = [
        {
          command: "sudo",
          args: ["-n", "/usr/local/bin/vps-sentry-garbage-reclaim", "--json"],
          method: "sudo -n /usr/local/bin/vps-sentry-garbage-reclaim --json",
        },
        {
          command: "/usr/local/bin/vps-sentry-garbage-reclaim",
          args: ["--json"],
          method: "/usr/local/bin/vps-sentry-garbage-reclaim --json",
        },
      ];

      const command = await runCommandAttempts(attempts);
      const payload = command.stdout.trim() ? parseCleanupPayload(command.stdout) : null;
      const estimate = payload?.estimate ?? (await readStatusGarbageEstimate());

      if (!command.ok || !payload?.ok) {
        const detail =
          payload?.errorList[0] ||
          command.error ||
          "safe garbage reclaim failed";
        const hint = buildPrivilegeHint();
        incrementCounter("ops.garbage_reclaim.failed.total", 1, {});
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.garbage_reclaim.failed",
          detail,
          meta: {
            method: command.method,
            stdout: truncate(command.stdout),
            stderr: truncate(command.stderr),
            hint,
            cleanup: payload,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: detail,
            hint,
            cleanup: payload,
            estimate,
          },
          { status: 409 }
        );
      }

      incrementCounter("ops.garbage_reclaim.ok.total", 1, {});
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.garbage_reclaim.ok",
        detail: `freed=${payload.freedBytesActual ?? payload.freedBytesEstimated ?? 0} deleted=${payload.deletedCount ?? 0}`,
        meta: {
          method: command.method,
          cleanup: payload,
        },
      });

      return NextResponse.json({
        ok: true,
        cleanup: payload,
        estimate,
      });
    }
  );
}
