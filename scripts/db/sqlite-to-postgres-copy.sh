#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/db/common.sh"

require_bin sqlite3
require_bin psql
require_postgres_url
resolve_sqlite_path
resolve_null_sentinel

TRUNCATE_TARGET="${TRUNCATE_TARGET:-1}"
WORK_DIR="${WORK_DIR:-}"

if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vps-sqlite-pg-copy.XXXXXX")"
fi
mkdir -p "$WORK_DIR"

NULL_SENTINEL_SQL="$(sql_escape_single_quotes "$NULL_SENTINEL")"

echo "sqlite_source:$SQLITE_DB_PATH"
echo "postgres_target:set"
echo "work_dir:$WORK_DIR"
echo "null_sentinel:$NULL_SENTINEL"

check_null_sentinel_collisions() {
  local table="$1"
  local col
  while IFS= read -r col; do
    [[ -z "$col" ]] && continue
    local q
    q="SELECT COUNT(*) FROM \"$table\" WHERE \"$col\" = '$NULL_SENTINEL_SQL';"
    local c
    c="$(sqlite3 "$SQLITE_DB_PATH" "$q")"
    if [[ "$c" != "0" ]]; then
      echo "null_sentinel_collision:table=$table column=$col count=$c"
      exit 1
    fi
  done < <(sqlite_text_columns "$table")
}

export_table_csv() {
  local table="$1"
  local out_csv="$WORK_DIR/$table.csv"

  check_null_sentinel_collisions "$table"

  sqlite3 "$SQLITE_DB_PATH" <<SQL >"$out_csv"
.headers on
.mode csv
.nullvalue $NULL_SENTINEL
SELECT * FROM "$table";
SQL
}

echo "export_phase:start"
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  export_table_csv "$table"
  rows="$(sqlite3 "$SQLITE_DB_PATH" "SELECT COUNT(*) FROM \"$table\";")"
  echo "export_table:$table rows=$rows"
done < <(db_tables)
echo "export_phase:done"

IMPORT_SQL="$WORK_DIR/import.sql"
{
  echo '\set ON_ERROR_STOP on'
  echo 'BEGIN;'
  if [[ "$TRUNCATE_TARGET" == "1" ]]; then
    printf 'TRUNCATE TABLE %s RESTART IDENTITY CASCADE;\n' "$(join_table_names_for_truncate)"
  fi
  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    csv_path="$WORK_DIR/$table.csv"
    # Paths are generated locally by mktemp and should not contain single quotes.
    printf "\\copy \"%s\" FROM '%s' WITH (FORMAT csv, HEADER true, NULL '%s');\n" \
      "$table" "$csv_path" "$NULL_SENTINEL_SQL"
  done < <(db_tables)
  echo 'COMMIT;'
} >"$IMPORT_SQL"

echo "import_phase:start"
psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$IMPORT_SQL" >/dev/null
echo "import_phase:done"

echo "target_counts:"
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  c="$(psql "$POSTGRES_DATABASE_URL" -Atqc "SELECT COUNT(*) FROM \"$table\";")"
  echo "target_table:$table rows=$c"
done < <(db_tables)

echo "sqlite_to_postgres_copy_pass"
