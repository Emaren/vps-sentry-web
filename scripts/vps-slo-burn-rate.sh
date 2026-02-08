#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_WEB_PORT="${VPS_WEB_PORT:-3035}"
VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_SLO_BASE_URL="${VPS_SLO_BASE_URL:-http://127.0.0.1:${VPS_WEB_PORT}}"
VPS_SLO_ENDPOINT_PATH="${VPS_SLO_ENDPOINT_PATH:-/api/ops/slo}"
VPS_SLO_TOKEN="${VPS_SLO_TOKEN:-}"
VPS_SLO_WINDOW_HOURS="${VPS_SLO_WINDOW_HOURS:-}"
VPS_SLO_HTTP_TIMEOUT_SECONDS="${VPS_SLO_HTTP_TIMEOUT_SECONDS:-10}"
VPS_SLO_QUERY_MODE="${VPS_SLO_QUERY_MODE:-auto}"
VPS_SLO_ALERT_ON_WARN="${VPS_SLO_ALERT_ON_WARN:-1}"
VPS_SLO_ALERT_ON_CRITICAL="${VPS_SLO_ALERT_ON_CRITICAL:-1}"
VPS_SLO_ALERT_ON_OK="${VPS_SLO_ALERT_ON_OK:-0}"
VPS_SLO_CONTEXT_MAX_CHARS="${VPS_SLO_CONTEXT_MAX_CHARS:-5000}"
VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

send_alert=1
soft_exit=0
json_output=0
manual_window_hours=""
manual_base_url=""
manual_token=""
manual_route=""
manual_query_mode=""

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-slo-burn-rate.sh [--alert|--no-alert] [--soft] [--json] [--window-hours N] [--url BASE_URL] [--token TOKEN] [--route none|webhook|email|both|auto] [--local|--remote|--auto]

Checks Step 15 SLO status from /api/ops/slo and optionally sends routed alerts.

Exit codes:
  0   SLO healthy (or --soft for warn/critical)
  30  SLO warning
  31  SLO critical
  1   API/auth/parse failure or alert transport failure

Env:
  VPS_SLO_BASE_URL                 Default http://127.0.0.1:${VPS_WEB_PORT}
  VPS_SLO_ENDPOINT_PATH            Default /api/ops/slo
  VPS_SLO_TOKEN                    Optional token for x-slo-token header
  VPS_SLO_QUERY_MODE               local|remote|auto (default auto)
  VPS_SLO_WINDOW_HOURS             Optional windowHours query override
  VPS_SLO_HTTP_TIMEOUT_SECONDS     Default 10
  VPS_SLO_ALERT_ON_WARN            Default 1
  VPS_SLO_ALERT_ON_CRITICAL        Default 1
  VPS_SLO_ALERT_ON_OK              Default 0
  VPS_SLO_CONTEXT_MAX_CHARS        Default 5000
USAGE
}

