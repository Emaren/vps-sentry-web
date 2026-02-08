#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const envFromFile = readSimpleEnv(path.join(rootDir, ".vps.env"));

const options = parseArgs(process.argv.slice(2));
const strict = options.flags.has("strict");
const fast = options.flags.has("fast");
const skipSupply = options.flags.has("skip-supply-chain");
const skipChaos = options.flags.has("skip-chaos");
const skipReleaseGate = options.flags.has("skip-release-gate");
const skipSecurity = options.flags.has("skip-security");
const skipPerf = options.flags.has("skip-perf");
const skipSlo = options.flags.has("skip-slo");
const skipRpoRto = options.flags.has("skip-rpo-rto");
const skipRecoveryDrill = options.flags.has("skip-recovery-drill");
const skipSshGuard = options.flags.has("skip-ssh-guard");
const chaosLocal = options.flags.has("chaos-local");

const minPassPct = Number(
  options.values["min-pass-percent"] ??
    envFromFile.VPS_SCORECARD_MIN_PASS_PERCENT ??
    process.env.VPS_SCORECARD_MIN_PASS_PERCENT ??
    "85",
);
const checkTimeoutSeconds = Number(
  options.values["check-timeout-seconds"] ??
    envFromFile.VPS_SCORECARD_CHECK_TIMEOUT_SECONDS ??
    process.env.VPS_SCORECARD_CHECK_TIMEOUT_SECONDS ??
    "240",
);
const sshFailureRetryAttempts = Number(
  options.values["ssh-failure-retries"] ??
    envFromFile.VPS_SCORECARD_SSH_FAILURE_RETRIES ??
    process.env.VPS_SCORECARD_SSH_FAILURE_RETRIES ??
    "2",
);
const sshFailureRetryDelaySeconds = Number(
  options.values["ssh-failure-retry-delay-seconds"] ??
    envFromFile.VPS_SCORECARD_SSH_FAILURE_RETRY_DELAY_SECONDS ??
    process.env.VPS_SCORECARD_SSH_FAILURE_RETRY_DELAY_SECONDS ??
    "8",
);
const commandShell = options.values.shell ?? process.env.SHELL ?? "/bin/bash";

if (!Number.isFinite(checkTimeoutSeconds) || checkTimeoutSeconds <= 0) {
  console.error("[scorecard] check timeout must be a positive number of seconds");
  process.exit(2);
}
if (!Number.isFinite(sshFailureRetryAttempts) || sshFailureRetryAttempts < 1) {
  console.error("[scorecard] ssh failure retries must be >= 1");
  process.exit(2);
}
if (!Number.isFinite(sshFailureRetryDelaySeconds) || sshFailureRetryDelaySeconds < 0) {
  console.error("[scorecard] ssh failure retry delay must be >= 0 seconds");
  process.exit(2);
}

const artifactDir = path.resolve(
  rootDir,
  options.values["artifact-dir"] ??
    envFromFile.VPS_SCORECARD_ARTIFACT_DIR ??
    process.env.VPS_SCORECARD_ARTIFACT_DIR ??
    ".artifacts/sentinel-prime",
);
const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const runDir = path.join(artifactDir, runId);

fs.mkdirSync(runDir, { recursive: true });

const baseEnv = {
  ...process.env,
  ...envFromFile,
};

const checks = [];

if (!skipSupply) {
  checks.push({
    id: "supply_chain",
    label: "Supply-chain security",
    weight: 18,
    required: true,
    cmd: "./scripts/supply-chain-check.sh --no-lock-verify",
    retryOnSshRefusal: false,
  });
}

if (!skipReleaseGate) {
  checks.push({
    id: "release_gate",
    label: "Release gate",
    weight: 24,
    required: true,
    cmd: "./scripts/release-gate.sh",
    retryOnSshRefusal: true,
  });
}

if (!skipSecurity) {
  checks.push({
    id: "security_headers",
    label: "Security headers",
    weight: 10,
    required: false,
    cmd: "./scripts/security-headers-check.sh --remote",
    retryOnSshRefusal: true,
  });
}

