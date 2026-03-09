import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import type { AppRole } from "@/lib/rbac-policy";
import {
  DEFAULT_COUNTERSTRIKE_PLAYBOOK,
  getCounterstrikePlaybook,
  normalizeCounterstrikeMode,
} from "@/lib/ops/counterstrike-playbooks";
import { readCounterstrikeStatus } from "@/lib/ops/counterstrike-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMAND = "/usr/local/bin/vps-sentry-counterstrike";
const START_GRACE_MS = Number(process.env.VPS_COUNTERSTRIKE_START_GRACE_MS || 500);
const RUNNING_POLL_MS = Number(process.env.VPS_COUNTERSTRIKE_RUNNING_POLL_MS || 250);
const RUNNING_POLL_ATTEMPTS = Number(process.env.VPS_COUNTERSTRIKE_RUNNING_POLL_ATTEMPTS || 8);

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
              : `counterstrike process exited before start (${code ?? signal ?? "unknown"})`,
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
      }, Math.max(50, START_GRACE_MS));
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
    if (run.ok) return run;
    lastError = run.error || lastError;
  }

  return {
    ok: false,
    method: null,
    error: lastError,
  };
}

async function waitForRunningState(role: AppRole | null | undefined) {
  for (let attempt = 0; attempt < Math.max(1, RUNNING_POLL_ATTEMPTS); attempt += 1) {
    const snapshot = await readCounterstrikeStatus({ role });
    if (snapshot.running) return snapshot;
    await delay(Math.max(50, RUNNING_POLL_MS));
  }
  return readCounterstrikeStatus({ role });
}

function buildPrivilegeHint(): string {
  return [
    "Grant non-interactive sudo for the web service user so the dashboard can run Counterstrike.",
    "Example /etc/sudoers.d/90-vps-sentry-counterstrike:",
    "tony ALL=(root) NOPASSWD: /usr/local/bin/vps-sentry-counterstrike",
  ].join(" ");
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/counterstrike/run", source: "ops-counterstrike-run" },
    async () => {
      const accessResult = await requireOpsAccess();
      if (!accessResult.ok) {
        return NextResponse.json({ ok: false, error: accessResult.error }, { status: accessResult.status });
      }

      try {
        await access(COMMAND);
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: "Counterstrike runner is not installed on this host yet.",
            command: COMMAND,
          },
          { status: 404 }
        );
      }

      const existing = await readCounterstrikeStatus({ role: accessResult.identity.role });
      if (existing.running) {
        return NextResponse.json(
          {
            ok: false,
            error: "Counterstrike is already running.",
            running: existing.running,
          },
          { status: 409 }
        );
      }

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const playbook = getCounterstrikePlaybook(typeof body.playbook === "string" ? body.playbook : "") ?? DEFAULT_COUNTERSTRIKE_PLAYBOOK;
      const mode = normalizeCounterstrikeMode(body.mode);

      const attempts: CommandAttempt[] = [
        {
          command: "sudo",
          args: ["-n", COMMAND, "--playbook", playbook.id, "--mode", mode],
          method: `sudo -n ${COMMAND} --playbook ${playbook.id} --mode ${mode}`,
        },
        {
          command: COMMAND,
          args: ["--playbook", playbook.id, "--mode", mode],
          method: `${COMMAND} --playbook ${playbook.id} --mode ${mode}`,
        },
      ];

      const command = await runCommandAttempts(attempts);
      if (!command.ok) {
        const detail = command.error || "counterstrike failed to start";
        const hint = buildPrivilegeHint();
        incrementCounter("ops.counterstrike.run.failed.total", 1, {});
        await writeAuditLog({
          req,
          userId: accessResult.identity.userId,
          action: "ops.counterstrike.run.failed",
          detail,
          meta: {
            playbook: playbook.id,
            mode,
            method: command.method,
            hint,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: detail,
            hint,
          },
          { status: 409 }
        );
      }

      const snapshot = await waitForRunningState(accessResult.identity.role);

      incrementCounter("ops.counterstrike.run.ok.total", 1, {
        playbook: playbook.id,
        mode,
      });
      await writeAuditLog({
        req,
        userId: accessResult.identity.userId,
        action: "ops.counterstrike.run.started",
        detail: `${playbook.label} started in ${mode} mode.`,
        meta: {
          playbook: playbook.id,
          playbookLabel: playbook.label,
          mode,
          method: command.method,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          accepted: true,
          detail: `${playbook.label} started in ${mode} mode.`,
          playbook,
          mode,
          snapshot,
        },
        { status: 202 }
      );
    }
  );
}
