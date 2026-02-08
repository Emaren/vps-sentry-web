#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_BACKUP_BASE="${VPS_BACKUP_BASE:-/home/tony/_backup/vps-sentry-web}"
VPS_RPO_TARGET_MINUTES="${VPS_RPO_TARGET_MINUTES:-60}"
VPS_RTO_TARGET_MINUTES="${VPS_RTO_TARGET_MINUTES:-15}"
VPS_RESTORE_DRILL_MAX_AGE_HOURS="${VPS_RESTORE_DRILL_MAX_AGE_HOURS:-192}"
VPS_LOCAL_EXEC="${VPS_LOCAL_EXEC:-0}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

should_alert=0
soft_exit=0
json_output=0
alert_on_pass=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-rpo-rto-report.sh [--alert] [--alert-on-pass] [--soft] [--json]

Builds an objective recovery report from backup/restore marker files:
- backup freshness age (RPO actual)
- last restore drill runtime (RTO actual)
- restore drill recency age
- target compliance status and overall PASS/FAIL

Exit codes:
  0  overall PASS (or --soft)
  43 overall FAIL
  1  command/query error
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
    echo "[rpo-rto] $name must be a positive integer: $value"
    exit 1
  fi
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

remote() {
  if [[ "${VPS_LOCAL_EXEC}" == "1" ]]; then
    bash -lc "$*"
    return $?
  fi

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

    echo "[rpo-rto] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
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
    --alert-on-pass)
      alert_on_pass=1
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
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[rpo-rto] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_positive_int "VPS_RPO_TARGET_MINUTES" "$VPS_RPO_TARGET_MINUTES"
require_positive_int "VPS_RTO_TARGET_MINUTES" "$VPS_RTO_TARGET_MINUTES"
require_positive_int "VPS_RESTORE_DRILL_MAX_AGE_HOURS" "$VPS_RESTORE_DRILL_MAX_AGE_HOURS"
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

echo "[rpo-rto] host: $VPS_HOST"
echo "[rpo-rto] backup_base: $VPS_BACKUP_BASE"
echo "[rpo-rto] local_exec: $VPS_LOCAL_EXEC"

report_lines="$(
  remote "VPS_BACKUP_BASE=$(printf %q "$VPS_BACKUP_BASE") VPS_RPO_TARGET_MINUTES=$(printf %q "$VPS_RPO_TARGET_MINUTES") VPS_RTO_TARGET_MINUTES=$(printf %q "$VPS_RTO_TARGET_MINUTES") VPS_RESTORE_DRILL_MAX_AGE_HOURS=$(printf %q "$VPS_RESTORE_DRILL_MAX_AGE_HOURS") bash -s" <<'REMOTE_EOF'
set -euo pipefail

read_int_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    printf '%s\n' ""
    return 0
  fi
  local raw
  raw="$(tr -d '[:space:]' < "$path" || true)"
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$raw"
    return 0
  fi
  printf '%s\n' ""
}

read_text_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    printf '%s\n' ""
    return 0
  fi
  tr -d '\r' < "$path" | head -n1
}

age_seconds_or_neg1() {
  local now_epoch="$1"
  local target_epoch="$2"
  if [[ -z "$target_epoch" ]]; then
    printf '%s\n' "-1"
    return
  fi
  local age=$((now_epoch - target_epoch))
  if (( age < 0 )); then
    age=0
  fi
  printf '%s\n' "$age"
}

now_epoch="$(date +%s)"
now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

backup_epoch="$(read_int_file "$VPS_BACKUP_BASE/last_success_epoch")"
backup_iso="$(read_text_file "$VPS_BACKUP_BASE/last_success_iso")"
backup_path="$(read_text_file "$VPS_BACKUP_BASE/last_success_path")"
backup_age_seconds="$(age_seconds_or_neg1 "$now_epoch" "$backup_epoch")"

restore_last_run_epoch="$(read_int_file "$VPS_BACKUP_BASE/restore_last_run_epoch")"
restore_last_run_iso="$(read_text_file "$VPS_BACKUP_BASE/restore_last_run_iso")"
restore_last_run_status="$(read_text_file "$VPS_BACKUP_BASE/restore_last_run_status")"
restore_last_run_rto_seconds="$(read_int_file "$VPS_BACKUP_BASE/restore_last_run_rto_seconds")"
restore_last_run_rpo_seconds="$(read_int_file "$VPS_BACKUP_BASE/restore_last_run_rpo_seconds")"

restore_last_success_epoch="$(read_int_file "$VPS_BACKUP_BASE/restore_last_success_epoch")"
restore_last_success_iso="$(read_text_file "$VPS_BACKUP_BASE/restore_last_success_iso")"
restore_last_success_rto_seconds="$(read_int_file "$VPS_BACKUP_BASE/restore_last_success_rto_seconds")"
restore_last_success_rpo_seconds="$(read_int_file "$VPS_BACKUP_BASE/restore_last_success_rpo_seconds")"
restore_last_success_path="$(read_text_file "$VPS_BACKUP_BASE/restore_last_success_backup_path")"
restore_age_seconds="$(age_seconds_or_neg1 "$now_epoch" "$restore_last_success_epoch")"

