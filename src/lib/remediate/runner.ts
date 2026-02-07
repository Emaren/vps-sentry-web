import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCallback);

export type RemediationCommandResult = {
  command: string;
  normalizedCommand: string | null;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipped: boolean;
};

export type RemediationExecution = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  results: RemediationCommandResult[];
};

function normalizeCommand(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (trimmed.startsWith("sudo ")) return `sudo -n ${trimmed.slice(5)}`;
  return trimmed;
}

function truncate(text: string, max = 8000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

export async function executeRemediationCommands(
  commands: string[],
  opts?: { timeoutMs?: number; maxBufferBytes?: number }
): Promise<RemediationExecution> {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  const maxBufferBytes = opts?.maxBufferBytes ?? 512_000;

  const startedAt = new Date().toISOString();
  const results: RemediationCommandResult[] = [];
  let ok = true;

  for (const raw of commands) {
    const normalized = normalizeCommand(raw);
    if (!normalized) {
      results.push({
        command: raw,
        normalizedCommand: null,
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 0,
        skipped: true,
      });
      continue;
    }

    const start = Date.now();
    try {
      const out = await exec(normalized, {
        timeout: timeoutMs,
        maxBuffer: maxBufferBytes,
        shell: "/bin/bash",
      });

      results.push({
        command: raw,
        normalizedCommand: normalized,
        ok: true,
        exitCode: 0,
        stdout: truncate(out.stdout ?? ""),
        stderr: truncate(out.stderr ?? ""),
        durationMs: Date.now() - start,
        skipped: false,
      });
    } catch (err: unknown) {
      const e = err as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      const exitCode = typeof e.code === "number" ? e.code : 1;
      results.push({
        command: raw,
        normalizedCommand: normalized,
        ok: false,
        exitCode,
        stdout: truncate(String(e.stdout ?? "")),
        stderr: truncate(String(e.stderr ?? String(err))),
        durationMs: Date.now() - start,
        skipped: false,
      });
      ok = false;
      break;
    }
  }

  return {
    ok,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}

export function formatExecutionForLog(execution: RemediationExecution): string {
  const header = [
    `ok=${execution.ok}`,
    `startedAt=${execution.startedAt}`,
    `finishedAt=${execution.finishedAt}`,
    `commands=${execution.results.length}`,
  ].join(" ");

  const lines = [header];
  execution.results.forEach((r, idx) => {
    lines.push(`\n#${idx + 1} ${r.ok ? "ok" : "failed"} exit=${r.exitCode} durationMs=${r.durationMs}`);
    lines.push(`command: ${r.command}`);
    if (r.skipped) {
      lines.push("skipped: true");
      return;
    }
    if (r.stdout) lines.push(`stdout:\n${r.stdout}`);
    if (r.stderr) lines.push(`stderr:\n${r.stderr}`);
  });
  return lines.join("\n");
}

