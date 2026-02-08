#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/db/common.sh"

require_bin sqlite3
require_bin psql
require_bin tee
require_postgres_url
resolve_sqlite_path
resolve_null_sentinel

ACCEPTANCE_BASE_DIR="${ACCEPTANCE_BASE_DIR:-$ROOT_DIR/.db-cutover-acceptance}"
TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${ACCEPTANCE_RUN_DIR:-$ACCEPTANCE_BASE_DIR/$TS}"
mkdir -p "$RUN_DIR"

SHADOW_LIMIT="${SHADOW_LIMIT:-50}"

hash_file() {
  local file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return 0
  fi
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $2}'
    return 0
  fi
  echo "missing_hash_binary: require shasum, sha256sum, or openssl"
  exit 1
}

echo "acceptance_run_dir:$RUN_DIR"
echo "acceptance_shadow_limit:$SHADOW_LIMIT"

POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
NULL_SENTINEL="$NULL_SENTINEL" \
WORK_DIR="$RUN_DIR/verify" \
  "$ROOT_DIR/scripts/db/sqlite-postgres-verify.sh" | tee "$RUN_DIR/verify.log"

POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
NULL_SENTINEL="$NULL_SENTINEL" \
SHADOW_LIMIT="$SHADOW_LIMIT" \
WORK_DIR="$RUN_DIR/shadow" \
  "$ROOT_DIR/scripts/db/sqlite-postgres-shadow-read.sh" | tee "$RUN_DIR/shadow.log"

COUNTS_FILE="$RUN_DIR/table-counts.tsv"
{
  printf "table\tsqlite_rows\tpostgres_rows\n"
  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    sqlite_count="$(sqlite3 "$SQLITE_DB_PATH" "SELECT COUNT(*) FROM \"$table\";")"
    postgres_count="$(psql "$POSTGRES_DATABASE_URL" -Atqc "SELECT COUNT(*) FROM \"$table\";")"
    printf "%s\t%s\t%s\n" "$table" "$sqlite_count" "$postgres_count"
  done < <(db_tables)
} >"$COUNTS_FILE"

KEY_HASH_FILE="$RUN_DIR/table-key-hashes.tsv"
{
  printf "table\tsqlite_sha256\tpostgres_sha256\n"
  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    key_cols="$(table_key_columns "$table")"
    sqlite_keys="$RUN_DIR/${table}.keys.sqlite.tsv"
    postgres_keys="$RUN_DIR/${table}.keys.postgres.tsv"

    sqlite3 -separator $'\t' -nullvalue "$NULL_SENTINEL" "$SQLITE_DB_PATH" \
      "SELECT $key_cols FROM \"$table\" ORDER BY $key_cols;" >"$sqlite_keys"
    psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc \
      "COPY (SELECT $key_cols FROM \"$table\" ORDER BY $key_cols) TO STDOUT WITH (FORMAT csv, HEADER false, DELIMITER E'\t', NULL '$(sql_escape_single_quotes "$NULL_SENTINEL")');" \
      >"$postgres_keys"

    sqlite_hash="$(hash_file "$sqlite_keys")"
    postgres_hash="$(hash_file "$postgres_keys")"

    if [[ "$sqlite_hash" != "$postgres_hash" ]]; then
      echo "acceptance_fail:key_hash table=$table sqlite_sha256=$sqlite_hash postgres_sha256=$postgres_hash"
      exit 1
    fi

    printf "%s\t%s\t%s\n" "$table" "$sqlite_hash" "$postgres_hash"
    echo "acceptance_key_hash_ok:table=$table sha256=$sqlite_hash"
  done < <(db_tables)
} >"$KEY_HASH_FILE"

{
  echo "acceptance_pass:sqlite_postgres"
  echo "sqlite_source:$SQLITE_DB_PATH"
  echo "postgres_target:set"
  echo "artifacts:$RUN_DIR"
  echo "table_counts:$COUNTS_FILE"
  echo "table_key_hashes:$KEY_HASH_FILE"
} | tee "$RUN_DIR/summary.env"
