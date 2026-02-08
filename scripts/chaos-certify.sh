#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_WEB_PORT="${VPS_WEB_PORT:-3035}"
VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

VPS_CHAOS_MAX_RECOVERY_SECONDS="${VPS_CHAOS_MAX_RECOVERY_SECONDS:-120}"
VPS_CHAOS_POLL_INTERVAL_SECONDS="${VPS_CHAOS_POLL_INTERVAL_SECONDS:-2}"
VPS_CHAOS_PERF_REQUESTS="${VPS_CHAOS_PERF_REQUESTS:-120}"
VPS_CHAOS_PERF_CONCURRENCY="${VPS_CHAOS_PERF_CONCURRENCY:-20}"
VPS_CHAOS_REQUIRE_PERF_PASS="${VPS_CHAOS_REQUIRE_PERF_PASS:-1}"
VPS_CHAOS_ARTIFACT_DIR="${VPS_CHAOS_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/chaos}"
VPS_CHAOS_RECOVERY_PATH="${VPS_CHAOS_RECOVERY_PATH:-/api/status}"

remote_mode=1
skip_restart=0
skip_perf=0
output_path=""

usage() {
  cat <<'USAGE'
Usage: ./scripts/chaos-certify.sh [options]

Step 20 chaos certification:
- baseline smoke
- controlled service restart
- recovery-time measurement
- post-restart perf/load smoke

Options:
  --remote                 Run against VPS over SSH (default).
  --local                  Run local checks (restart step auto-skipped unless --skip-restart).
  --skip-restart           Skip service restart drill.
  --skip-perf              Skip post-restart perf/load smoke.
  --max-recovery-seconds N Override recovery time target.
  --poll-interval-seconds N Override poll interval.
  --output PATH            Write JSON artifact to exact file path.
  -h, --help               Show this help.
USAGE
}

trim() {
  local value="$1"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
}

read_bool() {
  local raw="$1"
  local fallback="$2"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$(trim "$normalized")" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    *) printf '%s' "$fallback" ;;
  esac
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[chaos] $name must be a positive integer: $value"
    exit 1
  fi
}

