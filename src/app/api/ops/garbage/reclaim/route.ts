import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const RUNNING_PATH = "/var/lib/vps-sentry/garbage-running-cleanup.json";
const COMMAND_START_GRACE_MS = Number(process.env.VPS_GARBAGE_RECLAIM_START_GRACE_MS || 500);
const RUNNING_POLL_MS = Number(process.env.VPS_GARBAGE_RECLAIM_RUNNING_POLL_MS || 250);
const RUNNING_POLL_ATTEMPTS = Number(process.env.VPS_GARBAGE_RECLAIM_RUNNING_POLL_ATTEMPTS || 8);

type CommandAttempt = {
  command: string;
  args: string[];
  method: string;
};

type CommandResult = {
  ok: boolean;
  method: string | null;
  error: string | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

async function startCommandAttempt(attempt: CommandAttempt): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawn(attempt.command, attempt.args, {
        detached: true,
        stdio: "ignore",
      });

      child.once("error", (err) => {
        finish({
          ok: false,
          method: null,
          error: errorMessage(err),
        });
      });

      child.once("exit", (code, signal) => {
        if (settled) return;
        finish({
          ok: code === 0,
          method: code === 0 ? attempt.method : null,
          error:
            code === 0
              ? null
              : `cleanup process exited before start (${code ?? signal ?? "unknown"})`,
        });
      });

      setTimeout(() => {
        if (settled) return;
        child.unref();
        finish({
          ok: true,
          method: attempt.method,
          error: null,
        });
      }, Math.max(50, COMMAND_START_GRACE_MS));
    } catch (err: unknown) {
      finish({
        ok: false,
        method: null,
        error: errorMessage(err),
      });
    }
  });
}

async function runCommandAttempts(attempts: CommandAttempt[]): Promise<CommandResult> {
  let lastError = "command failed";

  for (const attempt of attempts) {
    const run = await startCommandAttempt(attempt);
    if (run.ok) {
      return run;
    }
    lastError = run.error || lastError;
  }

  return {
    ok: false,
    method: null,
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

async function cleanupIsRunning(): Promise<boolean> {
  try {
    await readFile(RUNNING_PATH, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function waitForRunningEstimate(): Promise<unknown | null> {
  for (let attempt = 0; attempt < Math.max(1, RUNNING_POLL_ATTEMPTS); attempt += 1) {
    const estimate = await readStatusGarbageEstimate();
    const estimateRecord = asRecord(estimate);
    if (estimateRecord?.running_cleanup === true) {
      return estimate;
    }
    if (await cleanupIsRunning()) {
      return estimate;
    }
    await delay(Math.max(50, RUNNING_POLL_MS));
  }
  return readStatusGarbageEstimate();
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
      const estimate = await waitForRunningEstimate();

      if (!command.ok) {
        const detail = command.error || "safe garbage reclaim failed to start";
        const hint = buildPrivilegeHint();
        incrementCounter("ops.garbage_reclaim.failed.total", 1, {});
        await writeAuditLog({
          req,
          userId: access.identity.userId,
          action: "ops.garbage_reclaim.failed",
          detail,
          meta: {
            method: command.method,
            hint,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: detail,
            hint,
            estimate,
          },
          { status: 409 }
        );
      }

      incrementCounter("ops.garbage_reclaim.ok.total", 1, {});
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: "ops.garbage_reclaim.started",
        detail: "Safe garbage cleanup started.",
        meta: {
          method: command.method,
        },
      });

      return NextResponse.json({
        ok: true,
        accepted: true,
        detail: "Cleanup started. The tile will refresh after the reclaim pass completes.",
        estimate,
      }, { status: 202 });
    }
  );
}
