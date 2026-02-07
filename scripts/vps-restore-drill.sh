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
VPS_RESTORE_DRILL_POSTGRES_URL="${VPS_RESTORE_DRILL_POSTGRES_URL:-}"
VPS_RESTORE_DRILL_REQUIRE_POSTGRES="${VPS_RESTORE_DRILL_REQUIRE_POSTGRES:-0}"
VPS_RESTORE_DRILL_REQUIRE_SQLITE="${VPS_RESTORE_DRILL_REQUIRE_SQLITE:-0}"

VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"

backup_path=""
keep_temp=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/vps-restore-drill.sh [--from /path/to/backup] [--postgres-url URL] [--require-postgres] [--require-sqlite] [--keep-temp]

Restore drill (non-production path):
- validates backup artifact checksums
- extracts app archive into temp dir
- validates sqlite integrity (if sqlite backup exists)
- optionally restores postgres.sql into a dedicated drill database URL

Notes:
- --postgres-url should point to a dedicated drill/scratch DB. This script resets public schema there.
USAGE
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "[restore-drill] $name must be a positive integer: $value"
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

    echo "[restore-drill] ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from)
      [[ $# -lt 2 ]] && { echo "[restore-drill] missing value for --from"; usage; exit 1; }
      backup_path="$2"
      shift 2
      ;;
    --postgres-url)
      [[ $# -lt 2 ]] && { echo "[restore-drill] missing value for --postgres-url"; usage; exit 1; }
      VPS_RESTORE_DRILL_POSTGRES_URL="$2"
      shift 2
      ;;
    --require-postgres)
      VPS_RESTORE_DRILL_REQUIRE_POSTGRES=1
      shift
      ;;
    --require-sqlite)
      VPS_RESTORE_DRILL_REQUIRE_SQLITE=1
      shift
      ;;
    --keep-temp)
      keep_temp=1
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[restore-drill] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

echo "[restore-drill] host: $VPS_HOST"
echo "[restore-drill] backup_base: $VPS_BACKUP_BASE"

remote "VPS_BACKUP_BASE=$(printf %q "$VPS_BACKUP_BASE") VPS_RESTORE_DRILL_BACKUP_PATH=$(printf %q "$backup_path") VPS_RESTORE_DRILL_POSTGRES_URL=$(printf %q "$VPS_RESTORE_DRILL_POSTGRES_URL") VPS_RESTORE_DRILL_REQUIRE_POSTGRES=$(printf %q "$VPS_RESTORE_DRILL_REQUIRE_POSTGRES") VPS_RESTORE_DRILL_REQUIRE_SQLITE=$(printf %q "$VPS_RESTORE_DRILL_REQUIRE_SQLITE") VPS_RESTORE_DRILL_KEEP_TEMP=$(printf %q "$keep_temp") bash -s" <<'REMOTE_EOF'
set -euo pipefail

fail=0

resolve_backup_dir() {
  local raw="$1"
  if [[ -n "$raw" ]]; then
    if [[ -d "$raw" ]]; then
      printf '%s\n' "$raw"
      return 0
    fi
    if [[ -d "$VPS_BACKUP_BASE/$raw" ]]; then
      printf '%s\n' "$VPS_BACKUP_BASE/$raw"
      return 0
    fi
    return 1
  fi

  if [[ ! -d "$VPS_BACKUP_BASE" ]]; then
    return 1
  fi

  find "$VPS_BACKUP_BASE" -mindepth 1 -maxdepth 1 -type d -print | sort | tail -n1
}

backup_dir="$(resolve_backup_dir "$VPS_RESTORE_DRILL_BACKUP_PATH" || true)"
if [[ -z "$backup_dir" ]]; then
  echo "[restore-drill] backup_not_found"
  exit 1
fi

echo "[restore-drill] backup_dir:$backup_dir"

if [[ ! -f "$backup_dir/app.tar.gz" ]]; then
  echo "[restore-drill] missing_artifact:app.tar.gz"
  exit 1
fi

if ! tar -tzf "$backup_dir/app.tar.gz" >/dev/null 2>&1; then
  echo "[restore-drill] corrupted_artifact:app.tar.gz"
  exit 1
fi
echo "[restore-drill] app_archive_ok"