trim() {
  local value="$1"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[slo] $name must be a positive integer: $value"
    exit 1
  fi
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

truncate_value() {
  local value="$1"
  local max="$2"
  if [[ "${#value}" -le "$max" ]]; then
    printf '%s' "$value"
    return
  fi
  printf '%s...[truncated]' "${value:0:max}"
}

b64_decode() {
  local value="$1"
  if decoded="$(printf '%s' "$value" | base64 --decode 2>/dev/null)"; then
    printf '%s' "$decoded"
    return 0
  fi
  if decoded="$(printf '%s' "$value" | base64 -D 2>/dev/null)"; then
    printf '%s' "$decoded"
    return 0
  fi
  return 1
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

    echo "[slo] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

query_local() {
  local target_url="$1"
  local target_token="$2"
  local output_file="$3"
  local -a cmd
  cmd=(curl -sS --max-time "$VPS_SLO_HTTP_TIMEOUT_SECONDS" -o "$output_file" -w '%{http_code}')
  if [[ -n "$(trim "$target_token")" ]]; then
    cmd+=(-H "x-slo-token: $target_token")
  fi
  cmd+=("$target_url")
  "${cmd[@]}"
}

query_remote() {
  local target_url="$1"
  local target_token="$2"
  local output_file="$3"
  local payload=""
  local http_code=""

  payload="$(
    remote "VPS_SLO_URL=$(printf %q "$target_url") VPS_SLO_TOKEN=$(printf %q "$target_token") VPS_SLO_TIMEOUT=$(printf %q "$VPS_SLO_HTTP_TIMEOUT_SECONDS") bash -s" <<'REMOTE_EOF'
set -euo pipefail
tmp="$(mktemp)"
cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

if [[ -n "${VPS_SLO_TOKEN:-}" ]]; then
  code="$(curl -sS --max-time "$VPS_SLO_TIMEOUT" -H "x-slo-token: ${VPS_SLO_TOKEN}" -o "$tmp" -w '%{http_code}' "$VPS_SLO_URL")"
else
  code="$(curl -sS --max-time "$VPS_SLO_TIMEOUT" -o "$tmp" -w '%{http_code}' "$VPS_SLO_URL")"
fi

cat "$tmp"
printf '\n__SLO_HTTP_CODE__=%s\n' "$code"
REMOTE_EOF
  )" || return 1

  http_code="$(printf '%s\n' "$payload" | sed -n 's/^__SLO_HTTP_CODE__=//p' | tail -n 1)"
  printf '%s\n' "$payload" | sed '/^__SLO_HTTP_CODE__=/d' > "$output_file"

  if [[ -z "$http_code" ]]; then
    return 1
  fi

  printf '%s' "$http_code"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --alert)
      send_alert=1
      shift
      ;;
    --no-alert)
      send_alert=0
      shift
      ;;
    --soft)
      soft_exit=1
      shift
      ;;
    --json)
      json_output=1
      shift
      ;;
    --window-hours)
      [[ $# -lt 2 ]] && { echo "[slo] missing value for --window-hours"; usage; exit 1; }
      manual_window_hours="$(trim "$2")"
      shift 2
      ;;
    --url)
      [[ $# -lt 2 ]] && { echo "[slo] missing value for --url"; usage; exit 1; }
      manual_base_url="$(trim "$2")"
      shift 2
      ;;
    --token)
      [[ $# -lt 2 ]] && { echo "[slo] missing value for --token"; usage; exit 1; }
      manual_token="$2"
      shift 2
      ;;
    --route)
      [[ $# -lt 2 ]] && { echo "[slo] missing value for --route"; usage; exit 1; }
      manual_route="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
      manual_route="$(trim "$manual_route")"
      shift 2
      ;;
    --local)
      manual_query_mode="local"
      shift
      ;;
    --remote)
      manual_query_mode="remote"
      shift
      ;;
    --auto)
      manual_query_mode="auto"
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[slo] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_positive_int "VPS_SLO_HTTP_TIMEOUT_SECONDS" "$VPS_SLO_HTTP_TIMEOUT_SECONDS"
require_positive_int "VPS_SLO_CONTEXT_MAX_CHARS" "$VPS_SLO_CONTEXT_MAX_CHARS"
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

VPS_SLO_ALERT_ON_WARN="$(read_bool "$VPS_SLO_ALERT_ON_WARN" 1)"
VPS_SLO_ALERT_ON_CRITICAL="$(read_bool "$VPS_SLO_ALERT_ON_CRITICAL" 1)"
VPS_SLO_ALERT_ON_OK="$(read_bool "$VPS_SLO_ALERT_ON_OK" 0)"

base_url="$(trim "${manual_base_url:-$VPS_SLO_BASE_URL}")"
base_url="${base_url%/}"
endpoint_path="${VPS_SLO_ENDPOINT_PATH:-/api/ops/slo}"

window_hours="$(trim "${manual_window_hours:-$VPS_SLO_WINDOW_HOURS}")"
if [[ -n "$window_hours" && ! "$window_hours" =~ ^[0-9]+$ ]]; then
  echo "[slo] window hours must be a positive integer: $window_hours"
  exit 1
fi

token="${manual_token:-$VPS_SLO_TOKEN}"
query_mode="$(trim "${manual_query_mode:-$VPS_SLO_QUERY_MODE}")"
query_mode="$(printf '%s' "$query_mode" | tr '[:upper:]' '[:lower:]')"
case "$query_mode" in
  local|remote|auto) ;;
  *)
    echo "[slo] invalid query mode: $query_mode (use local|remote|auto)"
    exit 1
    ;;
