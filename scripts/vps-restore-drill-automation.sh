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
VPS_RESTORE_DRILL_CRON="${VPS_RESTORE_DRILL_CRON:-23 3 * * 1}"
VPS_RESTORE_DRILL_LOG_PATH="${VPS_RESTORE_DRILL_LOG_PATH:-/home/tony/vps-sentry-restore-drill.log}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

action="status"

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-restore-drill-automation.sh [install|remove|status] [--schedule "23 3 * * 1"] [--log-path /path]

Manages recurring restore drill cron on VPS.
Each run executes:
1) vps-restore-drill.sh
2) vps-rpo-rto-report.sh --alert --soft
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[restore-automation] VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[restore-automation] $name must be a positive integer: $value"
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

    echo "[restore-automation] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    install|remove|status)
      action="$1"
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[restore-automation] unknown action: $1"
      usage
      exit 1
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --schedule)
      [[ $# -lt 2 ]] && { echo "[restore-automation] missing value for --schedule"; usage; exit 1; }
      VPS_RESTORE_DRILL_CRON="$2"
      shift 2
      ;;
    --log-path)
      [[ $# -lt 2 ]] && { echo "[restore-automation] missing value for --log-path"; usage; exit 1; }
      VPS_RESTORE_DRILL_LOG_PATH="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[restore-automation] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_app_dir
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

echo "[restore-automation] host: $VPS_HOST"
echo "[restore-automation] action: $action"

remote "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_RESTORE_DRILL_CRON=$(printf %q "$VPS_RESTORE_DRILL_CRON") VPS_RESTORE_DRILL_LOG_PATH=$(printf %q "$VPS_RESTORE_DRILL_LOG_PATH") VPS_RESTORE_DRILL_ACTION=$(printf %q "$action") bash -s" <<'REMOTE_EOF'
set -euo pipefail

begin_marker="# BEGIN vps-sentry-restore-drill"
end_marker="# END vps-sentry-restore-drill"
cron_line="$VPS_RESTORE_DRILL_CRON cd $VPS_APP_DIR && (VPS_LOCAL_EXEC=1 /usr/bin/env bash ./scripts/vps-restore-drill.sh; VPS_LOCAL_EXEC=1 /usr/bin/env bash ./scripts/vps-rpo-rto-report.sh --alert --soft) >> $VPS_RESTORE_DRILL_LOG_PATH 2>&1"

tmp_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT

current="$(crontab -l 2>/dev/null || true)"

filtered="$(printf '%s\n' "$current" | awk -v begin="$begin_marker" -v end="$end_marker" '
  $0 == begin {skip=1; next}
  $0 == end {skip=0; next}
  !skip {print}
')"

case "$VPS_RESTORE_DRILL_ACTION" in
  install)
    {
      printf '%s\n' "$filtered"
      printf '%s\n' "$begin_marker"
      printf '%s\n' "$cron_line"
      printf '%s\n' "$end_marker"
    } | awk 'NF || !x{print; x=NF}' > "$tmp_file"
    crontab "$tmp_file"
    echo "[restore-automation] installed"
    echo "[restore-automation] cron:$cron_line"
    ;;

  remove)
    printf '%s\n' "$filtered" > "$tmp_file"
    crontab "$tmp_file"
    echo "[restore-automation] removed"
    ;;

  status)
    active="$(printf '%s\n' "$current" | awk -v begin="$begin_marker" -v end="$end_marker" '
      $0 == begin {show=1; print; next}
      $0 == end {print; show=0; next}
      show {print}
    ')"

    if [[ -z "$active" ]]; then
      echo "[restore-automation] status:not-installed"
    else
      echo "[restore-automation] status:installed"
      echo "$active"
    fi
    ;;

  *)
    echo "[restore-automation] unknown action:$VPS_RESTORE_DRILL_ACTION"
    exit 1
    ;;
esac
REMOTE_EOF
