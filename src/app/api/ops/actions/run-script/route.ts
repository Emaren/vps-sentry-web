import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { requireRoleAccess } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { incrementCounter, runObservedRoute } from "@/lib/observability";
import { SCRIPT_ACTIONS_BY_NAME } from "@/lib/actions/script-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const IS_BUILD_TIME =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

const BIN_DIR = process.env.VPS_ACTIONS_BIN_DIR || "/var/www/VPSSentry/bin";
const COMMAND_TIMEOUT_MS = Number(process.env.VPS_ACTIONS_TIMEOUT_MS || 120_000);
const MAX_BUFFER_BYTES = Number(process.env.VPS_ACTIONS_MAX_BUFFER_BYTES || 1_000_000);
const OUTPUT_MAX_CHARS = Number(process.env.VPS_ACTIONS_OUTPUT_MAX_CHARS || 12_000);
const SHELL_ONLY_SCRIPTS = new Set(["mbp-context", "mbp-context-tgz"]);

function truncateOutput(raw: string): string {
  if (raw.length <= OUTPUT_MAX_CHARS) return raw;
  return `${raw.slice(0, OUTPUT_MAX_CHARS)}\n...[truncated ${raw.length - OUTPUT_MAX_CHARS} chars]`;
}

function sanitizeOutput(raw: string): string {
  return raw
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(token=)[^\s&]+/gi, "$1[REDACTED]")
    .replace(/(password=)[^\s&]+/gi, "$1[REDACTED]")
    .replace(/(secret=)[^\s&]+/gi, "$1[REDACTED]");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(req: Request) {
  if (IS_BUILD_TIME) {
    return NextResponse.json({ ok: true, skipped: "build" });
  }

  return runObservedRoute(
    req,
    { route: "/api/ops/actions/run-script", source: "ops-actions-run-script" },
    async (obsCtx) => {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const script = typeof body.script === "string" ? body.script.trim() : "";

      if (!script) {
        return NextResponse.json({ ok: false, error: "script is required" }, { status: 400 });
      }

      const entry = SCRIPT_ACTIONS_BY_NAME.get(script);
      if (!entry) {
        return NextResponse.json({ ok: false, error: "script is not allowlisted" }, { status: 400 });
      }

      if (SHELL_ONLY_SCRIPTS.has(entry.script)) {
        return NextResponse.json(
          {
            ok: false,
            error: "script is shell-only (run on MBP terminal)",
            script: entry.script,
            hint: "~/projects/VPSSentry/bin/" + entry.script,
          },
          { status: 409 }
        );
      }

      const accessResult = await requireRoleAccess(entry.requiredRole);
      if (!accessResult.ok) {
        incrementCounter("ops.actions.run_script.denied.total", 1, {
          status: String(accessResult.status),
          script: entry.script,
        });
        await writeAuditLog({
          req,
          action: "ops.actions.run_script.denied",
          detail: `status=${accessResult.status} script=${entry.script} requiredRole=${entry.requiredRole}`,
          meta: {
            route: "/api/ops/actions/run-script",
            status: accessResult.status,
            script: entry.script,
            requiredRole: entry.requiredRole,
            email: accessResult.email ?? null,
            role: accessResult.role ?? null,
          },
        });
        return NextResponse.json({ ok: false, error: accessResult.error }, { status: accessResult.status });
      }

      obsCtx.userId = accessResult.identity.userId;

      const scriptPath = `${BIN_DIR}/${entry.script}`;
      try {
        await access(scriptPath);
      } catch {
        return NextResponse.json(
          { ok: false, error: "script not found on server", script: entry.script, scriptPath },
          { status: 404 }
        );
      }

      const started = Date.now();
      try {
        const isContextScript =
          entry.script.includes("context") ||
          entry.script === "full-context-all" ||
          entry.script === "full-context" ||
          entry.script === "full-context-tgz" ||
          entry.script === "vps-pull-context";

        const run = await execFileAsync(scriptPath, [], {
          cwd: "/var/www/VPSSentry",
          env: {
            ...process.env,
            // Keep non-context actions local. For context actions, allow VPS->MBP mirror.
            SEND_TO_MBP: isContextScript ? "1" : "0",
            PRUNE_REMOTE_MBP: isContextScript ? "1" : "0",
          },
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
        });

        const stdout = sanitizeOutput(truncateOutput(run.stdout ?? ""));
        const stderr = sanitizeOutput(truncateOutput(run.stderr ?? ""));
        const durationMs = Date.now() - started;

        incrementCounter("ops.actions.run_script.ok.total", 1, { script: entry.script });
        await writeAuditLog({
          req,
          userId: accessResult.identity.userId,
          action: "ops.actions.run_script.ok",
          detail: `script=${entry.script} durationMs=${durationMs}`,
          meta: {
            route: "/api/ops/actions/run-script",
            script: entry.script,
            durationMs,
            role: accessResult.identity.role,
          },
        });

        return NextResponse.json({
          ok: true,
          script: entry.script,
          title: entry.title,
          durationMs,
          stdout,
          stderr,
        });
      } catch (error: unknown) {
        const e = error as { code?: number | string; stdout?: string; stderr?: string };
        const stdout = sanitizeOutput(truncateOutput(String(e.stdout ?? "")));
        const stderr = sanitizeOutput(truncateOutput(String(e.stderr ?? errorMessage(error))));
        const durationMs = Date.now() - started;
        const exitCode = typeof e.code === "number" ? e.code : 1;

        incrementCounter("ops.actions.run_script.failed.total", 1, { script: entry.script });
        await writeAuditLog({
          req,
          userId: accessResult.identity.userId,
          action: "ops.actions.run_script.failed",
          detail: `script=${entry.script} exitCode=${exitCode} durationMs=${durationMs}`,
          meta: {
            route: "/api/ops/actions/run-script",
            script: entry.script,
            exitCode,
            durationMs,
            role: accessResult.identity.role,
          },
        });

        return NextResponse.json(
          {
            ok: false,
            script: entry.script,
            title: entry.title,
            exitCode,
            durationMs,
            stdout,
            stderr,
          },
          { status: 409 }
        );
      }
    }
  );
}
