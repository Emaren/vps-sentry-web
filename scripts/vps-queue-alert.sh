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
VPS_WEB_PORT="${VPS_WEB_PORT:-3035}"

VPS_QUEUE_ALERT_BASE_URL="${VPS_QUEUE_ALERT_BASE_URL:-http://127.0.0.1:${VPS_WEB_PORT}}"
VPS_QUEUE_ALERT_ENDPOINT_PATH="${VPS_QUEUE_ALERT_ENDPOINT_PATH:-/api/ops/remediate-queue}"
VPS_QUEUE_ALERT_TOKEN="${VPS_QUEUE_ALERT_TOKEN:-${VPS_REMEDIATE_QUEUE_TOKEN:-}}"
VPS_QUEUE_ALERT_CURL_TIMEOUT_SECONDS="${VPS_QUEUE_ALERT_CURL_TIMEOUT_SECONDS:-10}"

VPS_QUEUE_ALERT_WARN_QUEUED="${VPS_QUEUE_ALERT_WARN_QUEUED:-2}"
VPS_QUEUE_ALERT_WARN_DLQ="${VPS_QUEUE_ALERT_WARN_DLQ:-1}"
VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING="${VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING:-2}"

VPS_QUEUE_ALERT_CRITICAL_QUEUED="${VPS_QUEUE_ALERT_CRITICAL_QUEUED:-6}"
VPS_QUEUE_ALERT_CRITICAL_DLQ="${VPS_QUEUE_ALERT_CRITICAL_DLQ:-3}"
VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING="${VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING:-5}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

should_alert=0
soft_exit=0
json_mode=0
local_exec="${VPS_LOCAL_EXEC:-0}"

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-queue-alert.sh [--alert|--no-alert] [--soft] [--json] [--local]

Checks remediation queue pressure and exits with:
  0  healthy
 30  warning threshold crossed
 31  critical threshold crossed
  1  query/auth/parse failure

When run from MBP (default), this script SSHes to VPS and executes locally there.
Use --local (or VPS_LOCAL_EXEC=1) to run directly on the VPS.
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[queue-alert] VPS_APP_DIR is not set. Add it in $ENV_FILE."
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
    echo "[queue-alert] unable to locate VPS app dir. Tried: ${candidates[*]}"
    exit 1
  fi

  resolved="$(printf '%s' "$resolved" | tr -d '\r' | sed -n '1p')"
  if [[ -z "$resolved" ]]; then
    echo "[queue-alert] unable to locate VPS app dir. Empty probe response."
    exit 1
  fi

  if [[ -n "$configured" && "$resolved" != "$configured" ]]; then
    echo "[queue-alert] resolved VPS_APP_DIR=$resolved (configured was $configured)"
  fi
  VPS_APP_DIR="$resolved"
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[queue-alert] $name must be a positive integer: $value"
    exit 1
  fi
}

require_nonnegative_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 0 ]]; then
    echo "[queue-alert] $name must be a non-negative integer: $value"
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

    echo "[queue-alert] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
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
    --no-alert)
      should_alert=0
      shift
      ;;
    --soft)
      soft_exit=1
      shift
      ;;
    --json)
      json_mode=1
      shift
      ;;
    --local)
      local_exec=1
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[queue-alert] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_positive_int "VPS_WEB_PORT" "$VPS_WEB_PORT"
require_positive_int "VPS_QUEUE_ALERT_CURL_TIMEOUT_SECONDS" "$VPS_QUEUE_ALERT_CURL_TIMEOUT_SECONDS"
require_nonnegative_int "VPS_QUEUE_ALERT_WARN_QUEUED" "$VPS_QUEUE_ALERT_WARN_QUEUED"
require_nonnegative_int "VPS_QUEUE_ALERT_WARN_DLQ" "$VPS_QUEUE_ALERT_WARN_DLQ"
require_nonnegative_int "VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING" "$VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING"
require_nonnegative_int "VPS_QUEUE_ALERT_CRITICAL_QUEUED" "$VPS_QUEUE_ALERT_CRITICAL_QUEUED"
require_nonnegative_int "VPS_QUEUE_ALERT_CRITICAL_DLQ" "$VPS_QUEUE_ALERT_CRITICAL_DLQ"
require_nonnegative_int "VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING" "$VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING"

