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
VPS_SERVICE="${VPS_SERVICE:-vps-sentry-web.service}"

VPS_OPS_WORKER_SERVICE="${VPS_OPS_WORKER_SERVICE:-vps-sentry-ops-worker.service}"
VPS_OPS_WORKER_USER="${VPS_OPS_WORKER_USER:-tony}"
VPS_OPS_WORKER_ENV_FILE="${VPS_OPS_WORKER_ENV_FILE:-/etc/vps-sentry-web.env}"
OPS_WORKER_BASE_URL="${OPS_WORKER_BASE_URL:-http://127.0.0.1:3035}"
OPS_WORKER_DRAIN_LIMIT="${OPS_WORKER_DRAIN_LIMIT:-5}"
OPS_WORKER_INTERVAL_SECONDS="${OPS_WORKER_INTERVAL_SECONDS:-15}"
OPS_WORKER_IDLE_INTERVAL_SECONDS="${OPS_WORKER_IDLE_INTERVAL_SECONDS:-30}"
OPS_WORKER_MAX_BACKOFF_SECONDS="${OPS_WORKER_MAX_BACKOFF_SECONDS:-120}"
VPS_OPS_WORKER_LOG_LINES="${VPS_OPS_WORKER_LOG_LINES:-120}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

action="status"

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-ops-worker-service.sh [install|remove|status|restart|logs]
       [--service-name NAME] [--user USER]
       [--base-url URL] [--limit N] [--interval S] [--idle-interval S] [--max-backoff S]

Manages the durable remediation queue worker systemd service on the VPS.
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[ops-worker-service] VPS_APP_DIR is not set. Add it in $ENV_FILE."
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
    echo "[ops-worker-service] unable to locate VPS app dir. Tried: ${candidates[*]}"
    exit 1
  fi

  resolved="$(printf '%s' "$resolved" | tr -d '\r' | sed -n '1p')"
  if [[ -z "$resolved" ]]; then
    echo "[ops-worker-service] unable to locate VPS app dir. Empty probe response."
    exit 1
  fi

  if [[ -n "$configured" && "$resolved" != "$configured" ]]; then
    echo "[ops-worker-service] resolved VPS_APP_DIR=$resolved (configured was $configured)"
  fi
  VPS_APP_DIR="$resolved"
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[ops-worker-service] $name must be a positive integer: $value"
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

    echo "[ops-worker-service] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

