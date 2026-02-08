#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_ALERT_SUBJECT_PREFIX="${VPS_ALERT_SUBJECT_PREFIX:-[VPS Sentry]}"
VPS_ALERT_WEBHOOK_URLS="${VPS_ALERT_WEBHOOK_URLS:-}"
VPS_ALERT_EMAIL_TO="${VPS_ALERT_EMAIL_TO:-}"
VPS_ALERT_EMAIL_FROM="${VPS_ALERT_EMAIL_FROM:-}"
VPS_ALERT_LOG_PATH="${VPS_ALERT_LOG_PATH:-$ROOT_DIR/.ops-alerts.log}"
VPS_ALERT_CURL_TIMEOUT_SECONDS="${VPS_ALERT_CURL_TIMEOUT_SECONDS:-10}"
VPS_ALERT_MAX_DETAIL_CHARS="${VPS_ALERT_MAX_DETAIL_CHARS:-5000}"
VPS_ALERT_DEFAULT_ROUTE="${VPS_ALERT_DEFAULT_ROUTE:-both}"
VPS_ALERT_ROUTE_INFO="${VPS_ALERT_ROUTE_INFO:-webhook}"
VPS_ALERT_ROUTE_WARN="${VPS_ALERT_ROUTE_WARN:-both}"
VPS_ALERT_ROUTE_CRITICAL="${VPS_ALERT_ROUTE_CRITICAL:-both}"

severity="warn"
route="$VPS_ALERT_DEFAULT_ROUTE"
title=""
detail=""
context=""

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-alert.sh --title "..." [--severity info|warn|critical] [--route none|webhook|email|both|auto] [--detail "..."] [--context "..."]

Env:
  VPS_ALERT_WEBHOOK_URLS         List of webhooks (split by comma, newline, or ||)
  VPS_ALERT_EMAIL_TO             Optional recipient list for local mail/sendmail delivery
  VPS_ALERT_EMAIL_FROM           Optional From override for sendmail path
  VPS_ALERT_SUBJECT_PREFIX       Default: [VPS Sentry]
  VPS_ALERT_LOG_PATH             Default: ./.ops-alerts.log
  VPS_ALERT_CURL_TIMEOUT_SECONDS Default: 10
  VPS_ALERT_DEFAULT_ROUTE        Default routing when --route is omitted (default: both)
  VPS_ALERT_ROUTE_INFO           Route used when --route auto and severity=info
  VPS_ALERT_ROUTE_WARN           Route used when --route auto and severity=warn
  VPS_ALERT_ROUTE_CRITICAL       Route used when --route auto and severity=critical
USAGE
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[alert] $name must be a positive integer: $value"
    exit 1
  fi
}

trim() {
  local value="$1"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
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

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

split_targets() {
  local raw="$1"
  printf '%s\n' "$raw" | sed -e 's/||/\n/g' -e 's/,/\n/g' | while IFS= read -r line; do
    local t
    t="$(trim "$line")"
    [[ -z "$t" ]] && continue
    printf '%s\n' "$t"
  done
}

send_webhook() {
  local url="$1"
  local payload="$2"

  local response_path
  response_path="$(mktemp)"

  local code
  code="$({ curl -sS -o "$response_path" -w '%{http_code}' --max-time "$VPS_ALERT_CURL_TIMEOUT_SECONDS" -X POST -H 'content-type: application/json' --data "$payload" "$url"; } 2>&1)" || {
    rm -f "$response_path"
    echo "[alert] webhook_error:$url:$code"
    return 1
  }

  if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
    rm -f "$response_path"
    echo "[alert] webhook_ok:$url:$code"
    return 0
  fi

  local body
  body="$(<"$response_path")"
  rm -f "$response_path"
  body="$(truncate_value "$body" 600)"
  echo "[alert] webhook_fail:$url:$code body=$body"
  return 1
}

send_email_with_mail() {
  local to="$1"
  local subject="$2"
  local body="$3"

  if ! command -v mail >/dev/null 2>&1; then
    return 1
  fi

  printf '%s\n' "$body" | mail -s "$subject" "$to"
}

send_email_with_sendmail() {
  local to="$1"
  local subject="$2"
  local body="$3"

  if ! command -v sendmail >/dev/null 2>&1; then
    return 1
  fi

  local from="${VPS_ALERT_EMAIL_FROM:-vps-sentry@localhost}"
  {
    printf 'From: %s\n' "$from"
    printf 'To: %s\n' "$to"
    printf 'Subject: %s\n' "$subject"
    printf 'Content-Type: text/plain; charset=UTF-8\n'
    printf '\n'
    printf '%s\n' "$body"
  } | sendmail -t
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --severity)
      [[ $# -lt 2 ]] && { echo "[alert] missing value for --severity"; usage; exit 1; }
      severity="$(trim "$2")"
      shift 2
      ;;
    --route)
      [[ $# -lt 2 ]] && { echo "[alert] missing value for --route"; usage; exit 1; }
      route="$(trim "$2")"
      shift 2
      ;;
    --title)
      [[ $# -lt 2 ]] && { echo "[alert] missing value for --title"; usage; exit 1; }
      title="$2"
      shift 2
      ;;
    --detail)
      [[ $# -lt 2 ]] && { echo "[alert] missing value for --detail"; usage; exit 1; }
      detail="$2"
      shift 2
      ;;
    --context)
      [[ $# -lt 2 ]] && { echo "[alert] missing value for --context"; usage; exit 1; }
      context="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[alert] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

case "$severity" in
  info|warn|critical) ;;
  *)
    echo "[alert] invalid severity: $severity"
    usage
    exit 1
    ;;
esac

case "$route" in
  none|webhook|email|both|auto) ;;
  *)
    echo "[alert] invalid route: $route"
    usage
    exit 1
    ;;
esac

require_positive_int "VPS_ALERT_CURL_TIMEOUT_SECONDS" "$VPS_ALERT_CURL_TIMEOUT_SECONDS"
require_positive_int "VPS_ALERT_MAX_DETAIL_CHARS" "$VPS_ALERT_MAX_DETAIL_CHARS"

title="$(trim "$title")"
if [[ -z "$title" ]]; then
  echo "[alert] title is required"
  usage
  exit 1
fi

detail="$(truncate_value "$(trim "$detail")" "$VPS_ALERT_MAX_DETAIL_CHARS")"
context="$(truncate_value "$(trim "$context")" 4000)"

hostname_value="$(hostname 2>/dev/null || echo unknown-host)"
ts_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
subject="$VPS_ALERT_SUBJECT_PREFIX [$severity] $title"

resolved_route="$route"
if [[ "$resolved_route" == "auto" ]]; then
  case "$severity" in
    info) resolved_route="$VPS_ALERT_ROUTE_INFO" ;;
    warn) resolved_route="$VPS_ALERT_ROUTE_WARN" ;;
    critical) resolved_route="$VPS_ALERT_ROUTE_CRITICAL" ;;
  esac