remote() {
  local attempt=1
  local max_attempts="$VPS_SSH_RETRIES"
  local retry_delay="$VPS_SSH_RETRY_DELAY_SECONDS"
  local exit_code=0

  while true; do
    if ssh \
      -o BatchMode=yes \
      -o LogLevel=ERROR \
      -o ConnectTimeout="$VPS_SSH_CONNECT_TIMEOUT" \
      -o ConnectionAttempts="$VPS_SSH_CONNECTION_ATTEMPTS" \
      -o ServerAliveInterval="$VPS_SSH_SERVER_ALIVE_INTERVAL" \
      -o ServerAliveCountMax="$VPS_SSH_SERVER_ALIVE_COUNT_MAX" \
      "$VPS_HOST" "$@"; then
      return 0
    else
      exit_code=$?
    fi

    if [[ "$exit_code" -ne 255 || "$attempt" -ge "$max_attempts" ]]; then
      return "$exit_code"
    fi

    echo "[chaos] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

run_check_capture() {
  local name="$1"
  shift
  local out_file="$VPS_CHAOS_ARTIFACT_DIR/${name}.log"
  set +e
  "$@" >"$out_file" 2>&1
  local exit_code=$?
  set -e
  printf '%s' "$exit_code"
}

status_code() {
  local endpoint="http://127.0.0.1:${VPS_WEB_PORT}${VPS_CHAOS_RECOVERY_PATH}"
  if [[ "$remote_mode" -eq 1 ]]; then
    remote "curl -s -o /dev/null -w '%{http_code}' $(printf %q "$endpoint")"
    return $?
  fi
  curl -s -o /dev/null -w '%{http_code}' "$endpoint"
}

local_smoke() {
  local root_code login_code status
  root_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/")"
  login_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/login")"
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/api/status")"
  echo "[chaos] / => $root_code"
  echo "[chaos] /login => $login_code"
  echo "[chaos] /api/status => $status"
  if [[ "$root_code" != "200" && "$root_code" != "307" ]]; then
    return 1
  fi
  if [[ "$login_code" != "200" || "$status" != "200" ]]; then
    return 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      remote_mode=1
      shift
      ;;
    --local)
      remote_mode=0
      shift
      ;;
    --skip-restart)
      skip_restart=1
      shift
      ;;
    --skip-perf)
      skip_perf=1
      shift
      ;;
    --max-recovery-seconds)
      [[ $# -lt 2 ]] && { echo "[chaos] missing value for --max-recovery-seconds"; usage; exit 1; }
      VPS_CHAOS_MAX_RECOVERY_SECONDS="$2"
      shift 2
      ;;
    --poll-interval-seconds)
      [[ $# -lt 2 ]] && { echo "[chaos] missing value for --poll-interval-seconds"; usage; exit 1; }
      VPS_CHAOS_POLL_INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --output)
      [[ $# -lt 2 ]] && { echo "[chaos] missing value for --output"; usage; exit 1; }
      output_path="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[chaos] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

VPS_CHAOS_REQUIRE_PERF_PASS="$(read_bool "$VPS_CHAOS_REQUIRE_PERF_PASS" 1)"
require_positive_int "VPS_CHAOS_MAX_RECOVERY_SECONDS" "$VPS_CHAOS_MAX_RECOVERY_SECONDS"
require_positive_int "VPS_CHAOS_POLL_INTERVAL_SECONDS" "$VPS_CHAOS_POLL_INTERVAL_SECONDS"
require_positive_int "VPS_CHAOS_PERF_REQUESTS" "$VPS_CHAOS_PERF_REQUESTS"
require_positive_int "VPS_CHAOS_PERF_CONCURRENCY" "$VPS_CHAOS_PERF_CONCURRENCY"

if [[ "$remote_mode" -eq 1 ]]; then
  require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
  require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
  require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
  require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
  require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
  require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"
fi

mkdir -p "$VPS_CHAOS_ARTIFACT_DIR"

if [[ -z "$output_path" ]]; then
  run_id="$(date -u +%Y%m%dT%H%M%SZ)"
  output_path="$VPS_CHAOS_ARTIFACT_DIR/certification-$run_id.json"
fi

echo "[chaos] mode: $( [[ "$remote_mode" -eq 1 ]] && echo remote || echo local )"
echo "[chaos] target: $( [[ "$remote_mode" -eq 1 ]] && echo "$VPS_HOST" || echo "localhost" )"
echo "[chaos] recovery_target_seconds: $VPS_CHAOS_MAX_RECOVERY_SECONDS"

baseline_start="$(date +%s)"
if [[ "$remote_mode" -eq 1 ]]; then
  baseline_exit="$(run_check_capture baseline-smoke "$ROOT_DIR/scripts/release-smoke.sh")"
else
  baseline_exit="$(run_check_capture baseline-smoke local_smoke)"
fi
baseline_end="$(date +%s)"
baseline_duration=$((baseline_end - baseline_start))
if [[ "$baseline_duration" -lt 0 ]]; then
  baseline_duration=0
fi
baseline_status="PASS"
if [[ "$baseline_exit" -ne 0 ]]; then
  baseline_status="FAIL"
fi

restart_status="SKIPPED"
restart_exit=0
restart_duration=0
recovery_status="SKIPPED"
recovery_seconds=-1
recovery_code="n/a"

if [[ "$skip_restart" -eq 0 ]]; then
  if [[ "$remote_mode" -eq 1 ]]; then
    restart_start="$(date +%s)"
    restart_exit="$(run_check_capture service-restart "$ROOT_DIR/scripts/vps.sh" restart)"
    restart_end="$(date +%s)"
    restart_duration=$((restart_end - restart_start))
    if [[ "$restart_duration" -lt 0 ]]; then
      restart_duration=0
    fi
    if [[ "$restart_exit" -eq 0 ]]; then
      restart_status="PASS"
    else
      restart_status="FAIL"
    fi
  else
    restart_status="FAIL"
    restart_exit=2
    printf '%s\n' "[chaos] local mode does not support automatic restart drill; use --skip-restart." >"$VPS_CHAOS_ARTIFACT_DIR/service-restart.log"
  fi

  if [[ "$restart_exit" -eq 0 ]]; then
    recovery_status="FAIL"
    elapsed=0
    while [[ "$elapsed" -le "$VPS_CHAOS_MAX_RECOVERY_SECONDS" ]]; do
      set +e
      code="$(status_code)"
      code_exit=$?
      set -e
      if [[ "$code_exit" -eq 0 && "$code" == "200" ]]; then
        recovery_status="PASS"
        recovery_seconds="$elapsed"
        recovery_code="$code"
        break
      fi
      recovery_code="$code"
      sleep "$VPS_CHAOS_POLL_INTERVAL_SECONDS"
      elapsed=$((elapsed + VPS_CHAOS_POLL_INTERVAL_SECONDS))
    done
  fi
fi

perf_status="SKIPPED"
perf_exit=0
perf_duration=0
if [[ "$skip_perf" -eq 0 ]]; then
  perf_start="$(date +%s)"
  perf_cmd=("$ROOT_DIR/scripts/perf-load-smoke.sh" --url "http://127.0.0.1:${VPS_WEB_PORT}/api/status" --requests "$VPS_CHAOS_PERF_REQUESTS" --concurrency "$VPS_CHAOS_PERF_CONCURRENCY" --expect 200)
  if [[ "$remote_mode" -eq 1 ]]; then
    perf_cmd+=(--remote)
  else
    perf_cmd+=(--local)
  fi
  perf_exit="$(run_check_capture perf-smoke "${perf_cmd[@]}")"
  perf_end="$(date +%s)"
  perf_duration=$((perf_end - perf_start))
  if [[ "$perf_duration" -lt 0 ]]; then
    perf_duration=0
  fi
  if [[ "$perf_exit" -eq 0 ]]; then
    perf_status="PASS"
  else
    perf_status="FAIL"
  fi
fi

overall="PASS"
reason="none"
if [[ "$baseline_status" != "PASS" ]]; then
  overall="FAIL"
  reason="baseline_smoke_failed"
elif [[ "$skip_restart" -eq 0 && "$restart_status" != "PASS" ]]; then
  overall="FAIL"
  reason="restart_failed"
elif [[ "$skip_restart" -eq 0 && "$recovery_status" != "PASS" ]]; then
  overall="FAIL"
  reason="recovery_timeout"
elif [[ "$skip_perf" -eq 0 && "$VPS_CHAOS_REQUIRE_PERF_PASS" -eq 1 && "$perf_status" != "PASS" ]]; then
  overall="FAIL"
  reason="perf_smoke_failed"
fi

if [[ "$recovery_status" == "PASS" ]]; then
  echo "[chaos] recovery_seconds:$recovery_seconds"
fi
echo "[chaos] baseline:$baseline_status restart:$restart_status recovery:$recovery_status perf:$perf_status"

REMOTE_MODE="$remote_mode" \
VPS_HOST="$VPS_HOST" \
VPS_WEB_PORT="$VPS_WEB_PORT" \
VPS_CHAOS_MAX_RECOVERY_SECONDS="$VPS_CHAOS_MAX_RECOVERY_SECONDS" \
VPS_CHAOS_POLL_INTERVAL_SECONDS="$VPS_CHAOS_POLL_INTERVAL_SECONDS" \
VPS_CHAOS_PERF_REQUESTS="$VPS_CHAOS_PERF_REQUESTS" \
VPS_CHAOS_PERF_CONCURRENCY="$VPS_CHAOS_PERF_CONCURRENCY" \
VPS_CHAOS_REQUIRE_PERF_PASS="$VPS_CHAOS_REQUIRE_PERF_PASS" \
SKIP_RESTART="$skip_restart" \
SKIP_PERF="$skip_perf" \
BASELINE_STATUS="$baseline_status" \
BASELINE_DURATION="$baseline_duration" \
BASELINE_EXIT="$baseline_exit" \
BASELINE_LOG="$VPS_CHAOS_ARTIFACT_DIR/baseline-smoke.log" \
RESTART_STATUS="$restart_status" \
RESTART_DURATION="$restart_duration" \
RESTART_EXIT="$restart_exit" \
RESTART_LOG="$VPS_CHAOS_ARTIFACT_DIR/service-restart.log" \
RECOVERY_STATUS="$recovery_status" \
RECOVERY_SECONDS="$recovery_seconds" \
RECOVERY_CODE="$recovery_code" \
PERF_STATUS="$perf_status" \
PERF_DURATION="$perf_duration" \
PERF_EXIT="$perf_exit" \
PERF_LOG="$VPS_CHAOS_ARTIFACT_DIR/perf-smoke.log" \
OVERALL="$overall" \
REASON="$reason" \
node - "$output_path" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const out = process.argv[2];
const json = {
  generatedAt: new Date().toISOString(),
  target: {
    mode: process.env.REMOTE_MODE === "1" ? "remote" : "local",
    host: process.env.REMOTE_MODE === "1" ? process.env.VPS_HOST : "localhost",
    webPort: Number(process.env.VPS_WEB_PORT || 0),
  },
  config: {
    maxRecoverySeconds: Number(process.env.VPS_CHAOS_MAX_RECOVERY_SECONDS || 0),
    pollIntervalSeconds: Number(process.env.VPS_CHAOS_POLL_INTERVAL_SECONDS || 0),
    perfRequests: Number(process.env.VPS_CHAOS_PERF_REQUESTS || 0),
    perfConcurrency: Number(process.env.VPS_CHAOS_PERF_CONCURRENCY || 0),
    requirePerfPass: process.env.VPS_CHAOS_REQUIRE_PERF_PASS === "1",
    skipRestart: process.env.SKIP_RESTART === "1",
    skipPerf: process.env.SKIP_PERF === "1",
  },
  checks: {
    baselineSmoke: {
      status: process.env.BASELINE_STATUS || "FAIL",
      durationSeconds: Number(process.env.BASELINE_DURATION || 0),
      exitCode: Number(process.env.BASELINE_EXIT || 1),
      logPath: process.env.BASELINE_LOG || "",
    },
    serviceRestart: {
      status: process.env.RESTART_STATUS || "SKIPPED",
      durationSeconds: Number(process.env.RESTART_DURATION || 0),
      exitCode: Number(process.env.RESTART_EXIT || 0),
      logPath: process.env.RESTART_LOG || "",
    },
    recovery: {
      status: process.env.RECOVERY_STATUS || "SKIPPED",
      recoverySeconds: Number(process.env.RECOVERY_SECONDS || -1),
      lastStatusCode: process.env.RECOVERY_CODE || "n/a",
    },
    perfSmoke: {
      status: process.env.PERF_STATUS || "SKIPPED",
      durationSeconds: Number(process.env.PERF_DURATION || 0),
      exitCode: Number(process.env.PERF_EXIT || 0),
      logPath: process.env.PERF_LOG || "",
    },
  },
  result: {
    status: process.env.OVERALL || "FAIL",
    reason: process.env.REASON || "unknown",
  },
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`, "utf8");
NODE

echo "[chaos] artifact:$output_path"

if [[ "$overall" != "PASS" ]]; then
  echo "[chaos] FAIL: $reason"
  exit 1
fi

echo "[chaos] PASS"
