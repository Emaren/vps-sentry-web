#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_APP_DIR="${VPS_APP_DIR:-}"
VPS_SERVICE="${VPS_SERVICE:-}"
VPS_WEB_PORT="${VPS_WEB_PORT:-3035}"
VPS_BACKUP_BASE="${VPS_BACKUP_BASE:-/home/tony/_backup/vps-sentry-web}"
VPS_MONITOR_DISK_WARN_PCT="${VPS_MONITOR_DISK_WARN_PCT:-85}"
VPS_MONITOR_BACKUP_MAX_AGE_HOURS="${VPS_MONITOR_BACKUP_MAX_AGE_HOURS:-26}"
VPS_MONITOR_CHECK_BACKUP="${VPS_MONITOR_CHECK_BACKUP:-1}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

should_alert=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-monitor.sh [--alert] [--no-backup-check]

Checks production health over SSH:
- service state (if VPS_SERVICE configured)
- local app endpoint status on VPS (:VPS_WEB_PORT)
- root filesystem usage threshold
- backup freshness from VPS_BACKUP_BASE/last_success_epoch

Flags:
  --alert            Send alert via scripts/vps-alert.sh when monitor fails
  --no-backup-check  Skip backup freshness check
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[monitor] VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[monitor] $name must be a positive integer: $value"
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

    echo "[monitor] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alert)
      should_alert=1
      shift
      ;;
    --no-backup-check)
      VPS_MONITOR_CHECK_BACKUP=0
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[monitor] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_app_dir
require_positive_int "VPS_WEB_PORT" "$VPS_WEB_PORT"
require_positive_int "VPS_MONITOR_DISK_WARN_PCT" "$VPS_MONITOR_DISK_WARN_PCT"
require_positive_int "VPS_MONITOR_BACKUP_MAX_AGE_HOURS" "$VPS_MONITOR_BACKUP_MAX_AGE_HOURS"
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

echo "[monitor] host: $VPS_HOST"
echo "[monitor] app_dir: $VPS_APP_DIR"
echo "[monitor] web_port: $VPS_WEB_PORT"

monitor_output=""
if ! monitor_output="$(
  remote "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_SERVICE=$(printf %q "$VPS_SERVICE") VPS_WEB_PORT=$(printf %q "$VPS_WEB_PORT") VPS_BACKUP_BASE=$(printf %q "$VPS_BACKUP_BASE") VPS_MONITOR_DISK_WARN_PCT=$(printf %q "$VPS_MONITOR_DISK_WARN_PCT") VPS_MONITOR_BACKUP_MAX_AGE_HOURS=$(printf %q "$VPS_MONITOR_BACKUP_MAX_AGE_HOURS") VPS_MONITOR_CHECK_BACKUP=$(printf %q "$VPS_MONITOR_CHECK_BACKUP") bash -s" <<'REMOTE_EOF'
set -euo pipefail

fail=0
reasons=()

if [[ ! -d "$VPS_APP_DIR" ]]; then
  echo "check_app_dir=fail path_missing:$VPS_APP_DIR"
  echo "overall=FAIL"
  exit 1
fi
echo "check_app_dir=pass"

if [[ -n "$VPS_SERVICE" ]]; then
  if systemctl is-active "$VPS_SERVICE" >/dev/null 2>&1; then
    echo "check_service=pass service=$VPS_SERVICE"
  else
    echo "check_service=fail service_inactive:$VPS_SERVICE"
    reasons+=("service_inactive:$VPS_SERVICE")
    fail=1
  fi
else
  echo "check_service=skip"
fi

root_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/" || echo 000)"
login_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/login" || echo 000)"
status_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/api/status" || echo 000)"

echo "check_http_root=$root_code"
echo "check_http_login=$login_code"
echo "check_http_status=$status_code"

if [[ "$root_code" != "200" && "$root_code" != "307" ]]; then
  reasons+=("root_status:$root_code")
  fail=1
fi
if [[ "$login_code" != "200" ]]; then
  reasons+=("login_status:$login_code")
  fail=1
fi
if [[ "$status_code" != "200" && "$status_code" != "401" ]]; then
  reasons+=("api_status:$status_code")
  fail=1
fi

use_pct="$(df -P / | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
if [[ -z "$use_pct" ]]; then
  echo "check_disk=fail unable_to_parse"
  reasons+=("disk_parse_failed")
  fail=1
else
  echo "check_disk=usage_pct:$use_pct threshold:$VPS_MONITOR_DISK_WARN_PCT"
  if (( use_pct >= VPS_MONITOR_DISK_WARN_PCT )); then
    reasons+=("disk_high:${use_pct}%")
    fail=1
  fi
fi

if [[ "$VPS_MONITOR_CHECK_BACKUP" == "1" ]]; then
  marker="$VPS_BACKUP_BASE/last_success_epoch"
  if [[ ! -f "$marker" ]]; then
    echo "check_backup=fail marker_missing:$marker"
    reasons+=("backup_marker_missing")
    fail=1
  else
    epoch="$(tr -d '[:space:]' < "$marker")"
    if ! [[ "$epoch" =~ ^[0-9]+$ ]]; then
      echo "check_backup=fail marker_invalid:$marker"
      reasons+=("backup_marker_invalid")
      fail=1
    else
      now_epoch="$(date +%s)"
      age_seconds=$((now_epoch - epoch))
      age_hours=$((age_seconds / 3600))
      echo "check_backup=age_hours:$age_hours threshold:$VPS_MONITOR_BACKUP_MAX_AGE_HOURS"
      if (( age_hours > VPS_MONITOR_BACKUP_MAX_AGE_HOURS )); then
        reasons+=("backup_stale:${age_hours}h")
        fail=1
      fi
    fi
  fi
else
  echo "check_backup=skip"
fi

if [[ "$fail" -ne 0 ]]; then
  printf 'reason=%s\n' "${reasons[*]}"
  echo "overall=FAIL"
  exit 1
fi

echo "overall=PASS"
REMOTE_EOF
)"; then
  echo "$monitor_output"

  reason_line="$(printf '%s\n' "$monitor_output" | awk -F= '/^reason=/{print $2}' | tail -n1)"
  reason_line="${reason_line:-monitor_failed_without_reason}"

  if [[ "$should_alert" -eq 1 ]]; then
    "$ROOT_DIR/scripts/vps-alert.sh" \
      --severity critical \
      --title "Production monitor failed" \
      --detail "$reason_line" \
      --context "$monitor_output" || true
  fi

  exit 1
fi

echo "$monitor_output"
echo "[monitor] PASS"