fi

case "$resolved_route" in
  none|webhook|email|both) ;;
  *)
    echo "[alert] resolved route is invalid: $resolved_route"
    exit 1
    ;;
esac

if [[ "$resolved_route" == "none" ]]; then
  echo "[alert] skipped (route=none)"
  exit 0
fi

payload="{\"type\":\"ops.alert\",\"severity\":\"$(json_escape "$severity")\",\"title\":\"$(json_escape "$title")\",\"detail\":\"$(json_escape "$detail")\",\"context\":\"$(json_escape "$context")\",\"host\":\"$(json_escape "$hostname_value")\",\"ts\":\"$(json_escape "$ts_iso")\"}"

log_line="[$ts_iso] severity=$severity route=$resolved_route title=$(truncate_value "$title" 180) detail=$(truncate_value "$detail" 280)"
printf '%s\n' "$log_line" >> "$VPS_ALERT_LOG_PATH"

want_webhook=0
want_email=0
case "$resolved_route" in
  webhook)
    want_webhook=1
    ;;
  email)
    want_email=1
    ;;
  both)
    want_webhook=1
    want_email=1
    ;;
esac

webhook_sent=0
webhook_failed=0
if [[ "$want_webhook" -eq 1 ]]; then
  if [[ -z "$(trim "$VPS_ALERT_WEBHOOK_URLS")" ]]; then
    echo "[alert] webhook route selected but VPS_ALERT_WEBHOOK_URLS is empty"
    webhook_failed=1
  else
    while IFS= read -r webhook_url; do
      [[ -z "$webhook_url" ]] && continue
      if send_webhook "$webhook_url" "$payload"; then
        webhook_sent=$((webhook_sent + 1))
      else
        webhook_failed=$((webhook_failed + 1))
      fi
    done < <(split_targets "$VPS_ALERT_WEBHOOK_URLS")
  fi
fi

email_sent=0
email_failed=0
if [[ "$want_email" -eq 1 ]]; then
  if [[ -z "$(trim "$VPS_ALERT_EMAIL_TO")" ]]; then
    echo "[alert] email route selected but VPS_ALERT_EMAIL_TO is empty"
    email_failed=1
  fi
fi

if [[ "$want_email" -eq 1 && -n "$(trim "$VPS_ALERT_EMAIL_TO")" ]]; then
  email_body="$subject

Time: $ts_iso
Host: $hostname_value
Severity: $severity

Title:
$title

Detail:
$detail"

  if [[ -n "$context" ]]; then
    email_body="$email_body

Context:
$context"
  fi

  if send_email_with_mail "$VPS_ALERT_EMAIL_TO" "$subject" "$email_body"; then
    echo "[alert] email_ok:mail"
    email_sent=1
  elif send_email_with_sendmail "$VPS_ALERT_EMAIL_TO" "$subject" "$email_body"; then
    echo "[alert] email_ok:sendmail"
    email_sent=1
  else
    echo "[alert] email_fail:no mail or sendmail transport available"
    email_failed=1
  fi
fi

attempted=$((webhook_sent + webhook_failed + email_sent + email_failed))
success_total=$((webhook_sent + email_sent))
failed_total=$((webhook_failed + email_failed))

if [[ "$attempted" -eq 0 ]]; then
  echo "[alert] no delivery attempts were made"
  exit 2
fi

if [[ "$failed_total" -gt 0 && "$success_total" -eq 0 ]]; then
  echo "[alert] all selected channels failed"
  exit 1
fi

if [[ "$failed_total" -gt 0 ]]; then
  echo "[alert] partial delivery: success=$success_total failed=$failed_total"
fi

if [[ "$webhook_failed" -gt 0 || "$email_failed" -gt 0 ]]; then
  echo "[alert] partial_failure webhooks_ok=$webhook_sent webhooks_failed=$webhook_failed email_ok=$email_sent email_failed=$email_failed"
  exit 1
fi

echo "[alert] PASS webhooks_ok=$webhook_sent email_ok=$email_sent"
