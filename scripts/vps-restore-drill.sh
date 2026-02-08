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
VPS_RESTORE_DRILL_HISTORY_FILE="${VPS_RESTORE_DRILL_HISTORY_FILE:-$VPS_BACKUP_BASE/restore-drill-history.log}"
VPS_RPO_TARGET_MINUTES="${VPS_RPO_TARGET_MINUTES:-60}"
VPS_RTO_TARGET_MINUTES="${VPS_RTO_TARGET_MINUTES:-15}"
VPS_LOCAL_EXEC="${VPS_LOCAL_EXEC:-0}"

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
- On every run, writes status markers and drill history under VPS_BACKUP_BASE.
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
require_positive_int "VPS_RPO_TARGET_MINUTES" "$VPS_RPO_TARGET_MINUTES"
require_positive_int "VPS_RTO_TARGET_MINUTES" "$VPS_RTO_TARGET_MINUTES"

echo "[restore-drill] host: $VPS_HOST"
echo "[restore-drill] backup_base: $VPS_BACKUP_BASE"
echo "[restore-drill] local_exec: $VPS_LOCAL_EXEC"

remote "VPS_BACKUP_BASE=$(printf %q "$VPS_BACKUP_BASE") VPS_RESTORE_DRILL_BACKUP_PATH=$(printf %q "$backup_path") VPS_RESTORE_DRILL_POSTGRES_URL=$(printf %q "$VPS_RESTORE_DRILL_POSTGRES_URL") VPS_RESTORE_DRILL_REQUIRE_POSTGRES=$(printf %q "$VPS_RESTORE_DRILL_REQUIRE_POSTGRES") VPS_RESTORE_DRILL_REQUIRE_SQLITE=$(printf %q "$VPS_RESTORE_DRILL_REQUIRE_SQLITE") VPS_RESTORE_DRILL_KEEP_TEMP=$(printf %q "$keep_temp") VPS_RESTORE_DRILL_HISTORY_FILE=$(printf %q "$VPS_RESTORE_DRILL_HISTORY_FILE") VPS_RPO_TARGET_MINUTES=$(printf %q "$VPS_RPO_TARGET_MINUTES") VPS_RTO_TARGET_MINUTES=$(printf %q "$VPS_RTO_TARGET_MINUTES") bash -s" <<'REMOTE_EOF'
set -euo pipefail

drill_started_epoch="$(date +%s)"
drill_started_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
drill_status="FAIL"
fail_reasons=()
backup_dir=""
tmp_dir=""
rpo_seconds=-1
rto_seconds=0
latest_backup_source="unknown"

record_failure() {
  local reason="$1"
  fail_reasons+=("$reason")
}

join_fail_reasons() {
  if [[ "${#fail_reasons[@]}" -eq 0 ]]; then
    printf 'none'
    return
  fi
  local IFS=","
  printf '%s' "${fail_reasons[*]}"
}

resolve_latest_backup_epoch() {
  local marker="$VPS_BACKUP_BASE/last_success_epoch"
  if [[ -f "$marker" ]]; then
    local marker_value
    marker_value="$(tr -d '[:space:]' < "$marker" || true)"
    if [[ "$marker_value" =~ ^[0-9]+$ ]]; then
      latest_backup_source="last_success_epoch"
      printf '%s\n' "$marker_value"
      return 0
    fi
  fi

  if [[ -n "$backup_dir" && -d "$backup_dir" ]]; then
    local mtime_epoch
    mtime_epoch="$(stat -c %Y "$backup_dir" 2>/dev/null || true)"
    if [[ "$mtime_epoch" =~ ^[0-9]+$ ]]; then
      latest_backup_source="backup_dir_mtime"
      printf '%s\n' "$mtime_epoch"
      return 0
    fi
  fi

  printf '%s\n' ""
}

cleanup_temp() {
  if [[ -n "$tmp_dir" && -d "$tmp_dir" && "${VPS_RESTORE_DRILL_KEEP_TEMP:-0}" != "1" ]]; then
    rm -rf "$tmp_dir"
  fi
}

