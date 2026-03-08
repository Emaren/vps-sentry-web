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

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[smoke] $name must be a positive integer: $value"
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

    echo "[smoke] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"
require_positive_int "VPS_WEB_PORT" "$VPS_WEB_PORT"

report="$(
  run_remote "VPS_WEB_PORT=$(printf %q "$VPS_WEB_PORT") bash -s" <<'REMOTE_EOF'
set -euo pipefail

ready_file="$(mktemp)"
trap 'rm -f "$ready_file"' EXIT

root_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/" || echo 000)"
login_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/login" || echo 000)"
readyz_code="$(curl -sS -o "$ready_file" -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/api/readyz?check=status" || echo 000)"
status_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VPS_WEB_PORT}/api/status" || echo 000)"

set +e
readyz_detail="$(python3 - "$ready_file" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
except Exception as exc:
    print(f"json_error:{exc}")
    raise SystemExit(3)

checks = payload.get("checks") or {}
status = checks.get("status") or {}
files = status.get("files") or {}
missing = [name for name in ("status", "last", "diff") if files.get(name) is not True]
ok = bool(payload.get("ok")) and bool(status.get("ok")) and not missing

if ok:
    print("ok")
    raise SystemExit(0)

detail = status.get("error") or "status_files_unhealthy"
if missing:
    detail = f"{detail};missing={','.join(missing)}"
print(detail)
raise SystemExit(4)
PY
)"
readyz_detail_rc=$?
set -e

printf 'root_code=%s\n' "$root_code"
printf 'login_code=%s\n' "$login_code"
printf 'readyz_code=%s\n' "$readyz_code"
printf 'status_code=%s\n' "$status_code"
printf 'readyz_detail=%s\n' "$readyz_detail"
printf 'readyz_detail_rc=%s\n' "$readyz_detail_rc"
REMOTE_EOF
)" || {
  echo "[smoke] FAIL: unable to execute remote smoke checks over SSH"
  exit 1
}

root_code="$(printf '%s\n' "$report" | sed -n 's/^root_code=//p' | tail -n 1)"
login_code="$(printf '%s\n' "$report" | sed -n 's/^login_code=//p' | tail -n 1)"
readyz_code="$(printf '%s\n' "$report" | sed -n 's/^readyz_code=//p' | tail -n 1)"
status_code="$(printf '%s\n' "$report" | sed -n 's/^status_code=//p' | tail -n 1)"
readyz_detail="$(printf '%s\n' "$report" | sed -n 's/^readyz_detail=//p' | tail -n 1)"
readyz_detail_rc="$(printf '%s\n' "$report" | sed -n 's/^readyz_detail_rc=//p' | tail -n 1)"

echo "[smoke] / => $root_code"
echo "[smoke] /login => $login_code"
echo "[smoke] /api/readyz?check=status => $readyz_code ($readyz_detail)"
echo "[smoke] /api/status => $status_code"

if [[ "$root_code" != "200" && "$root_code" != "307" ]]; then
  echo "[smoke] FAIL: unexpected / status $root_code"
  exit 1
fi

if [[ "$login_code" != "200" ]]; then
  echo "[smoke] FAIL: unexpected /login status $login_code"
  exit 1
fi

if [[ "$readyz_code" != "200" || "$readyz_detail_rc" != "0" ]]; then
  echo "[smoke] FAIL: unexpected /api/readyz?check=status status $readyz_code detail=$readyz_detail"
  exit 1
fi

# /api/status may be auth-protected (401) or open (200). Both are acceptable for smoke.
if [[ "$status_code" != "200" && "$status_code" != "401" ]]; then
  echo "[smoke] FAIL: unexpected /api/status status $status_code"
  exit 1
fi

echo "[smoke] PASS"