if [[ -f "$backup_dir/checksums.sha256" ]]; then
  (
    cd "$backup_dir"
    sha256sum -c checksums.sha256 >/tmp/vps-sentry-restore-checksum.log 2>&1 || exit 1
  ) || {
    echo "[restore-drill] checksum_fail"
    sed -n '1,80p' /tmp/vps-sentry-restore-checksum.log || true
    rm -f /tmp/vps-sentry-restore-checksum.log
    exit 1
  }
  rm -f /tmp/vps-sentry-restore-checksum.log
  echo "[restore-drill] checksum_ok"
else
  echo "[restore-drill] checksum_skip:file_missing"
fi

tmp_dir="$(mktemp -d /tmp/vps-sentry-restore-drill.XXXXXX)"
trap 'if [[ "${VPS_RESTORE_DRILL_KEEP_TEMP:-0}" != "1" ]]; then rm -rf "$tmp_dir"; fi' EXIT

tar -xzf "$backup_dir/app.tar.gz" -C "$tmp_dir"
if [[ ! -f "$tmp_dir/package.json" ]]; then
  echo "[restore-drill] app_extract_fail:package.json_missing"
  fail=1
else
  echo "[restore-drill] app_extract_ok:$tmp_dir"
fi

if [[ -f "$backup_dir/sqlite.db" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite_check="$(sqlite3 "$backup_dir/sqlite.db" 'PRAGMA integrity_check;' 2>/dev/null || true)"
    if [[ "$sqlite_check" == "ok" ]]; then
      echo "[restore-drill] sqlite_restore_ok"
    else
      echo "[restore-drill] sqlite_restore_fail:$sqlite_check"
      fail=1
    fi
  else
    echo "[restore-drill] sqlite_skip:sqlite3_missing"
    if [[ "$VPS_RESTORE_DRILL_REQUIRE_SQLITE" == "1" ]]; then
      fail=1
    fi
  fi
else
  echo "[restore-drill] sqlite_skip:artifact_missing"
  if [[ "$VPS_RESTORE_DRILL_REQUIRE_SQLITE" == "1" ]]; then
    fail=1
  fi
fi

if [[ -f "$backup_dir/postgres.sql" ]]; then
  if [[ -n "$VPS_RESTORE_DRILL_POSTGRES_URL" ]] && command -v psql >/dev/null 2>&1; then
    if psql "$VPS_RESTORE_DRILL_POSTGRES_URL" -v ON_ERROR_STOP=1 -q -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1 \
      && psql "$VPS_RESTORE_DRILL_POSTGRES_URL" -v ON_ERROR_STOP=1 -q -f "$backup_dir/postgres.sql" >/dev/null 2>&1; then

      missing_tables="$({ psql "$VPS_RESTORE_DRILL_POSTGRES_URL" -qAt <<'SQL'
WITH expected(name) AS (
  VALUES ('User'), ('Host'), ('HostSnapshot'), ('NotificationEvent'), ('AuditLog')
)
SELECT name
FROM expected e
LEFT JOIN pg_class c ON c.relname = e.name AND c.relkind = 'r'
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.oid IS NULL OR n.oid IS NULL;
SQL
} 2>/dev/null || true)"

      if [[ -n "$missing_tables" ]]; then
        echo "[restore-drill] postgres_restore_fail:missing_tables=$missing_tables"
        fail=1
      else
        echo "[restore-drill] postgres_restore_ok"
      fi
    else
      echo "[restore-drill] postgres_restore_fail:psql_import_error"
      fail=1
    fi
  else
    echo "[restore-drill] postgres_skip:url_or_psql_missing"
    if [[ "$VPS_RESTORE_DRILL_REQUIRE_POSTGRES" == "1" ]]; then
      fail=1
    fi
  fi
else
  echo "[restore-drill] postgres_skip:artifact_missing"
  if [[ "$VPS_RESTORE_DRILL_REQUIRE_POSTGRES" == "1" ]]; then
    fail=1
  fi
fi

if [[ "$VPS_RESTORE_DRILL_KEEP_TEMP" == "1" ]]; then
  echo "[restore-drill] temp_dir_kept:$tmp_dir"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "[restore-drill] FAIL"
  exit 1
fi

echo "[restore-drill] PASS"
REMOTE_EOF
