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
VPS_OPS_SAFETY_CRON="${VPS_OPS_SAFETY_CRON:-*/5 * * * *}"
VPS_OPS_SAFETY_LOG_PATH="${VPS_OPS_SAFETY_LOG_PATH:-/home/tony/vps-sentry-ops-safety.log}"
VPS_OPS_SAFETY_ENABLE_QUEUE="${VPS_OPS_SAFETY_ENABLE_QUEUE:-1}"
VPS_OPS_SAFETY_ENABLE_SLO="${VPS_OPS_SAFETY_ENABLE_SLO:-1}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

action="status"

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-ops-safety-automation.sh [install|remove|status]
       [--schedule "*/5 * * * *"] [--log-path /path]
       [--queue|--no-queue] [--slo|--no-slo]

Manages a VPS cron entry that runs queue-pressure + SLO burn-rate alert checks.
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[ops-safety-automation] VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

resolve_remote_app_dir() {
  local configured="${VPS_APP_DIR:-}"
  local candidates=()

  if [[ -n "$configured" ]]; then
    candidates+=("$configured")
  fi
  candidates+=("/var/www/VPSSentry/vps-sentry-web" "/var/www/vps-sentry-web")

  local remote_probe="set -euo pipefail;"
  local candidate
  for candidate in "${candidates[@]}"; do
    remote_probe+=" if [[ -d $(printf '%q' "$candidate") ]]; then printf '%s\n' $(printf '%q' "$candidate"); exit 0; fi;"
  done
  remote_probe+=" exit 1;"

  local resolved=""
  if ! resolved="$(remote "bash -lc $(printf '%q' "$remote_probe")" 2>/dev/null)"; then
    echo "[ops-safety-automation] unable to locate VPS app dir. Tried: ${candidates[*]}"
    exit 1
  fi

  resolved="$(printf '%s' "$resolved" | tr -d '\r' | sed -n '1p')"
  if [[ -z "$resolved" ]]; then
    echo "[ops-safety-automation] unable to locate VPS app dir. Empty probe response."
    exit 1
  fi

  if [[ -n "$configured" && "$resolved" != "$configured" ]]; then
    echo "[ops-safety-automation] resolved VPS_APP_DIR=$resolved (configured was $configured)"
  fi
  VPS_APP_DIR="$resolved"
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[ops-safety-automation] $name must be a positive integer: $value"
    exit 1
  fi
}

normalize_bool() {
  local raw="${1:-}"
  local fallback="${2:-0}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    *) printf '%s' "$fallback" ;;
  esac
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

    echo "[ops-safety-automation] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
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
      echo "[ops-safety-automation] unknown action: $1"
      usage
      exit 1
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --schedule)
      [[ $# -lt 2 ]] && { echo "[ops-safety-automation] missing value for --schedule"; usage; exit 1; }
      VPS_OPS_SAFETY_CRON="$2"
      shift 2
      ;;
    --log-path)
      [[ $# -lt 2 ]] && { echo "[ops-safety-automation] missing value for --log-path"; usage; exit 1; }
      VPS_OPS_SAFETY_LOG_PATH="$2"
      shift 2
      ;;
    --queue)
      VPS_OPS_SAFETY_ENABLE_QUEUE=1
      shift
      ;;
    --no-queue)
      VPS_OPS_SAFETY_ENABLE_QUEUE=0
      shift
      ;;
    --slo)
      VPS_OPS_SAFETY_ENABLE_SLO=1
      shift
      ;;
    --no-slo)
      VPS_OPS_SAFETY_ENABLE_SLO=0
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[ops-safety-automation] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_app_dir
resolve_remote_app_dir
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

VPS_OPS_SAFETY_ENABLE_QUEUE="$(normalize_bool "$VPS_OPS_SAFETY_ENABLE_QUEUE" 1)"
VPS_OPS_SAFETY_ENABLE_SLO="$(normalize_bool "$VPS_OPS_SAFETY_ENABLE_SLO" 1)"

if [[ "$VPS_OPS_SAFETY_ENABLE_QUEUE" != "1" && "$VPS_OPS_SAFETY_ENABLE_SLO" != "1" ]]; then
  echo "[ops-safety-automation] nothing enabled (both queue + slo disabled)"
  exit 1
fi

echo "[ops-safety-automation] host: $VPS_HOST"
echo "[ops-safety-automation] action: $action"

remote "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_OPS_SAFETY_CRON=$(printf %q "$VPS_OPS_SAFETY_CRON") VPS_OPS_SAFETY_LOG_PATH=$(printf %q "$VPS_OPS_SAFETY_LOG_PATH") VPS_OPS_SAFETY_ENABLE_QUEUE=$(printf %q "$VPS_OPS_SAFETY_ENABLE_QUEUE") VPS_OPS_SAFETY_ENABLE_SLO=$(printf %q "$VPS_OPS_SAFETY_ENABLE_SLO") VPS_OPS_SAFETY_ACTION=$(printf %q "$action") bash -s" <<'REMOTE_EOF'
set -euo pipefail

begin_marker="# BEGIN vps-sentry-ops-safety"
end_marker="# END vps-sentry-ops-safety"

queue_cmd=""
slo_cmd=""
if [[ "$VPS_OPS_SAFETY_ENABLE_QUEUE" == "1" ]]; then
  queue_cmd="VPS_LOCAL_EXEC=1 /usr/bin/env bash ./scripts/vps-queue-alert.sh --alert --soft"
fi
if [[ "$VPS_OPS_SAFETY_ENABLE_SLO" == "1" ]]; then
  slo_cmd="VPS_LOCAL_EXEC=1 /usr/bin/env bash ./scripts/vps-slo-burn-rate.sh --alert --soft"
fi

joined_cmd=""
if [[ -n "$queue_cmd" && -n "$slo_cmd" ]]; then
  joined_cmd="$queue_cmd; $slo_cmd"
elif [[ -n "$queue_cmd" ]]; then
  joined_cmd="$queue_cmd"
elif [[ -n "$slo_cmd" ]]; then
  joined_cmd="$slo_cmd"
fi

if [[ -z "$joined_cmd" ]]; then
  echo "[ops-safety-automation] no commands enabled"
  exit 1
fi

cron_line="$VPS_OPS_SAFETY_CRON cd $VPS_APP_DIR && ($joined_cmd) >> $VPS_OPS_SAFETY_LOG_PATH 2>&1"

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

case "$VPS_OPS_SAFETY_ACTION" in
  install)
    {
      printf '%s\n' "$filtered"
      printf '%s\n' "$begin_marker"
      printf '%s\n' "$cron_line"
      printf '%s\n' "$end_marker"
    } | awk 'NF || !x{print; x=NF}' > "$tmp_file"
    crontab "$tmp_file"
    echo "[ops-safety-automation] installed"
    echo "[ops-safety-automation] cron:$cron_line"
    ;;

  remove)
    printf '%s\n' "$filtered" > "$tmp_file"
    crontab "$tmp_file"
    echo "[ops-safety-automation] removed"
    ;;

  status)
    active="$(printf '%s\n' "$current" | awk -v begin="$begin_marker" -v end="$end_marker" '
      $0 == begin {show=1; print; next}
      $0 == end {print; show=0; next}
      show {print}
    ')"

    if [[ -z "$active" ]]; then
      echo "[ops-safety-automation] status:not-installed"
    else
      echo "[ops-safety-automation] status:installed"
      echo "$active"
    fi
    ;;

  *)
    echo "[ops-safety-automation] unknown action:$VPS_OPS_SAFETY_ACTION"
    exit 1
    ;;
esac
REMOTE_EOF
