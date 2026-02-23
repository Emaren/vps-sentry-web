import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const SENTRY_SERVICE = "vps-sentry.service";
const POLL_STEP_MS = 400;
const POLL_MAX_MS = 20_000;
const COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_MAX_BUFFER_BYTES = 512_000;

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

type ScanKickoffResult = {
  attempted: boolean;
  started: boolean;
  method: string | null;
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

async function readStatusTs(): Promise<string | null> {
  try {
    const raw = await readFile(STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const ts = parsed?.ts;
    return typeof ts === "string" ? ts : null;
  } catch {
    return null;
  }
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
      const e = err as { stdout?: unknown; stderr?: unknown };
      lastStdout = String(e.stdout ?? "");
      lastStderr = String(e.stderr ?? "");
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

function baselineAcceptedFromOutput(stdout: string, stderr: string): boolean {
  const joined = `${stdout}\n${stderr}`;
  if (/"baseline_accepted"\s*:\s*true/i.test(joined)) return true;
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return parsed?.baseline_accepted === true;
  } catch {
    return false;
  }
}

async function acceptBaseline(): Promise<CommandResult> {
  const attempts: CommandAttempt[] = [
    {
      command: "sudo",
      args: ["-n", "/usr/local/bin/vps-sentry", "--accept-baseline"],
      method: "sudo -n /usr/local/bin/vps-sentry --accept-baseline",
    },
    {
      command: "sudo",
      args: ["-n", "vps-sentry", "--accept-baseline"],
      method: "sudo -n vps-sentry --accept-baseline",
    },
    {
      command: "/usr/local/bin/vps-sentry",
      args: ["--accept-baseline"],
      method: "/usr/local/bin/vps-sentry --accept-baseline",
    },
    {
      command: "vps-sentry",
      args: ["--accept-baseline"],
      method: "vps-sentry --accept-baseline",
    },
  ];

  return runCommandAttempts(attempts);
}

async function triggerImmediateScan(): Promise<ScanKickoffResult> {
  const attempts: CommandAttempt[] = [
    {
      command: "sudo",
      args: ["-n", "/bin/systemctl", "start", SENTRY_SERVICE],
      method: "sudo -n /bin/systemctl start vps-sentry.service",
    },
    {
      command: "sudo",
      args: ["-n", "systemctl", "start", SENTRY_SERVICE],
      method: "sudo -n systemctl start vps-sentry.service",
    },
    {
      command: "/bin/systemctl",
      args: ["start", SENTRY_SERVICE],
      method: "/bin/systemctl start vps-sentry.service",
    },
    {
      command: "systemctl",
      args: ["start", SENTRY_SERVICE],
      method: "systemctl start vps-sentry.service",
    },
  ];

  const result = await runCommandAttempts(attempts);
  return {
    attempted: true,
    started: result.ok,
    method: result.method,
    error: result.ok ? undefined : result.error ?? "scan start failed",
  };
}

function buildPrivilegeHint(): string {
  return [
    "Grant non-interactive sudo for the web service user (tony) so Fix Now can run baseline accept + scan start.",
    "Example /etc/sudoers.d/vps-sentry-fixnow:",
    "tony ALL=(root) NOPASSWD: /usr/local/bin/vps-sentry --accept-baseline, /bin/systemctl start vps-sentry.service, /usr/bin/systemctl start vps-sentry.service",
  ].join(" ");
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/baseline-accept", source: "ops-baseline-accept" },
    async () => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      const beforeTs = await readStatusTs();
      const baselineRun = await acceptBaseline();

      if (!baselineRun.ok) {
        incrementCounter("ops.baseline_accept.failed.total", 1, { reason: "command_failed" });
        const detail = baselineRun.error ?? "baseline accept command failed";
        const hint = buildPrivilegeHint();
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.baseline_accept.failed",
          detail,
          meta: {
            method: baselineRun.method,
            stdout: truncate(baselineRun.stdout),
            stderr: truncate(baselineRun.stderr),
            hint,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            accepted: false,
            error: detail,
            hint,
            method: baselineRun.method,
            stdout: truncate(baselineRun.stdout),
            stderr: truncate(baselineRun.stderr),
          },
          { status: 409 }
        );
      }

      const accepted = baselineAcceptedFromOutput(baselineRun.stdout, baselineRun.stderr);
      const scan = await triggerImmediateScan();

      const deadline = Date.now() + POLL_MAX_MS;
      let currentTs: string | null = null;
      while (Date.now() < deadline) {
        await sleep(POLL_STEP_MS);
        currentTs = await readStatusTs();
        if (beforeTs && currentTs && currentTs !== beforeTs) break;
      }

      const finalTs = currentTs ?? (await readStatusTs());
      const statusAdvanced = Boolean(finalTs && (!beforeTs || finalTs !== beforeTs));

      incrementCounter("ops.baseline_accept.ok.total", 1, {
        accepted: accepted ? "true" : "false",
        statusAdvanced: statusAdvanced ? "true" : "false",
      });

      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.baseline_accept.ok",
        detail: `accepted=${accepted} statusAdvanced=${statusAdvanced}`,
        meta: {
          baselineMethod: baselineRun.method,
          scan,
          beforeTs,
          statusTs: finalTs,
        },
      });

      return NextResponse.json({
        ok: true,
        accepted,
        method: baselineRun.method,
        statusTs: finalTs,
        statusAdvanced,
        scan,
        stdout: truncate(baselineRun.stdout),
        stderr: truncate(baselineRun.stderr),
      });
    }
  );
}
