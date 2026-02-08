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
VPS_SERVICE="${VPS_SERVICE:-}"
VPS_BACKUP_BASE="${VPS_BACKUP_BASE:-/home/tony/_backup/vps-sentry-web}"
VPS_BACKUP_KEEP_DAYS="${VPS_BACKUP_KEEP_DAYS:-14}"
VPS_SQLITE_DB_PATH="${VPS_SQLITE_DB_PATH:-$VPS_APP_DIR/prisma/dev.db}"
VPS_POSTGRES_DATABASE_URL="${VPS_POSTGRES_DATABASE_URL:-}"
VPS_LOCAL_EXEC="${VPS_LOCAL_EXEC:-0}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

mode="apply"
label=""

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-backup.sh [--dry-run|--apply] [--label token] [--keep-days N]

Creates a VPS backup snapshot under VPS_BACKUP_BASE:
- app archive (without node_modules/.next cache)
- sqlite snapshot (if file exists)
- postgres SQL dump (if VPS_POSTGRES_DATABASE_URL is set and pg_dump exists)
- metadata + checksums + latest success marker

Env:
  VPS_HOST
  VPS_LOCAL_EXEC               Set to 1 to run directly on current host (no SSH hop)
  VPS_APP_DIR
  VPS_BACKUP_BASE
  VPS_BACKUP_KEEP_DAYS
  VPS_SQLITE_DB_PATH
  VPS_POSTGRES_DATABASE_URL
USAGE
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "[backup] VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[backup] $name must be a positive integer: $value"
    exit 1
  fi
}

