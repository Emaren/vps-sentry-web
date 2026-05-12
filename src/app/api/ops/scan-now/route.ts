import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireOpsAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_PATH = "/var/lib/vps-sentry/public/status.json";
const TRIGGER_PATH = "/tmp/vps-sentry-scan-now.json";
const SENTRY_SERVICE = "vps-sentry.service";
const SCAN_COMMAND_TIMEOUT_MS = Number(process.env.VPS_SCAN_NOW_COMMAND_TIMEOUT_MS || 10_000);
const SCAN_POLL_MAX_MS = Number(process.env.VPS_SCAN_NOW_POLL_MAX_MS || 20_000);
const SCAN_POLL_STEP_MS = Number(process.env.VPS_SCAN_NOW_POLL_STEP_MS || 400);

const execFileAsync = promisify(execFile);

type StatusJson = {
  ts?: string | null;
  [key: string]: unknown;
};

type ScanKickoffResult = {
  attempted: boolean;
  started: boolean;
  method: string | null;
  error?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readStatus(): Promise<StatusJson | null> {
  try {
    return JSON.parse(await readFile(STATUS_PATH, "utf8")) as StatusJson;
  } catch {
    return null;
  }
}

async function runScanCommand(command: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync(command, args, {
      timeout: SCAN_COMMAND_TIMEOUT_MS,
      maxBuffer: 256_000,
    });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }
}

async function triggerImmediateScan(): Promise<ScanKickoffResult> {
  const attempts: Array<{ command: string; args: string[]; method: string }> = [
    {
      command: "sudo",
      args: ["-n", "/usr/bin/systemctl", "start", SENTRY_SERVICE],
      method: "sudo -n /usr/bin/systemctl start vps-sentry.service",
    },
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
      command: "/usr/bin/systemctl",
      args: ["start", SENTRY_SERVICE],
      method: "/usr/bin/systemctl start vps-sentry.service",
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

  let attempted = false;
  let lastError: string | undefined;

  for (const attempt of attempts) {
    attempted = true;
    const run = await runScanCommand(attempt.command, attempt.args);
    if (run.ok) {
      return {
        attempted,
        started: true,
        method: attempt.method,
      };
    }
    lastError = run.error;
  }

  return {
    attempted,
    started: false,
    method: null,
    error: lastError ?? "Unable to start scan command.",
  };
}

export async function POST(req: Request) {
  return runObservedRoute(
    req,
    { route: "/api/ops/scan-now", source: "ops-scan-now" },
    async () => {
      const access = await requireOpsAccess();
      if (!access.ok) {
        return NextResponse.json({ ok: false, error: access.error }, { status: access.status });
      }

      const before = await readStatus();
      const beforeTs = before?.ts ?? null;

      await writeFile(
        TRIGGER_PATH,
        JSON.stringify(
          {
            ts: new Date().toISOString(),
            requestedBy: access.identity.email,
            reason: "manual-scan",
          },
          null,
          2
        ),
        "utf8"
      );

      const scan = await triggerImmediateScan();

      let after: StatusJson | null = null;
      const startedAt = Date.now();
      while (Date.now() - startedAt < SCAN_POLL_MAX_MS) {
        await sleep(SCAN_POLL_STEP_MS);
        after = await readStatus();
        if (after?.ts && after.ts !== beforeTs) break;
      }

      const statusTs = after?.ts ?? beforeTs ?? null;
      const statusAdvanced = Boolean(statusTs && statusTs !== beforeTs);

      incrementCounter(scan.started ? "ops.scan_now.ok.total" : "ops.scan_now.not_started.total", 1, {});
      await writeAuditLog({
        req,
        userId: access.identity.userId,
        action: scan.started ? "ops.scan_now.started" : "ops.scan_now.not_started",
        detail: scan.started ? "Immediate VPS scan started." : "Immediate VPS scan could not be confirmed.",
        meta: {
          method: scan.method,
          error: scan.error ?? null,
          beforeTs,
          statusTs,
          statusAdvanced,
          triggerPath: TRIGGER_PATH,
        },
      });

      return NextResponse.json(
        {
          ok: scan.started,
          triggered: true,
          scan,
          statusTs,
          statusAdvanced,
          error: scan.started ? undefined : scan.error,
        },
        { status: scan.started ? 202 : 409 }
      );
    }
  );
}