if (!skipPerf && !fast) {
  checks.push({
    id: "perf_smoke",
    label: "Load smoke",
    weight: 10,
    required: false,
    cmd: "./scripts/perf-load-smoke.sh --remote --requests 120 --concurrency 20 --expect 200",
    retryOnSshRefusal: true,
  });
}

if (!skipChaos) {
  const chaosCmdBase = chaosLocal ? "./scripts/chaos-certify.sh --local" : "./scripts/chaos-certify.sh --remote";
  const chaosCmd = fast ? `${chaosCmdBase} --skip-restart --skip-perf` : chaosCmdBase;
  checks.push({
    id: "chaos_cert",
    label: "Chaos certification",
    weight: 18,
    required: true,
    cmd: chaosCmd,
    retryOnSshRefusal: true,
  });
}

if (!skipSlo) {
  checks.push({
    id: "slo_burn",
    label: "SLO burn-rate",
    weight: 10,
    required: false,
    cmd: "./scripts/vps-slo-burn-rate.sh --no-alert --soft",
    retryOnSshRefusal: true,
  });
}

if (!skipRpoRto) {
  if (!skipRecoveryDrill) {
    checks.push({
      id: "recovery_drill",
      label: "Backup + restore drill",
      weight: 8,
      required: false,
      cmd: "./scripts/vps-backup.sh --label scorecard && ./scripts/vps-restore-drill.sh",
      retryOnSshRefusal: true,
    });
  }
  checks.push({
    id: "rpo_rto",
    label: "Recovery objectives",
    weight: 10,
    required: false,
    cmd: "./scripts/vps-rpo-rto-report.sh --soft",
    retryOnSshRefusal: true,
  });
}

if (!skipSshGuard) {
  checks.push({
    id: "ssh_guardrail",
    label: "SSH stability guardrail",
    weight: 6,
    required: false,
    cmd: "./scripts/vps.sh ssh-stability-check",
    retryOnSshRefusal: false,
  });
}

const results = checks.map((check) => runCheck(
  {
    timeoutSeconds: check.timeoutSeconds ?? checkTimeoutSeconds,
    sshFailureRetryAttempts: check.retryOnSshRefusal ? sshFailureRetryAttempts : 1,
    sshFailureRetryDelaySeconds,
    ...check,
  },
  runDir,
  baseEnv,
  rootDir,
));

const normalizedResults = results.map((result) => {
  if (result.status === "FAIL" && result.sshTransientFailure && !result.required) {
    return {
      ...result,
      status: "SKIP",
      skipReason: "ssh_unreachable",
    };
  }
  return result;
});

const scoredResults = normalizedResults.filter((r) => r.status !== "SKIP");
const possibleWeight = sum(scoredResults.map((r) => r.weight));
const earnedWeight = sum(scoredResults.filter((r) => r.status === "PASS").map((r) => r.weight));
const scorePercent = possibleWeight > 0 ? Number(((earnedWeight / possibleWeight) * 100).toFixed(1)) : 0;
const requiredFailures = normalizedResults.filter((r) => r.required && r.status !== "PASS");
const skippedChecks = normalizedResults.filter((item) => item.status === "SKIP");
const overallPass = requiredFailures.length === 0 && scorePercent >= minPassPct;
const verificationState = skippedChecks.length > 0 ? "PARTIAL" : "FULL";
const rating = ratingFromScore(scorePercent, overallPass, skippedChecks.length);

const scorecard = {
  generatedAt: new Date().toISOString(),
  runId,
  strict,
  fast,
  commandShell,
  minPassPercent: minPassPct,
  scorePercent,
  earnedWeight,
  possibleWeight,
  overall: overallPass ? "PASS" : "FAIL",
  verificationState,
  rating,
  requiredFailures: requiredFailures.map((item) => ({
    id: item.id,
    label: item.label,
    exitCode: item.exitCode,
  })),
  checks: normalizedResults,
  skippedChecks: skippedChecks.map((item) => ({
      id: item.id,
      label: item.label,
      reason: item.skipReason ?? "not_scored",
    })),
  artifacts: {
    directory: runDir,
    logs: normalizedResults.map((item) => ({ id: item.id, log: item.logPath })),
  },
};

