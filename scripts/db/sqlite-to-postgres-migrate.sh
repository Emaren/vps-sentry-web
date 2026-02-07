#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/.db-migration-backups}"
TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$BACKUP_DIR/$TS"
mkdir -p "$RUN_DIR"

POSTGRES_DATABASE_URL="${POSTGRES_DATABASE_URL:-${PG_URL:-}}"
SQLITE_DB_PATH="${SQLITE_DB_PATH:-$ROOT_DIR/prisma/dev.db}"

if [[ -z "$POSTGRES_DATABASE_URL" ]]; then
  echo "missing_postgres_url: set POSTGRES_DATABASE_URL (or PG_URL)"
  exit 1
fi
if [[ ! -f "$SQLITE_DB_PATH" ]]; then
  echo "missing_sqlite_db:$SQLITE_DB_PATH"
  exit 1
fi

echo "migration_backup_dir:$RUN_DIR"
cp "$SQLITE_DB_PATH" "$RUN_DIR/sqlite-precutover.db"

dump_postgres_snapshot() {
  local out="$1"
  local err_file="${out}.err"
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "postgres_dump_skipped:pg_dump_not_found"
    return 0
  fi
  if pg_dump "$POSTGRES_DATABASE_URL" >"$out" 2>"$err_file"; then
    rm -f "$err_file"
    echo "postgres_dump_saved:$out"
    return 0
  fi

  local err_text
  err_text="$(tr '\n' ' ' <"$err_file" | sed 's/[[:space:]]\+/ /g')"
  rm -f "$err_file" "$out"
  echo "postgres_dump_skipped:$err_text"
  return 0
}

dump_postgres_snapshot "$RUN_DIR/postgres-precutover.sql"

RESET_PUBLIC_SCHEMA="${RESET_PUBLIC_SCHEMA:-1}" \
  POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
  "$ROOT_DIR/scripts/db/postgres-init.sh"

POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
  "$ROOT_DIR/scripts/db/sqlite-to-postgres-copy.sh"

POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
  "$ROOT_DIR/scripts/db/sqlite-postgres-verify.sh"

dump_postgres_snapshot "$RUN_DIR/postgres-postcopy.sql"

echo "sqlite_to_postgres_migration_pass"
echo "backup_artifacts:$RUN_DIR"