if [[ "$local_exec" != "1" ]]; then
  require_app_dir
  resolve_remote_app_dir
  require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
  require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
  require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
  require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
  require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
  require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

  forward_args=()
  [[ "$should_alert" == "1" ]] && forward_args+=(--alert)
  [[ "$soft_exit" == "1" ]] && forward_args+=(--soft)
  [[ "$json_mode" == "1" ]] && forward_args+=(--json)

  remote_cmd="cd $(printf %q "$VPS_APP_DIR") && VPS_LOCAL_EXEC=1 /usr/bin/env bash ./scripts/vps-queue-alert.sh"
  if [[ "${#forward_args[@]}" -gt 0 ]]; then
    for arg in "${forward_args[@]}"; do
      remote_cmd+=" $(printf %q "$arg")"
    done
  fi

  set +e
  remote_output="$(remote "$remote_cmd" 2>&1)"
  remote_rc=$?
  set -e
  printf '%s\n' "$remote_output"
  exit "$remote_rc"
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[queue-alert] curl not found on host"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[queue-alert] jq not found on host"
  exit 1
fi

base_url="${VPS_QUEUE_ALERT_BASE_URL%/}"
endpoint_path="$VPS_QUEUE_ALERT_ENDPOINT_PATH"
if [[ "$endpoint_path" != /* ]]; then
  endpoint_path="/$endpoint_path"
fi
queue_url="${base_url}${endpoint_path}?limit=5"

curl_args=(-fsS --max-time "$VPS_QUEUE_ALERT_CURL_TIMEOUT_SECONDS" -H "accept: application/json")
if [[ -n "$VPS_QUEUE_ALERT_TOKEN" ]]; then
  curl_args+=(-H "x-remediate-queue-token: ${VPS_QUEUE_ALERT_TOKEN}")
fi

set +e
payload="$(curl "${curl_args[@]}" "$queue_url" 2>&1)"
curl_rc=$?
set -e
if [[ "$curl_rc" -ne 0 ]]; then
  if [[ "$json_mode" == "1" ]]; then
    jq -n --arg url "$queue_url" --arg error "$payload" \
      '{ok:false,severity:"critical",statusCode:1,url:$url,error:$error}'
  else
    echo "queue_check_url=$queue_url"
    echo "queue_status=critical"
    echo "queue_reason=query_failed"
    echo "queue_error=$payload"
  fi

  if [[ "$should_alert" == "1" ]]; then
    "$ROOT_DIR/scripts/vps-alert.sh" \
      --severity critical \
      --title "Queue snapshot query failed" \
      --detail "$payload" \
      --context "url=$queue_url" || true
  fi

  [[ "$soft_exit" == "1" ]] && exit 0
  exit 1
fi

ok="$(printf '%s' "$payload" | jq -r '.ok // false')"
if [[ "$ok" != "true" ]]; then
  err_msg="$(printf '%s' "$payload" | jq -r '.error // "queue endpoint returned ok=false"' 2>/dev/null || true)"
  [[ -n "$err_msg" ]] || err_msg="queue endpoint returned ok=false"

  if [[ "$json_mode" == "1" ]]; then
    jq -n --arg url "$queue_url" --arg error "$err_msg" \
      '{ok:false,severity:"critical",statusCode:1,url:$url,error:$error}'
  else
    echo "queue_check_url=$queue_url"
    echo "queue_status=critical"
    echo "queue_reason=endpoint_error"
    echo "queue_error=$err_msg"
  fi

  if [[ "$should_alert" == "1" ]]; then
    "$ROOT_DIR/scripts/vps-alert.sh" \
      --severity critical \
      --title "Queue endpoint denied or failed" \
      --detail "$err_msg" \
      --context "url=$queue_url" || true
  fi

  [[ "$soft_exit" == "1" ]] && exit 0
  exit 1
fi

auth_mode="$(printf '%s' "$payload" | jq -r '.authMode // "unknown"')"
queued="$(printf '%s' "$payload" | jq -r '(.snapshot.counts.queued // 0) | tonumber? // 0')"
running="$(printf '%s' "$payload" | jq -r '(.snapshot.counts.running // .snapshot.counts.processing // 0) | tonumber? // 0')"
dlq="$(printf '%s' "$payload" | jq -r '(.snapshot.counts.dlq // 0) | tonumber? // 0')"
approval_pending="$(printf '%s' "$payload" | jq -r '(.snapshot.counts.approvalPending // .snapshot.counts.approval_pending // 0) | tonumber? // 0')"
retry_scheduled="$(printf '%s' "$payload" | jq -r '(.snapshot.counts.retryScheduled // .snapshot.counts.retry_scheduled // 0) | tonumber? // 0')"

severity="ok"
status_code=0
reasons=()

if (( queued >= VPS_QUEUE_ALERT_CRITICAL_QUEUED )); then
  severity="critical"
  status_code=31
  reasons+=("queued=${queued}>=${VPS_QUEUE_ALERT_CRITICAL_QUEUED}")
fi
if (( dlq >= VPS_QUEUE_ALERT_CRITICAL_DLQ )); then
  severity="critical"
  status_code=31
  reasons+=("dlq=${dlq}>=${VPS_QUEUE_ALERT_CRITICAL_DLQ}")
fi
if (( approval_pending >= VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING )); then
  severity="critical"
  status_code=31
  reasons+=("approval_pending=${approval_pending}>=${VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING}")
fi

if [[ "$severity" != "critical" ]]; then
  if (( queued >= VPS_QUEUE_ALERT_WARN_QUEUED )); then
    severity="warn"
    status_code=30
    reasons+=("queued=${queued}>=${VPS_QUEUE_ALERT_WARN_QUEUED}")
  fi
  if (( dlq >= VPS_QUEUE_ALERT_WARN_DLQ )); then
    severity="warn"
    status_code=30
    reasons+=("dlq=${dlq}>=${VPS_QUEUE_ALERT_WARN_DLQ}")
  fi
  if (( approval_pending >= VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING )); then
    severity="warn"
    status_code=30
    reasons+=("approval_pending=${approval_pending}>=${VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING}")
  fi
fi

if [[ "${#reasons[@]}" -eq 0 ]]; then
  reasons+=("within_threshold")
fi
reason_joined="$(IFS='; '; printf '%s' "${reasons[*]}")"

if [[ "$json_mode" == "1" ]]; then
  jq -n \
    --arg url "$queue_url" \
    --arg authMode "$auth_mode" \
    --arg severity "$severity" \
    --arg reasons "$reason_joined" \
    --argjson queued "$queued" \
    --argjson running "$running" \
    --argjson dlq "$dlq" \
    --argjson approvalPending "$approval_pending" \
    --argjson retryScheduled "$retry_scheduled" \
    --argjson statusCode "$status_code" \
    '{
      ok: true,
      severity: $severity,
      statusCode: $statusCode,
      url: $url,
      authMode: $authMode,
      reasons: $reasons,
      counts: {
        queued: $queued,
        running: $running,
        dlq: $dlq,
        approvalPending: $approvalPending,
        retryScheduled: $retryScheduled
      }
    }'
else
  echo "queue_check_url=$queue_url"
  echo "queue_check_auth_mode=$auth_mode"
  echo "queue_counts=queued:$queued running:$running dlq:$dlq approval_pending:$approval_pending retry_scheduled:$retry_scheduled"
  echo "queue_status=$severity"
  echo "queue_reason=$reason_joined"
fi

if [[ "$should_alert" == "1" && "$status_code" -gt 0 ]]; then
  alert_severity="warn"
  if [[ "$status_code" -eq 31 ]]; then
    alert_severity="critical"
  fi

  "$ROOT_DIR/scripts/vps-alert.sh" \
    --severity "$alert_severity" \
    --title "Remediation queue pressure detected" \
    --detail "queued=$queued dlq=$dlq approval_pending=$approval_pending retry_scheduled=$retry_scheduled ($reason_joined)" \
    --context "url=$queue_url auth_mode=$auth_mode" || true
fi

if [[ "$soft_exit" == "1" ]]; then
  exit 0
fi
exit "$status_code"