esac

query=""
if [[ -n "$window_hours" ]]; then
  query="?windowHours=$window_hours"
fi

url="$base_url$endpoint_path$query"
echo "[slo] endpoint: $url"
echo "[slo] query_mode: $query_mode"

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT
http_code=""
query_source=""

if [[ "$query_mode" == "local" ]]; then
  http_code="$(query_local "$url" "$token" "$response_file")" || {
    echo "[slo] failed to query SLO endpoint (local mode)"
    exit 1
  }
  query_source="local"
elif [[ "$query_mode" == "remote" ]]; then
  http_code="$(query_remote "$url" "$token" "$response_file")" || {
    echo "[slo] failed to query SLO endpoint (remote mode host=$VPS_HOST)"
    exit 1
  }
  query_source="remote:$VPS_HOST"
else
  if http_code="$(query_local "$url" "$token" "$response_file")"; then
    query_source="local"
  else
    echo "[slo] local endpoint query failed; retrying via SSH host=$VPS_HOST"
    http_code="$(query_remote "$url" "$token" "$response_file")" || {
      echo "[slo] failed to query SLO endpoint (auto mode local+remote exhausted)"
      exit 1
    }
    query_source="remote:$VPS_HOST"
  fi
fi

echo "[slo] query_source: $query_source"

if [[ -z "${http_code:-}" ]]; then
  echo "[slo] failed to query SLO endpoint"
  exit 1
fi

if [[ "$http_code" != "200" ]]; then
  body="$(<"$response_file")"
  body="$(truncate_value "$body" 800)"
  echo "[slo] endpoint returned HTTP $http_code"
  echo "[slo] body: $body"
  if [[ "$http_code" == "401" || "$http_code" == "403" ]]; then
    echo "[slo] hint: set VPS_SLO_TOKEN in .vps.env (matches server env VPS_SLO_TOKEN) or call with an ops session."
  fi
  exit 1
fi

response_json="$(<"$response_file")"
if [[ "$json_output" -eq 1 ]]; then
  printf '%s\n' "$response_json"
fi

kv_lines="$(
  RESPONSE_JSON="$response_json" node <<'NODE'
const raw = process.env.RESPONSE_JSON ?? "";

function b64(v) {
  return Buffer.from(String(v ?? ""), "utf8").toString("base64");
}

function compact(v) {
  const text = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 800 ? `${text.slice(0, 800)}...[truncated]` : text;
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error(`parse_error=${compact(err && err.message ? err.message : err)}`);
  process.exit(2);
}

if (!data || data.ok !== true || !data.snapshot || !data.snapshot.burn) {
  const msg = data && data.error ? data.error : "missing snapshot payload";
  console.error(`payload_error=${compact(msg)}`);
  process.exit(3);
}

const snapshot = data.snapshot;
const burn = snapshot.burn || {};
const objectives = Array.isArray(snapshot.objectives) ? snapshot.objectives : [];

const objectiveLines = objectives.map((objective) => {
  if (!objective || typeof objective !== "object") return "";
  if (objective.kind === "percent") {
    const current = objective.currentPct === null || objective.currentPct === undefined
      ? "n/a"
      : `${Number(objective.currentPct).toFixed(2)}%`;
    return `${objective.key}: ${current} target=${objective.targetPct}% status=${objective.status}`;
  }
  const current = objective.currentMinutes === null || objective.currentMinutes === undefined
    ? "n/a"
    : `${Number(objective.currentMinutes).toFixed(2)}m`;
  return `${objective.key}: ${current} target=${objective.targetMinutes}m status=${objective.status}`;
}).filter(Boolean);

