#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/db/common.sh"

require_bin sqlite3
require_bin psql
require_bin diff
require_postgres_url
resolve_sqlite_path
resolve_null_sentinel

WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/vps-sqlite-pg-verify.XXXXXX")}"
mkdir -p "$WORK_DIR"

NULL_SENTINEL_SQL="$(sql_escape_single_quotes "$NULL_SENTINEL")"

verify_counts() {
  local table="$1"
  local src_count dst_count
  src_count="$(sqlite3 "$SQLITE_DB_PATH" "SELECT COUNT(*) FROM \"$table\";")"
  dst_count="$(psql "$POSTGRES_DATABASE_URL" -Atqc "SELECT COUNT(*) FROM \"$table\";")"
  if [[ "$src_count" != "$dst_count" ]]; then
    echo "verify_fail:row_count table=$table sqlite=$src_count postgres=$dst_count"
    return 1
  fi
  echo "verify_count_ok:table=$table rows=$src_count"
}

verify_keyset() {
  local table="$1"
  local key_cols src_file dst_file
  key_cols="$(table_key_columns "$table")"
  src_file="$WORK_DIR/${table}.keys.sqlite.tsv"
  dst_file="$WORK_DIR/${table}.keys.postgres.tsv"

  sqlite3 -separator $'\t' -nullvalue "$NULL_SENTINEL" "$SQLITE_DB_PATH" \
    "SELECT $key_cols FROM \"$table\" ORDER BY $key_cols;" >"$src_file"

  psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc \
    "COPY (SELECT $key_cols FROM \"$table\" ORDER BY $key_cols) TO STDOUT WITH (FORMAT csv, HEADER false, DELIMITER E'\t', NULL '$NULL_SENTINEL_SQL');" \
    >"$dst_file"

  if ! diff -u "$src_file" "$dst_file" >/dev/null; then
    echo "verify_fail:keyset table=$table"
    diff -u "$src_file" "$dst_file" || true
    return 1
  fi
  echo "verify_keyset_ok:table=$table"
}

verify_text_null_empty_invariants() {
  local table="$1"
  local col
  while IFS= read -r col; do
    [[ -z "$col" ]] && continue

    local pg_info pg_data_type pg_udt_name
    pg_info="$(psql "$POSTGRES_DATABASE_URL" -Atqc \
      "SELECT data_type || '|' || udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='$table' AND column_name='$col' LIMIT 1;")"
    if [[ -z "$pg_info" ]]; then
      echo "verify_fail:missing_column table=$table column=$col (postgres)"
      return 1
    fi
    pg_data_type="${pg_info%%|*}"
    pg_udt_name="${pg_info##*|}"

    local src dst src_null src_empty dst_null dst_empty
    src="$(sqlite3 "$SQLITE_DB_PATH" \
      "SELECT COALESCE(SUM(CASE WHEN \"$col\" IS NULL THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN \"$col\" = '' THEN 1 ELSE 0 END),0) FROM \"$table\";")"

    if [[ "$pg_data_type" == "text" || "$pg_data_type" == "character varying" || "$pg_data_type" == "character" ]]; then
      dst="$(psql "$POSTGRES_DATABASE_URL" -Atqc \
        "SELECT COALESCE(SUM(CASE WHEN \"$col\" IS NULL THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN \"$col\" = '' THEN 1 ELSE 0 END),0) FROM \"$table\";")"
    else
      # enums and non-text types cannot be compared to ''
      dst="$(psql "$POSTGRES_DATABASE_URL" -Atqc \
        "SELECT COALESCE(SUM(CASE WHEN \"$col\" IS NULL THEN 1 ELSE 0 END),0), 0 FROM \"$table\";")"
      src_empty="0"
    fi

    src_null="${src%%|*}"
    src_empty="${src_empty:-${src##*|}}"
    dst_null="${dst%%|*}"
    dst_empty="${dst##*|}"

    if [[ "$src_null" != "$dst_null" || "$src_empty" != "$dst_empty" ]]; then
      echo "verify_fail:null_empty table=$table column=$col postgres_type=${pg_data_type}:${pg_udt_name} sqlite_null=$src_null sqlite_empty=$src_empty postgres_null=$dst_null postgres_empty=$dst_empty"
      return 1
    fi
  done < <(sqlite_text_columns "$table")

  echo "verify_null_empty_ok:table=$table"
}

echo "verify_phase:start"
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  verify_counts "$table"
  verify_keyset "$table"
  verify_text_null_empty_invariants "$table"
done < <(db_tables)
echo "verify_phase:pass"
