#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://127.0.0.1:3035";

function parseArg(name, fallback = "") {
  const eqPrefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === `--${name}`) return process.argv[i + 1] ?? fallback;
    if (arg.startsWith(eqPrefix)) return arg.slice(eqPrefix.length);
  }
  return fallback;
}

function hasFlag(name) {
  const short = `--${name}`;
  return process.argv.includes(short) || process.argv.some((a) => a.startsWith(`${short}=`));
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const t = Math.trunc(n);
  if (t < min) return min;
  if (t > max) return max;
  return t;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseBool(value, fallback = false) {
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function isLoopbackBaseUrl(value) {
  try {
    const url = new URL(value);
    const host = String(url.hostname || "").trim().toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

const once = hasFlag("once");
const baseUrl = (parseArg("base-url", process.env.OPS_WORKER_BASE_URL || DEFAULT_BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, "");
const token = (
  parseArg("token", process.env.OPS_WORKER_TOKEN || process.env.VPS_REMEDIATE_QUEUE_TOKEN || "")
).trim();
const allowLoopbackWithoutToken = parseBool(process.env.OPS_WORKER_ALLOW_LOOPBACK_NO_TOKEN ?? "1", true);
const limit = clampInt(parseArg("limit", process.env.OPS_WORKER_DRAIN_LIMIT || "5"), 1, 50, 5);
const intervalSeconds = clampInt(
  parseArg("interval", process.env.OPS_WORKER_INTERVAL_SECONDS || "15"),
  1,
  600,
  15
);
const idleIntervalSeconds = clampInt(
  parseArg("idle-interval", process.env.OPS_WORKER_IDLE_INTERVAL_SECONDS || String(Math.max(20, intervalSeconds * 2))),
  1,
  600,
  Math.max(20, intervalSeconds * 2)
);
const maxBackoffSeconds = clampInt(
  parseArg("max-backoff", process.env.OPS_WORKER_MAX_BACKOFF_SECONDS || "120"),
  intervalSeconds,
  3600,
  120
);

const tokenRequired = !(allowLoopbackWithoutToken && isLoopbackBaseUrl(baseUrl));
if (!token && tokenRequired) {
  console.error(`[ops-worker] ${nowIso()} missing token: set OPS_WORKER_TOKEN or VPS_REMEDIATE_QUEUE_TOKEN`);
  process.exit(1);
}

async function drainOnce() {
  const url = `${baseUrl}/api/ops/remediate-drain`;
  const headers = {
    "content-type": "application/json",
  };
  if (token) {
    headers["x-remediate-queue-token"] = token;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ limit }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(`drain failed: ${msg}`);
  }

  const drained = data?.drained || {};
  const processed = clampInt(drained.processed ?? 0, 0, 10_000, 0);
  const requestedLimit = clampInt(drained.requestedLimit ?? limit, 1, 50, limit);
  const ok = Boolean(drained.ok);
  console.log(
    `[ops-worker] ${nowIso()} processed=${processed} requestedLimit=${requestedLimit} ok=${ok}`
  );
  return {
    processed,
    requestedLimit,
    ok,
  };
}

async function main() {
  console.log(
    `[ops-worker] ${nowIso()} start once=${once} baseUrl=${baseUrl} auth=${token ? "token" : "loopback"} limit=${limit} interval=${intervalSeconds}s idleInterval=${idleIntervalSeconds}s`
  );

  let failureBackoffSeconds = intervalSeconds;
  for (;;) {
    try {
      const out = await drainOnce();
      failureBackoffSeconds = intervalSeconds;
      if (once) return;
      const nextSleepSeconds = out.processed > 0 ? intervalSeconds : idleIntervalSeconds;
      await sleep(nextSleepSeconds * 1000);
    } catch (err) {
      console.error(`[ops-worker] ${nowIso()} error=${String(err)}`);
      if (once) process.exit(1);
      await sleep(failureBackoffSeconds * 1000);
      failureBackoffSeconds = Math.min(maxBackoffSeconds, failureBackoffSeconds * 2);
    }
  }
}

void main();