const summary = compact(data.summary || "");
const reason = compact(burn.reason || "");
const title = compact(burn.title || "SLO status");
const context = compact([
  summary,
  `severity=${burn.severity || "ok"}`,
  `route=${burn.route || "none"}`,
  `maxBurnRate=${burn.maxBurnRate ?? 0}`,
  ...objectiveLines,
].join(" | "));

console.log(`severity=${burn.severity || "ok"}`);
console.log(`should_alert=${burn.shouldAlert ? "1" : "0"}`);
console.log(`route=${burn.route || "none"}`);
console.log(`max_burn=${burn.maxBurnRate ?? 0}`);
console.log(`title_b64=${b64(title)}`);
console.log(`reason_b64=${b64(reason)}`);
console.log(`summary_b64=${b64(summary)}`);
console.log(`context_b64=${b64(context)}`);
NODE
)" || {
  echo "[slo] failed to parse SLO response"
  exit 1
}

severity=""
should_alert="0"
route="none"
max_burn="0"
title_b64=""
reason_b64=""
summary_b64=""
context_b64=""

while IFS='=' read -r key value; do
  case "$key" in
    severity) severity="$value" ;;
    should_alert) should_alert="$value" ;;
    route) route="$value" ;;
    max_burn) max_burn="$value" ;;
    title_b64) title_b64="$value" ;;
    reason_b64) reason_b64="$value" ;;
    summary_b64) summary_b64="$value" ;;
    context_b64) context_b64="$value" ;;
  esac
done <<< "$kv_lines"

title="$(b64_decode "$title_b64" || printf 'SLO status')"
reason="$(b64_decode "$reason_b64" || printf '')"
summary="$(b64_decode "$summary_b64" || printf '')"
context="$(b64_decode "$context_b64" || printf '')"
context="$(truncate_value "$context" "$VPS_SLO_CONTEXT_MAX_CHARS")"

echo "[slo] severity=$severity route=$route should_alert=$should_alert max_burn=$max_burn"
if [[ -n "$summary" ]]; then
  echo "[slo] summary: $summary"
fi
if [[ -n "$reason" ]]; then
  echo "[slo] reason: $reason"
fi

alert_route="$route"
if [[ -n "$manual_route" ]]; then
  case "$manual_route" in
    none|webhook|email|both|auto)
      alert_route="$manual_route"
      ;;
    *)
      echo "[slo] invalid --route: $manual_route"
      exit 1
      ;;
  esac
fi

should_send_alert=0
if [[ "$send_alert" -eq 1 ]]; then
  case "$severity" in
    critical)
      [[ "$VPS_SLO_ALERT_ON_CRITICAL" == "1" ]] && should_send_alert=1
      ;;
    warn)
      [[ "$VPS_SLO_ALERT_ON_WARN" == "1" ]] && should_send_alert=1
      ;;
    ok)
      [[ "$VPS_SLO_ALERT_ON_OK" == "1" ]] && should_send_alert=1
      ;;
  esac
  if [[ "$severity" != "ok" && "$should_alert" != "1" ]]; then
    should_send_alert=0
  fi
fi

if [[ "$should_send_alert" -eq 1 ]]; then
  alert_severity="$severity"
  if [[ "$alert_severity" == "ok" ]]; then
    alert_severity="info"
  fi
  if ! "$ROOT_DIR/scripts/vps-alert.sh" \
    --severity "$alert_severity" \
    --route "$alert_route" \
    --title "$title" \
    --detail "$reason" \
    --context "$context"; then
    echo "[slo] alert delivery failed"
    exit 1
  fi
fi

exit_code=0
case "$severity" in
  critical) exit_code=31 ;;
  warn) exit_code=30 ;;
  ok) exit_code=0 ;;
  *)
    echo "[slo] unknown severity: $severity"
    exit 1
    ;;
esac

if [[ "$soft_exit" -eq 1 ]]; then
  exit 0
fi

exit "$exit_code"
