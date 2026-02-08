#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/db/common.sh"

require_bin psql
require_postgres_url

POSTGRES_SQL_DIR="${POSTGRES_SQL_DIR:-$ROOT_DIR/prisma/postgres}"
RESET_PUBLIC_SCHEMA="${RESET_PUBLIC_SCHEMA:-0}"

if [[ ! -d "$POSTGRES_SQL_DIR" ]]; then
  echo "missing_postgres_sql_dir:$POSTGRES_SQL_DIR"
  exit 1
fi

if [[ "$RESET_PUBLIC_SCHEMA" == "1" ]]; then
  echo "postgres_reset_public_schema:1"
  psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";'
fi

mapfile -t SQL_FILES < <(find "$POSTGRES_SQL_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
if [[ "${#SQL_FILES[@]}" -eq 0 ]]; then
  echo "missing_postgres_sql_files:$POSTGRES_SQL_DIR"
  exit 1
fi

for sql_file in "${SQL_FILES[@]}"; do
  echo "postgres_apply_sql:$sql_file"
  psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$sql_file" >/dev/null
done

echo "postgres_init_pass"
