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
VPS_BACKUP_CRON="${VPS_BACKUP_CRON:-17 * * * *}"
VPS_BACKUP_LOG_PATH="${VPS_BACKUP_LOG_PATH:-/home/tony/vps-sentry-backup.log}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

action="status"

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-backup-automation.sh [install|remove|status] [--schedule "17 * * * *"] [--log-path /path]

Manages a cron entry on VPS for hourly backups using scripts/vps-backup.sh.
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[backup-automation] VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[backup-automation] $name must be a positive integer: $value"
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

    echo "[backup-automation] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
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
      echo "[backup-automation] unknown action: $1"
      usage
      exit 1
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --schedule)
      [[ $# -lt 2 ]] && { echo "[backup-automation] missing value for --schedule"; usage; exit 1; }
      VPS_BACKUP_CRON="$2"
      shift 2
      ;;
    --log-path)
      [[ $# -lt 2 ]] && { echo "[backup-automation] missing value for --log-path"; usage; exit 1; }
      VPS_BACKUP_LOG_PATH="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[backup-automation] unknown arg: $1"
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

echo "[backup-automation] host: $VPS_HOST"
echo "[backup-automation] action: $action"

remote "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_BACKUP_CRON=$(printf %q "$VPS_BACKUP_CRON") VPS_BACKUP_LOG_PATH=$(printf %q "$VPS_BACKUP_LOG_PATH") VPS_BACKUP_ACTION=$(printf %q "$action") bash -s" <<'REMOTE_EOF'
set -euo pipefail

begin_marker="# BEGIN vps-sentry-backup"
end_marker="# END vps-sentry-backup"
cron_line="$VPS_BACKUP_CRON cd $VPS_APP_DIR && /usr/bin/env bash ./scripts/vps-backup.sh >> $VPS_BACKUP_LOG_PATH 2>&1"

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

case "$VPS_BACKUP_ACTION" in
  install)
    {
      printf '%s\n' "$filtered"
      printf '%s\n' "$begin_marker"
      printf '%s\n' "$cron_line"
      printf '%s\n' "$end_marker"
    } | awk 'NF || !x{print; x=NF}' > "$tmp_file"
    crontab "$tmp_file"
    echo "[backup-automation] installed"
    echo "[backup-automation] cron:$cron_line"
    ;;

  remove)
    printf '%s\n' "$filtered" > "$tmp_file"
    crontab "$tmp_file"
    echo "[backup-automation] removed"
    ;;

  status)
    active="$(printf '%s\n' "$current" | awk -v begin="$begin_marker" -v end="$end_marker" '
      $0 == begin {show=1; print; next}
      $0 == end {print; show=0; next}
      show {print}
    ')"

    if [[ -z "$active" ]]; then
      echo "[backup-automation] status:not-installed"
    else
      echo "[backup-automation] status:installed"
      echo "$active"
    fi
    ;;

  *)
    echo "[backup-automation] unknown action:$VPS_BACKUP_ACTION"
    exit 1
    ;;
esac
REMOTE_EOF