const jsonPath = path.join(runDir, "scorecard.json");
const mdPath = path.join(runDir, "scorecard.md");
const latestJsonPath = path.join(artifactDir, "latest.json");
const latestMdPath = path.join(artifactDir, "latest.md");

fs.writeFileSync(jsonPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
fs.writeFileSync(mdPath, renderMarkdown(scorecard), "utf8");
fs.writeFileSync(latestJsonPath, `${JSON.stringify(scorecard, null, 2)}\n`, "utf8");
fs.writeFileSync(latestMdPath, renderMarkdown(scorecard), "utf8");

console.log(`[scorecard] run_id:${runId}`);
console.log(`[scorecard] shell:${commandShell}`);
console.log(`[scorecard] score:${scorePercent}% (earned ${earnedWeight}/${possibleWeight})`);
console.log(`[scorecard] threshold:${minPassPct}% overall=${scorecard.overall}`);
console.log(`[scorecard] verification:${verificationState}`);
console.log(`[scorecard] rating:${rating}`);
console.log(`[scorecard] json:${jsonPath}`);
console.log(`[scorecard] markdown:${mdPath}`);

for (const result of normalizedResults) {
  console.log(
    `[scorecard] check:${result.id} status=${result.status} required=${result.required ? "yes" : "no"} duration=${result.durationSeconds}s timeout=${result.timeoutSeconds}s`,
  );
}

if (strict && !overallPass) {
  process.exit(42);
}

function runCheck(check, runDirPath, env, cwd) {
  const maxAttempts = Math.max(1, Number(check.sshFailureRetryAttempts || 1));
  const retryDelaySeconds = Math.max(0, Number(check.sshFailureRetryDelaySeconds || 0));
  const startedAt = Date.now();
  const attempts = [];
  let finalTimedOut = false;
  let finalExitCode = -1;
  let finalCombinedOutput = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const out = spawnSync(commandShell, ["-lc", check.cmd], {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: Math.round(check.timeoutSeconds * 1000),
    });
    const timedOut = Boolean(out.error && out.error.code === "ETIMEDOUT");
    const exitCode = timedOut ? 124 : (typeof out.status === "number" ? out.status : -1);
    const combinedOutput = `${out.stdout || ""}${out.stderr || ""}`;

    attempts.push({
      attempt,
      exitCode,
      timedOut,
      output: combinedOutput,
    });

    finalTimedOut = timedOut;
    finalExitCode = exitCode;
    finalCombinedOutput = combinedOutput;

    if (exitCode === 0) break;

    const canRetry = attempt < maxAttempts && isLikelySshTransientFailure(combinedOutput);
    if (!canRetry) break;

    console.log(
      `[scorecard] check:${check.id} transient_ssh_failure attempt=${attempt}/${maxAttempts} retry_in=${retryDelaySeconds}s`,
    );
    if (retryDelaySeconds > 0) {
      spawnSync(commandShell, ["-lc", `sleep ${retryDelaySeconds}`], {
        cwd,
        env,
        encoding: "utf8",
      });
  }
}

  const endedAt = Date.now();
  const durationSeconds = Number(((endedAt - startedAt) / 1000).toFixed(2));
  const status = finalExitCode === 0 ? "PASS" : "FAIL";
  const sshTransientFailure = status === "FAIL" && isLikelySshTransientFailure(finalCombinedOutput);

  const excerptBase = finalCombinedOutput
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-8)
    .join("\n");
  const excerpt = finalTimedOut
    ? `${excerptBase}\n[scorecard] check timed out after ${check.timeoutSeconds}s`
    : excerptBase;
  const logPath = path.join(runDirPath, `${check.id}.log`);
  const attemptLog =
    attempts.length <= 1
      ? `${finalCombinedOutput}\n`
      : `${attempts
          .map((entry) => {
            const header = `[attempt ${entry.attempt}/${maxAttempts}] exit=${entry.exitCode} timedOut=${
              entry.timedOut ? "yes" : "no"
            }`;
            return `${header}\n${entry.output}`;
          })
          .join("\n\n")}\n`;
  fs.writeFileSync(logPath, attemptLog, "utf8");
  return {
    id: check.id,
    label: check.label,
    cmd: check.cmd,
    weight: check.weight,
    required: check.required,
    status,
    exitCode: finalExitCode,
    timedOut: finalTimedOut,
    timeoutSeconds: check.timeoutSeconds,
    durationSeconds,
    logPath,
    outputExcerpt: excerpt,
    attempts: attempts.length,
    sshTransientFailure,
  };
}