rpo_target_seconds=$((VPS_RPO_TARGET_MINUTES * 60))
rto_target_seconds=$((VPS_RTO_TARGET_MINUTES * 60))
drill_max_age_seconds=$((VPS_RESTORE_DRILL_MAX_AGE_HOURS * 3600))

rpo_actual_seconds="$backup_age_seconds"
if [[ "$rpo_actual_seconds" -lt 0 && -n "$restore_last_success_rpo_seconds" ]]; then
  rpo_actual_seconds="$restore_last_success_rpo_seconds"
fi

rto_actual_seconds="-1"
if [[ -n "$restore_last_success_rto_seconds" ]]; then
  rto_actual_seconds="$restore_last_success_rto_seconds"
fi

rpo_status="FAIL"
if [[ "$rpo_actual_seconds" -ge 0 && "$rpo_actual_seconds" -le "$rpo_target_seconds" ]]; then
  rpo_status="PASS"
fi

rto_status="FAIL"
if [[ "$rto_actual_seconds" -ge 0 && "$rto_actual_seconds" -le "$rto_target_seconds" ]]; then
  rto_status="PASS"
fi

drill_recency_status="FAIL"
if [[ "$restore_age_seconds" -ge 0 && "$restore_age_seconds" -le "$drill_max_age_seconds" ]]; then
  drill_recency_status="PASS"
fi

last_run_status_eval="FAIL"
if [[ "$restore_last_run_status" == "PASS" ]]; then
  last_run_status_eval="PASS"
fi

overall="PASS"
reasons=()
if [[ "$rpo_status" != "PASS" ]]; then
  overall="FAIL"
  reasons+=("rpo_target_missed")
fi
if [[ "$rto_status" != "PASS" ]]; then
  overall="FAIL"
  reasons+=("rto_target_missed")
fi
if [[ "$drill_recency_status" != "PASS" ]]; then
  overall="FAIL"
  reasons+=("restore_drill_stale")
fi
if [[ "$last_run_status_eval" != "PASS" ]]; then
  overall="FAIL"
  reasons+=("last_restore_drill_failed")
fi

if [[ "${#reasons[@]}" -eq 0 ]]; then
  reason_text="none"
else
  IFS=","
  reason_text="${reasons[*]}"
  unset IFS
fi

printf 'generated_at=%s\n' "$now_iso"
printf 'backup_last_success_epoch=%s\n' "${backup_epoch:-}"
printf 'backup_last_success_iso=%s\n' "${backup_iso:-}"
printf 'backup_last_success_path=%s\n' "${backup_path:-}"
printf 'backup_age_seconds=%s\n' "$backup_age_seconds"
printf 'restore_last_run_epoch=%s\n' "${restore_last_run_epoch:-}"
printf 'restore_last_run_iso=%s\n' "${restore_last_run_iso:-}"
printf 'restore_last_run_status=%s\n' "${restore_last_run_status:-unknown}"
printf 'restore_last_run_rto_seconds=%s\n' "${restore_last_run_rto_seconds:-}"
printf 'restore_last_run_rpo_seconds=%s\n' "${restore_last_run_rpo_seconds:-}"
printf 'restore_last_success_epoch=%s\n' "${restore_last_success_epoch:-}"
printf 'restore_last_success_iso=%s\n' "${restore_last_success_iso:-}"
printf 'restore_last_success_path=%s\n' "${restore_last_success_path:-}"
printf 'restore_last_success_rto_seconds=%s\n' "${restore_last_success_rto_seconds:-}"
printf 'restore_last_success_rpo_seconds=%s\n' "${restore_last_success_rpo_seconds:-}"
printf 'restore_age_seconds=%s\n' "$restore_age_seconds"
printf 'rpo_actual_seconds=%s\n' "$rpo_actual_seconds"
printf 'rpo_target_seconds=%s\n' "$rpo_target_seconds"
printf 'rto_actual_seconds=%s\n' "$rto_actual_seconds"
printf 'rto_target_seconds=%s\n' "$rto_target_seconds"
printf 'drill_max_age_seconds=%s\n' "$drill_max_age_seconds"
printf 'rpo_status=%s\n' "$rpo_status"
printf 'rto_status=%s\n' "$rto_status"
printf 'drill_recency_status=%s\n' "$drill_recency_status"
printf 'last_run_status_eval=%s\n' "$last_run_status_eval"
printf 'overall=%s\n' "$overall"
printf 'reasons=%s\n' "$reason_text"
REMOTE_EOF
)"

if [[ -z "$report_lines" ]]; then
  echo "[rpo-rto] failed to read report payload"
  exit 1
fi

generated_at=""
backup_last_success_path=""
backup_last_success_iso=""
restore_last_success_path=""
rpo_actual_seconds="-1"
rpo_target_seconds="-1"
rto_actual_seconds="-1"
rto_target_seconds="-1"
restore_age_seconds="-1"
drill_max_age_seconds="-1"
overall="FAIL"
rpo_status="FAIL"
rto_status="FAIL"
drill_recency_status="FAIL"
last_run_status_eval="FAIL"
reasons="unknown"