sanitize_label() {
  local raw="$1"
  raw="${raw//[^A-Za-z0-9._-]/-}"
  raw="${raw#-}"
  raw="${raw%-}"
  printf '%s' "$raw"
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

    echo "[backup] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      mode="dry-run"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --label)
      [[ $# -lt 2 ]] && { echo "[backup] missing value for --label"; usage; exit 1; }
      label="$2"
      shift 2
      ;;
    --keep-days)
      [[ $# -lt 2 ]] && { echo "[backup] missing value for --keep-days"; usage; exit 1; }
      VPS_BACKUP_KEEP_DAYS="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[backup] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_app_dir
require_positive_int "VPS_BACKUP_KEEP_DAYS" "$VPS_BACKUP_KEEP_DAYS"
require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

label="$(sanitize_label "$label")"

echo "[backup] host: $VPS_HOST"
echo "[backup] app_dir: $VPS_APP_DIR"
echo "[backup] backup_base: $VPS_BACKUP_BASE"
echo "[backup] keep_days: $VPS_BACKUP_KEEP_DAYS"
echo "[backup] mode: $mode"
echo "[backup] local_exec: $VPS_LOCAL_EXEC"

remote "VPS_APP_DIR=$(printf %q "$VPS_APP_DIR") VPS_SERVICE=$(printf %q "$VPS_SERVICE") VPS_BACKUP_BASE=$(printf %q "$VPS_BACKUP_BASE") VPS_BACKUP_KEEP_DAYS=$(printf %q "$VPS_BACKUP_KEEP_DAYS") VPS_SQLITE_DB_PATH=$(printf %q "$VPS_SQLITE_DB_PATH") VPS_POSTGRES_DATABASE_URL=$(printf %q "$VPS_POSTGRES_DATABASE_URL") VPS_BACKUP_MODE=$(printf %q "$mode") VPS_BACKUP_LABEL=$(printf %q "$label") bash -s" <<'REMOTE_EOF'
set -euo pipefail

if [[ ! -d "$VPS_APP_DIR" ]]; then
  echo "[backup] app_dir_missing:$VPS_APP_DIR"
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_name="$timestamp"
if [[ -n "$VPS_BACKUP_LABEL" ]]; then
  run_name="${run_name}-${VPS_BACKUP_LABEL}"
fi
run_dir="$VPS_BACKUP_BASE/$run_name"

if [[ "$VPS_BACKUP_MODE" == "dry-run" ]]; then
  echo "[backup] dry_run_target:$run_dir"
else
  mkdir -p "$run_dir"
fi

host_value="$(hostname 2>/dev/null || echo unknown-host)"
branch="$(git -C "$VPS_APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
commit="$(git -C "$VPS_APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [[ "$VPS_BACKUP_MODE" == "dry-run" ]]; then
  echo "[backup] would_write:metadata.env"
else
  {
    printf 'created_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'host=%s\n' "$host_value"
    printf 'app_dir=%s\n' "$VPS_APP_DIR"
    printf 'branch=%s\n' "$branch"
    printf 'commit=%s\n' "$commit"
    printf 'service=%s\n' "$VPS_SERVICE"
  } > "$run_dir/metadata.env"
fi

echo "[backup] git:$branch@$commit"

if [[ "$VPS_BACKUP_MODE" == "dry-run" ]]; then
  echo "[backup] would_write:app.tar.gz"
else
  tar \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.next/cache' \
    -czf "$run_dir/app.tar.gz" \
    -C "$VPS_APP_DIR" .
  echo "[backup] wrote:app.tar.gz"
fi

if [[ -n "$VPS_SERVICE" ]]; then
  if [[ "$VPS_BACKUP_MODE" == "dry-run" ]]; then
    echo "[backup] would_write:service.unit.txt"
  else
    systemctl cat "$VPS_SERVICE" > "$run_dir/service.unit.txt" 2>/dev/null || true
  fi
fi

if [[ -f "$VPS_SQLITE_DB_PATH" ]]; then
  if [[ "$VPS_BACKUP_MODE" == "dry-run" ]]; then
    echo "[backup] would_write:sqlite.db"
  else
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$VPS_SQLITE_DB_PATH" ".backup '$run_dir/sqlite.db'"
    else
      cp "$VPS_SQLITE_DB_PATH" "$run_dir/sqlite.db"
    fi
    echo "[backup] wrote:sqlite.db"
  fi
else
  echo "[backup] sqlite_skip:file_missing:$VPS_SQLITE_DB_PATH"
fi

if [[ -n "$VPS_POSTGRES_DATABASE_URL" ]]; then
  if command -v pg_dump >/dev/null 2>&1; then
    if [[ "$VPS_BACKUP_MODE" == "dry-run" ]]; then
      echo "[backup] would_write:postgres.sql"
    else
      pg_dump "$VPS_POSTGRES_DATABASE_URL" --no-owner --no-privileges --format=plain --file "$run_dir/postgres.sql"
      echo "[backup] wrote:postgres.sql"
    fi
  else
    echo "[backup] postgres_skip:pg_dump_missing"
  fi
else
  echo "[backup] postgres_skip:url_missing"
fi

if [[ "$VPS_BACKUP_MODE" == "apply" ]]; then
  (
    cd "$run_dir"
    sha256sum metadata.env app.tar.gz service.unit.txt sqlite.db postgres.sql 2>/dev/null > checksums.sha256 || true
  )

  date +%s > "$VPS_BACKUP_BASE/last_success_epoch"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$VPS_BACKUP_BASE/last_success_iso"
  printf '%s\n' "$run_dir" > "$VPS_BACKUP_BASE/last_success_path"

  snapshot_bytes="$(du -sb "$run_dir" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
  if [[ -z "$snapshot_bytes" ]] && command -v python3 >/dev/null 2>&1; then
    snapshot_bytes="$(python3 - <<PY
import os
total = 0
for root, _, files in os.walk("$run_dir"):
  for name in files:
    try:
      total += os.path.getsize(os.path.join(root, name))
    except OSError:
      pass
print(total)
PY
)"
  fi
  snapshot_bytes="${snapshot_bytes:-0}"
  echo "[backup] snapshot_bytes:$snapshot_bytes"

  {
    printf 'ts=%s ' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'status=PASS '
    printf 'snapshot=%s ' "$run_dir"
    printf 'snapshot_bytes=%s ' "$snapshot_bytes"
    printf 'branch=%s ' "$branch"
    printf 'commit=%s\n' "$commit"
  } >> "$VPS_BACKUP_BASE/backup-history.log"

  old_dirs="$(find "$VPS_BACKUP_BASE" -mindepth 1 -maxdepth 1 -type d -mtime +"$VPS_BACKUP_KEEP_DAYS" -print | sort || true)"
  if [[ -n "$old_dirs" ]]; then
    while IFS= read -r dir; do
      [[ -z "$dir" ]] && continue
      rm -rf "$dir"
      echo "[backup] pruned:$dir"
    done <<<"$old_dirs"
  else
    echo "[backup] pruned:none"
  fi

  echo "[backup] snapshot:$run_dir"
  echo "[backup] PASS"
else
  echo "[backup] dry_run_complete"
fi
REMOTE_EOF