if [[ $# -gt 0 ]]; then
  case "$1" in
    install|remove|status|restart|logs)
      action="$1"
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[ops-worker-service] unknown action: $1"
      usage
      exit 1
      ;;
  esac
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service-name)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --service-name"; usage; exit 1; }
      VPS_OPS_WORKER_SERVICE="$2"
      shift 2
      ;;
    --user)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --user"; usage; exit 1; }
      VPS_OPS_WORKER_USER="$2"
      shift 2
      ;;
    --base-url)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --base-url"; usage; exit 1; }
      OPS_WORKER_BASE_URL="$2"
      shift 2
      ;;
    --limit)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --limit"; usage; exit 1; }
      OPS_WORKER_DRAIN_LIMIT="$2"
      shift 2
      ;;
    --interval)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --interval"; usage; exit 1; }
      OPS_WORKER_INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --idle-interval)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --idle-interval"; usage; exit 1; }
      OPS_WORKER_IDLE_INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --max-backoff)
      [[ $# -lt 2 ]] && { echo "[ops-worker-service] missing value for --max-backoff"; usage; exit 1; }
      OPS_WORKER_MAX_BACKOFF_SECONDS="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[ops-worker-service] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_app_dir
resolve_remote_app_dir
require_positive_int "OPS_WORKER_DRAIN_LIMIT" "$OPS_WORKER_DRAIN_LIMIT"
require_positive_int "OPS_WORKER_INTERVAL_SECONDS" "$OPS_WORKER_INTERVAL_SECONDS"
require_positive_int "OPS_WORKER_IDLE_INTERVAL_SECONDS" "$OPS_WORKER_IDLE_INTERVAL_SECONDS"
require_positive_int "OPS_WORKER_MAX_BACKOFF_SECONDS" "$OPS_WORKER_MAX_BACKOFF_SECONDS"
require_positive_int "VPS_OPS_WORKER_LOG_LINES" "$VPS_OPS_WORKER_LOG_LINES"
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

echo "[ops-worker-service] host: $VPS_HOST"
echo "[ops-worker-service] action: $action"
echo "[ops-worker-service] unit: $VPS_OPS_WORKER_SERVICE"

remote "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_SERVICE=$(printf %q "$VPS_SERVICE") VPS_OPS_WORKER_SERVICE=$(printf %q "$VPS_OPS_WORKER_SERVICE") VPS_OPS_WORKER_USER=$(printf %q "$VPS_OPS_WORKER_USER") VPS_OPS_WORKER_ENV_FILE=$(printf %q "$VPS_OPS_WORKER_ENV_FILE") OPS_WORKER_BASE_URL=$(printf %q "$OPS_WORKER_BASE_URL") OPS_WORKER_DRAIN_LIMIT=$(printf %q "$OPS_WORKER_DRAIN_LIMIT") OPS_WORKER_INTERVAL_SECONDS=$(printf %q "$OPS_WORKER_INTERVAL_SECONDS") OPS_WORKER_IDLE_INTERVAL_SECONDS=$(printf %q "$OPS_WORKER_IDLE_INTERVAL_SECONDS") OPS_WORKER_MAX_BACKOFF_SECONDS=$(printf %q "$OPS_WORKER_MAX_BACKOFF_SECONDS") VPS_OPS_WORKER_LOG_LINES=$(printf %q "$VPS_OPS_WORKER_LOG_LINES") VPS_OPS_WORKER_ACTION=$(printf %q "$action") bash -s" <<'REMOTE_EOF'
set -euo pipefail

require_sudo() {
  local systemctl_cmd
  systemctl_cmd="$(command -v systemctl || true)"
  if [[ -z "$systemctl_cmd" ]] || ! sudo -n "$systemctl_cmd" --version >/dev/null 2>&1; then
    echo "[ops-worker-service] sudo -n is required on VPS for this action."
    exit 1
  fi
}

unit_path="/etc/systemd/system/${VPS_OPS_WORKER_SERVICE}"

case "$VPS_OPS_WORKER_ACTION" in
  install)
    require_sudo
    if [[ ! -d "$VPS_APP_DIR" ]]; then
      echo "[ops-worker-service] app dir missing: $VPS_APP_DIR"
      exit 1
    fi

    tmp_unit="$(mktemp)"
    cat > "$tmp_unit" <<EOF
[Unit]
Description=VPS Sentry Ops Worker (Remediation Queue Drain)
After=network-online.target ${VPS_SERVICE}
Wants=network-online.target

[Service]
Type=simple
User=${VPS_OPS_WORKER_USER}
WorkingDirectory=${VPS_APP_DIR}
EnvironmentFile=-${VPS_OPS_WORKER_ENV_FILE}
Environment=OPS_WORKER_BASE_URL=${OPS_WORKER_BASE_URL}
Environment=OPS_WORKER_DRAIN_LIMIT=${OPS_WORKER_DRAIN_LIMIT}
Environment=OPS_WORKER_INTERVAL_SECONDS=${OPS_WORKER_INTERVAL_SECONDS}
Environment=OPS_WORKER_IDLE_INTERVAL_SECONDS=${OPS_WORKER_IDLE_INTERVAL_SECONDS}
Environment=OPS_WORKER_MAX_BACKOFF_SECONDS=${OPS_WORKER_MAX_BACKOFF_SECONDS}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/env node ./scripts/ops-worker.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    sudo -n install -m 0644 "$tmp_unit" "$unit_path"
    rm -f "$tmp_unit"
    sudo -n systemctl daemon-reload
    sudo -n systemctl enable --now "$VPS_OPS_WORKER_SERVICE"

    if sudo -n test -f "$VPS_OPS_WORKER_ENV_FILE"; then
      if sudo -n grep -Eq '^[[:space:]]*VPS_REMEDIATE_QUEUE_TOKEN=' "$VPS_OPS_WORKER_ENV_FILE"; then
        echo "[ops-worker-service] token source found in $VPS_OPS_WORKER_ENV_FILE"
      else
        echo "[ops-worker-service] WARN: VPS_REMEDIATE_QUEUE_TOKEN missing in $VPS_OPS_WORKER_ENV_FILE"
      fi
    else
      echo "[ops-worker-service] WARN: env file missing: $VPS_OPS_WORKER_ENV_FILE"
    fi

    sudo -n systemctl --no-pager --full status "$VPS_OPS_WORKER_SERVICE" | sed -n '1,40p'
    ;;

  remove)
    require_sudo
    sudo -n systemctl disable --now "$VPS_OPS_WORKER_SERVICE" >/dev/null 2>&1 || true
    sudo -n rm -f "$unit_path"
    sudo -n systemctl daemon-reload
    echo "[ops-worker-service] removed $VPS_OPS_WORKER_SERVICE"
    ;;

  restart)
    require_sudo
    sudo -n systemctl restart "$VPS_OPS_WORKER_SERVICE"
    sudo -n systemctl --no-pager --full status "$VPS_OPS_WORKER_SERVICE" | sed -n '1,40p'
    ;;

  logs)
    require_sudo
    sudo -n journalctl -u "$VPS_OPS_WORKER_SERVICE" -n "$VPS_OPS_WORKER_LOG_LINES" --no-pager
    ;;

  status)
    systemctl_cmd="$(command -v systemctl || true)"
    if command -v systemctl >/dev/null 2>&1; then
      systemctl is-enabled "$VPS_OPS_WORKER_SERVICE" 2>/dev/null || true
      systemctl is-active "$VPS_OPS_WORKER_SERVICE" 2>/dev/null || true
    fi
    if [[ -n "$systemctl_cmd" ]] && sudo -n "$systemctl_cmd" --version >/dev/null 2>&1; then
      sudo -n "$systemctl_cmd" --no-pager --full status "$VPS_OPS_WORKER_SERVICE" | sed -n '1,40p' || true
    else
      systemctl --no-pager --full status "$VPS_OPS_WORKER_SERVICE" | sed -n '1,40p' || true
      echo "[ops-worker-service] note: passwordless sudo for systemctl not available; status may be limited."
    fi
    ;;

  *)
    echo "[ops-worker-service] unknown action:$VPS_OPS_WORKER_ACTION"
    exit 1
    ;;
esac
REMOTE_EOF