while IFS='=' read -r key value; do
  case "$key" in
    generated_at) generated_at="$value" ;;
    backup_last_success_iso) backup_last_success_iso="$value" ;;
    backup_last_success_path) backup_last_success_path="$value" ;;
    restore_last_success_path) restore_last_success_path="$value" ;;
    rpo_actual_seconds) rpo_actual_seconds="$value" ;;
    rpo_target_seconds) rpo_target_seconds="$value" ;;
    rto_actual_seconds) rto_actual_seconds="$value" ;;
    rto_target_seconds) rto_target_seconds="$value" ;;
    restore_age_seconds) restore_age_seconds="$value" ;;
    drill_max_age_seconds) drill_max_age_seconds="$value" ;;
    overall) overall="$value" ;;
    rpo_status) rpo_status="$value" ;;
    rto_status) rto_status="$value" ;;
    drill_recency_status) drill_recency_status="$value" ;;
    last_run_status_eval) last_run_status_eval="$value" ;;
    reasons) reasons="$value" ;;
  esac
done <<< "$report_lines"
reasons="$(trim "$reasons")"

if [[ "$json_output" == "1" ]]; then
  printf '{'
  printf '"generated_at":"%s",' "$(json_escape "$generated_at")"
  printf '"overall":"%s",' "$(json_escape "$overall")"
  printf '"reasons":"%s",' "$(json_escape "$reasons")"
  printf '"rpo":{"actual_seconds":%s,"target_seconds":%s,"status":"%s"},' \
    "$rpo_actual_seconds" \
    "$rpo_target_seconds" \
    "$(json_escape "$rpo_status")"
  printf '"rto":{"actual_seconds":%s,"target_seconds":%s,"status":"%s"},' \
    "$rto_actual_seconds" \
    "$rto_target_seconds" \
    "$(json_escape "$rto_status")"
  printf '"restore_drill":{"age_seconds":%s,"max_age_seconds":%s,"recency_status":"%s","last_run_status":"%s"},' \
    "$restore_age_seconds" \
    "$drill_max_age_seconds" \
    "$(json_escape "$drill_recency_status")" \
    "$(json_escape "$last_run_status_eval")"
  printf '"backup_path":"%s",' "$(json_escape "$backup_last_success_path")"
  printf '"restore_path":"%s"' "$(json_escape "$restore_last_success_path")"
  printf '}\n'
else
  echo "[rpo-rto] generated_at: ${generated_at:-unknown}"
  echo "[rpo-rto] overall: $overall"
  echo "[rpo-rto] reasons: $reasons"
  echo "[rpo-rto] rpo_actual_seconds: ${rpo_actual_seconds:--1}"
  echo "[rpo-rto] rpo_target_seconds: ${rpo_target_seconds:--1}"
  echo "[rpo-rto] rpo_status: $rpo_status"
  echo "[rpo-rto] rto_actual_seconds: ${rto_actual_seconds:--1}"
  echo "[rpo-rto] rto_target_seconds: ${rto_target_seconds:--1}"
  echo "[rpo-rto] rto_status: $rto_status"
  echo "[rpo-rto] restore_age_seconds: ${restore_age_seconds:--1}"
  echo "[rpo-rto] drill_max_age_seconds: ${drill_max_age_seconds:--1}"
  echo "[rpo-rto] drill_recency_status: $drill_recency_status"
  echo "[rpo-rto] last_run_status_eval: $last_run_status_eval"
  echo "[rpo-rto] backup_path: ${backup_last_success_path:-unknown}"
  echo "[rpo-rto] restore_path: ${restore_last_success_path:-unknown}"
fi

if [[ "$should_alert" == "1" ]]; then
  if [[ "$overall" == "FAIL" ]]; then
    "$ROOT_DIR/scripts/vps-alert.sh" \
      --severity critical \
      --route auto \
      --title "RPO/RTO objective breach" \
      --detail "overall=FAIL reasons=$reasons" \
      --context "rpo=${rpo_actual_seconds:--1}/${rpo_target_seconds:--1}s status=$rpo_status | rto=${rto_actual_seconds:--1}/${rto_target_seconds:--1}s status=$rto_status | drill_age=${restore_age_seconds:--1}/${drill_max_age_seconds:--1}s status=$drill_recency_status | last_run=$last_run_status_eval" || true
  elif [[ "$alert_on_pass" == "1" ]]; then
    "$ROOT_DIR/scripts/vps-alert.sh" \
      --severity info \
      --route auto \
      --title "RPO/RTO objectives healthy" \
      --detail "overall=PASS" \
      --context "rpo=${rpo_actual_seconds:--1}/${rpo_target_seconds:--1}s | rto=${rto_actual_seconds:--1}/${rto_target_seconds:--1}s | drill_age=${restore_age_seconds:--1}/${drill_max_age_seconds:--1}s" || true
  fi
fi

exit_code=0
if [[ "$overall" == "FAIL" ]]; then
  exit_code=43
fi

if [[ "$soft_exit" == "1" ]]; then
  exit 0
fi

exit "$exit_code"
