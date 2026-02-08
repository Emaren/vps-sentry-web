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

url="http://127.0.0.1:${VPS_WEB_PORT}/api/status"
requests="200"
concurrency="20"
expected_code="200"
remote_mode=1

usage() {
  cat <<'USAGE'
Usage: ./scripts/perf-load-smoke.sh [--url URL] [--requests N] [--concurrency N] [--expect CODE] [--local|--remote]

Quick load/perf smoke for API endpoints.

Defaults:
  --url http://127.0.0.1:$VPS_WEB_PORT/api/status
  --requests 200
  --concurrency 20
  --expect 200
  --remote (run on VPS over SSH)
USAGE
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[perf] $name must be a positive integer: $value"
    exit 1
  fi
}

run_remote() {
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

    echo "[perf] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

run_load() {
  local target_url="$1"
  local reqs="$2"
  local conc="$3"
  local expect="$4"

  local tmp
  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' RETURN

  local start
  start="$(date +%s)"

  TARGET_URL="$target_url" EXPECT_CODE="$expect" \
    seq 1 "$reqs" | xargs -n 1 -P "$conc" sh -c '
      code="$(curl -s -o /dev/null -w "%{http_code}" "$TARGET_URL")"
      if [ "$code" = "$EXPECT_CODE" ]; then
        echo ok
      else
        echo fail:$code
      fi
    ' > "$tmp"

  local end
  end="$(date +%s)"
  local duration=$((end - start))
  if [[ "$duration" -le 0 ]]; then
    duration=1
  fi

  local ok_count
  ok_count="$(grep -c '^ok$' "$tmp" || true)"
  local fail_count
  fail_count="$(grep -c '^fail:' "$tmp" || true)"
  local rps
  rps="$(awk -v n="$reqs" -v d="$duration" 'BEGIN{printf "%.2f", n/d}')"

  echo "[perf] url=$target_url"
  echo "[perf] requests=$reqs concurrency=$conc expected=$expect"
  echo "[perf] duration_s=$duration approx_rps=$rps"
  echo "[perf] ok=$ok_count fail=$fail_count"

  if [[ "$fail_count" -gt 0 ]]; then
    echo "[perf] top_fail_codes:"
    grep '^fail:' "$tmp" | sed 's/^fail://' | sort | uniq -c | sort -nr | head -n 10
    return 1
  fi

  return 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      [[ $# -lt 2 ]] && { echo "[perf] missing value for --url"; usage; exit 1; }
      url="$2"
      shift 2
      ;;
    --requests)
      [[ $# -lt 2 ]] && { echo "[perf] missing value for --requests"; usage; exit 1; }
      requests="$2"
      shift 2
      ;;
    --concurrency)
      [[ $# -lt 2 ]] && { echo "[perf] missing value for --concurrency"; usage; exit 1; }
      concurrency="$2"
      shift 2
      ;;
    --expect)
      [[ $# -lt 2 ]] && { echo "[perf] missing value for --expect"; usage; exit 1; }
      expected_code="$2"
      shift 2
      ;;
    --local)
      remote_mode=0
      shift
      ;;
    --remote)
      remote_mode=1
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[perf] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_positive_int "requests" "$requests"
require_positive_int "concurrency" "$concurrency"
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

if ! [[ "$expected_code" =~ ^[0-9]{3}$ ]]; then
  echo "[perf] --expect must be a 3-digit HTTP code"
  exit 1
fi

if [[ "$remote_mode" -eq 0 ]]; then
  run_load "$url" "$requests" "$concurrency" "$expected_code"
  echo "[perf] PASS"
  exit 0
fi

echo "[perf] remote host: $VPS_HOST"
run_remote \
  "TARGET_URL=$(printf %q "$url") REQUESTS=$(printf %q "$requests") CONCURRENCY=$(printf %q "$concurrency") EXPECT_CODE=$(printf %q "$expected_code") bash -s" <<'REMOTE_EOF'
set -euo pipefail

tmp="$(mktemp)"
cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

start="$(date +%s)"

TARGET_URL="$TARGET_URL" EXPECT_CODE="$EXPECT_CODE" \
  seq 1 "$REQUESTS" | xargs -n 1 -P "$CONCURRENCY" sh -c '
    code="$(curl -s -o /dev/null -w "%{http_code}" "$TARGET_URL")"
    if [ "$code" = "$EXPECT_CODE" ]; then
      echo ok
    else
      echo fail:$code
    fi
  ' > "$tmp"

end="$(date +%s)"
duration=$((end - start))
if [[ "$duration" -le 0 ]]; then
  duration=1
fi

ok_count="$(grep -c '^ok$' "$tmp" || true)"
fail_count="$(grep -c '^fail:' "$tmp" || true)"
rps="$(awk -v n="$REQUESTS" -v d="$duration" 'BEGIN{printf "%.2f", n/d}')"

echo "[perf] url=$TARGET_URL"
echo "[perf] requests=$REQUESTS concurrency=$CONCURRENCY expected=$EXPECT_CODE"
echo "[perf] duration_s=$duration approx_rps=$rps"
echo "[perf] ok=$ok_count fail=$fail_count"

if [[ "$fail_count" -gt 0 ]]; then
  echo "[perf] top_fail_codes:"
  grep '^fail:' "$tmp" | sed 's/^fail://' | sort | uniq -c | sort -nr | head -n 10
  exit 1
fi
REMOTE_EOF

echo "[perf] PASS"
