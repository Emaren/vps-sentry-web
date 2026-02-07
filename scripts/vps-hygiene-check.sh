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
VPS_WEB_SERVICE="${VPS_WEB_SERVICE:-vps-sentry-web.service}"
VPS_ARCHIVE_BASE="${VPS_ARCHIVE_BASE:-/home/tony/_archive/vps-sentry}"
VPS_HYGIENE_MAX_DEPTH="${VPS_HYGIENE_MAX_DEPTH:-6}"
VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[hygiene] VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[hygiene] $name must be a positive integer: $value"
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

    echo "[hygiene] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

require_app_dir
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

echo "[hygiene] host: $VPS_HOST"
echo "[hygiene] app_dir: $VPS_APP_DIR"
echo "[hygiene] archive_base: $VPS_ARCHIVE_BASE"

remote \
  "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_WEB_SERVICE=$(printf %q "$VPS_WEB_SERVICE") VPS_ARCHIVE_BASE=$(printf %q "$VPS_ARCHIVE_BASE") VPS_HYGIENE_MAX_DEPTH=$(printf %q "$VPS_HYGIENE_MAX_DEPTH") bash -s" <<'REMOTE_EOF'
set -euo pipefail

fail=0

if [[ ! -d "$VPS_APP_DIR" ]]; then
  echo "[hygiene] app_dir_missing:$VPS_APP_DIR"
  exit 1
fi

if [[ ! -d "$VPS_APP_DIR/.git" ]]; then
  echo "[hygiene] app_dir_not_git:$VPS_APP_DIR"
  exit 1
fi

if ! systemctl is-active "$VPS_WEB_SERVICE" >/dev/null 2>&1; then
  echo "[hygiene] service_inactive:$VPS_WEB_SERVICE"
  fail=1
else
  echo "[hygiene] service_active:$VPS_WEB_SERVICE"
fi

service_wd="$(systemctl show -p WorkingDirectory --value "$VPS_WEB_SERVICE" 2>/dev/null || true)"
if [[ -n "$service_wd" && "$service_wd" != "$VPS_APP_DIR" ]]; then
  echo "[hygiene] service_workdir_mismatch: expected=$VPS_APP_DIR actual=$service_wd"
  fail=1
fi

dirty_status="$(git -C "$VPS_APP_DIR" status --porcelain || true)"
if [[ -n "$dirty_status" ]]; then
  only_generated=1
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    path="${line#?? }"
    if [[ "$path" != "next-env.d.ts" ]]; then
      only_generated=0
      break
    fi
  done <<<"$dirty_status"

  if [[ "$only_generated" -eq 1 ]]; then
    echo "[hygiene] remote_git_autoclean:next-env.d.ts"
    git -C "$VPS_APP_DIR" checkout -- next-env.d.ts || true
    clean_after="$(git -C "$VPS_APP_DIR" status --porcelain || true)"
    if [[ -n "$clean_after" ]]; then
      echo "[hygiene] remote_git_dirty_after_autoclean:$VPS_APP_DIR"
      echo "$clean_after"
      fail=1
    else
      echo "[hygiene] remote_git_clean:$VPS_APP_DIR"
    fi
  else
    echo "[hygiene] remote_git_dirty:$VPS_APP_DIR"
    echo "$dirty_status"
    fail=1
  fi
else
  echo "[hygiene] remote_git_clean:$VPS_APP_DIR"
fi

declare -a stale_paths=(
  "/var/www/vps-sentry-landing"
  "/home/tony/llama-scripts/vps-sentry-legacy"
)

for p in "${stale_paths[@]}"; do
  if [[ -e "$p" ]]; then
    echo "[hygiene] stale_path_present:$p"
    fail=1
  else
    echo "[hygiene] stale_path_absent:$p"
  fi
done

legacy_hits="$(
  find /var/www /home/tony -maxdepth "$VPS_HYGIENE_MAX_DEPTH" -type d \
    \( -name "vps-sentry-landing" -o -name "vps-sentry-legacy*" \) 2>/dev/null \
    | grep -Ev "^${VPS_ARCHIVE_BASE}(/|$)" || true
)"

if [[ -n "$legacy_hits" ]]; then
  echo "[hygiene] non_archived_legacy_matches:"
  echo "$legacy_hits"
  fail=1
else
  echo "[hygiene] non_archived_legacy_matches:none"
fi

if [[ ! -d "$VPS_ARCHIVE_BASE" ]]; then
  echo "[hygiene] archive_base_missing:$VPS_ARCHIVE_BASE"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[hygiene] FAIL"
  exit 1
fi

echo "[hygiene] PASS"
REMOTE_EOF