function sum(values) {
  return values.reduce((acc, value) => acc + Number(value || 0), 0);
}

function ratingFromScore(score, pass, skippedCount = 0) {
  if (pass && skippedCount > 0) {
    if (score >= 95) return "v3.8 Core-Ready (partial verification)";
    if (score >= 85) return "v3.6 Core-Pass (partial verification)";
  }
  if (score >= 95 && pass) return "v4.0 Sentinel Prime Ready";
  if (score >= 90 && pass) return "v3.9 Near-Sentinel";
  if (score >= 85 && pass) return "v3.7 Operator-Grade+";
  if (score >= 70) return "v3.x Hardening In Progress";
  return "v2.x Buildout";
}

function renderMarkdown(scorecardData) {
  const lines = [];
  lines.push("# Sentinel Prime Readiness Scorecard");
  lines.push("");
  lines.push(`- Generated: ${scorecardData.generatedAt}`);
  lines.push(`- Run ID: ${scorecardData.runId}`);
  lines.push(`- Overall: **${scorecardData.overall}**`);
  lines.push(`- Score: **${scorecardData.scorePercent}%** (earned ${scorecardData.earnedWeight}/${scorecardData.possibleWeight})`);
  lines.push(`- Threshold: ${scorecardData.minPassPercent}%`);
  lines.push(`- Rating: ${scorecardData.rating}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push("| Check | Weight | Required | Status | Duration (s) | Timeout (s) |");
  lines.push("| --- | ---: | :---: | :---: | ---: | ---: |");
  for (const item of scorecardData.checks) {
    lines.push(`| ${item.label} | ${item.weight} | ${item.required ? "Yes" : "No"} | ${item.status} | ${item.durationSeconds} | ${item.timeoutSeconds} |`);
  }
  lines.push("");
  if (Array.isArray(scorecardData.skippedChecks) && scorecardData.skippedChecks.length > 0) {
    lines.push("## Skipped Checks");
    lines.push("");
    for (const skipped of scorecardData.skippedChecks) {
      lines.push(`- ${skipped.label} (${skipped.id}) reason=${skipped.reason}`);
    }
    lines.push("");
  }
  if (scorecardData.requiredFailures.length > 0) {
    lines.push("## Required Failures");
    lines.push("");
    for (const failure of scorecardData.requiredFailures) {
      lines.push(`- ${failure.label} (${failure.id}) exit=${failure.exitCode}`);
    }
    lines.push("");
  }
  lines.push("## Logs");
  lines.push("");
  for (const item of scorecardData.checks) {
    lines.push(`- ${item.id}: \`${item.logPath}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    values[key] = next;
    i += 1;
  }
  return { flags, values };
}

function isLikelySshTransientFailure(output) {
  const text = String(output || "");
  if (!text) return false;
  return /ssh_unreachable|ssh_retry|ssh: connect to host .* port 22: (connection refused|connection timed out|no route to host)|kex_exchange_identification|connection closed by remote host/i.test(
    text,
  );
}

function readSimpleEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