finish_report() {
  local drill_ended_epoch drill_ended_iso latest_backup_epoch fail_reason
  drill_ended_epoch="$(date +%s)"
  drill_ended_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  rto_seconds=$((drill_ended_epoch - drill_started_epoch))
  if (( rto_seconds < 0 )); then
    rto_seconds=0
  fi

  latest_backup_epoch="$(resolve_latest_backup_epoch)"
  if [[ -n "$latest_backup_epoch" ]]; then
    rpo_seconds=$((drill_ended_epoch - latest_backup_epoch))
    if (( rpo_seconds < 0 )); then
      rpo_seconds=0
    fi
  fi

  mkdir -p "$VPS_BACKUP_BASE"
  printf '%s\n' "$drill_ended_epoch" > "$VPS_BACKUP_BASE/restore_last_run_epoch"
  printf '%s\n' "$drill_ended_iso" > "$VPS_BACKUP_BASE/restore_last_run_iso"
  printf '%s\n' "$drill_status" > "$VPS_BACKUP_BASE/restore_last_run_status"
  printf '%s\n' "$rto_seconds" > "$VPS_BACKUP_BASE/restore_last_run_rto_seconds"
  printf '%s\n' "$backup_dir" > "$VPS_BACKUP_BASE/restore_last_run_backup_path"
  printf '%s\n' "$rpo_seconds" > "$VPS_BACKUP_BASE/restore_last_run_rpo_seconds"
  printf '%s\n' "$latest_backup_source" > "$VPS_BACKUP_BASE/restore_last_run_rpo_source"

  if [[ "$drill_status" == "PASS" ]]; then
    printf '%s\n' "$drill_ended_epoch" > "$VPS_BACKUP_BASE/restore_last_success_epoch"
    printf '%s\n' "$drill_ended_iso" > "$VPS_BACKUP_BASE/restore_last_success_iso"
    printf '%s\n' "$rto_seconds" > "$VPS_BACKUP_BASE/restore_last_success_rto_seconds"
    printf '%s\n' "$backup_dir" > "$VPS_BACKUP_BASE/restore_last_success_backup_path"
    printf '%s\n' "$rpo_seconds" > "$VPS_BACKUP_BASE/restore_last_success_rpo_seconds"
    printf '%s\n' "$latest_backup_source" > "$VPS_BACKUP_BASE/restore_last_success_rpo_source"
  fi

  fail_reason="$(join_fail_reasons)"
  mkdir -p "$(dirname "$VPS_RESTORE_DRILL_HISTORY_FILE")"
  {
    printf 'ts=%s ' "$drill_ended_iso"
    printf 'started=%s ' "$drill_started_iso"
    printf 'status=%s ' "$drill_status"
    printf 'rto_seconds=%s ' "$rto_seconds"
    printf 'rpo_seconds=%s ' "$rpo_seconds"
    printf 'rpo_source=%s ' "$latest_backup_source"
    printf 'backup_dir=%s ' "$backup_dir"
    printf 'reason=%s ' "$fail_reason"
    printf 'rpo_target_minutes=%s ' "$VPS_RPO_TARGET_MINUTES"
    printf 'rto_target_minutes=%s\n' "$VPS_RTO_TARGET_MINUTES"
  } >> "$VPS_RESTORE_DRILL_HISTORY_FILE"

  echo "[restore-drill] rto_seconds:$rto_seconds"
  if [[ "$rpo_seconds" -ge 0 ]]; then
    echo "[restore-drill] rpo_seconds:$rpo_seconds"
  else
    echo "[restore-drill] rpo_seconds:unknown"
  fi

  cleanup_temp
}

trap finish_report EXIT

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
  record_failure "backup_not_found"
  echo "[restore-drill] backup_not_found"
  exit 1
fi

echo "[restore-drill] backup_dir:$backup_dir"

if [[ ! -f "$backup_dir/app.tar.gz" ]]; then
  record_failure "missing_artifact_app_tar"
  echo "[restore-drill] missing_artifact:app.tar.gz"
  exit 1
fi

if ! tar -tzf "$backup_dir/app.tar.gz" >/dev/null 2>&1; then
  record_failure "corrupted_app_tar"
  echo "[restore-drill] corrupted_artifact:app.tar.gz"
  exit 1
fi
echo "[restore-drill] app_archive_ok"

if [[ -f "$backup_dir/checksums.sha256" ]]; then
  (
    cd "$backup_dir"
    sha256sum -c checksums.sha256 >/tmp/vps-sentry-restore-checksum.log 2>&1 || exit 1
  ) || {
    record_failure "checksum_fail"
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

tar -xzf "$backup_dir/app.tar.gz" -C "$tmp_dir"
if [[ ! -f "$tmp_dir/package.json" ]]; then
  echo "[restore-drill] app_extract_fail:package.json_missing"
  record_failure "app_extract_package_json_missing"
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
      record_failure "sqlite_integrity_fail"
      fail=1
    fi
  else
    echo "[restore-drill] sqlite_skip:sqlite3_missing"
    if [[ "$VPS_RESTORE_DRILL_REQUIRE_SQLITE" == "1" ]]; then
      record_failure "sqlite_required_but_sqlite3_missing"
      fail=1
    fi
  fi
else
  echo "[restore-drill] sqlite_skip:artifact_missing"
  if [[ "$VPS_RESTORE_DRILL_REQUIRE_SQLITE" == "1" ]]; then
    record_failure "sqlite_required_but_artifact_missing"
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
        record_failure "postgres_missing_expected_tables"
        fail=1
      else
        echo "[restore-drill] postgres_restore_ok"
      fi
    else
      echo "[restore-drill] postgres_restore_fail:psql_import_error"
      record_failure "postgres_import_failed"
      fail=1
    fi
  else
    echo "[restore-drill] postgres_skip:url_or_psql_missing"
    if [[ "$VPS_RESTORE_DRILL_REQUIRE_POSTGRES" == "1" ]]; then
      record_failure "postgres_required_but_url_or_psql_missing"
      fail=1
    fi
  fi
else
  echo "[restore-drill] postgres_skip:artifact_missing"
  if [[ "$VPS_RESTORE_DRILL_REQUIRE_POSTGRES" == "1" ]]; then
    record_failure "postgres_required_but_artifact_missing"
    fail=1
  fi
fi

if [[ "$VPS_RESTORE_DRILL_KEEP_TEMP" == "1" ]]; then
  echo "[restore-drill] temp_dir_kept:$tmp_dir"
fi

if [[ "$fail" -ne 0 ]]; then
  if [[ "${#fail_reasons[@]}" -eq 0 ]]; then
    record_failure "validation_failed"
  fi
  echo "[restore-drill] FAIL"
  exit 1
fi

drill_status="PASS"
echo "[restore-drill] PASS"
REMOTE_EOF
