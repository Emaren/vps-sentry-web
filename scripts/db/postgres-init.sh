#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/db/common.sh"

require_bin psql
require_postgres_url

BASELINE_SQL="${BASELINE_SQL:-$ROOT_DIR/prisma/postgres/0001_init.sql}"
RESET_PUBLIC_SCHEMA="${RESET_PUBLIC_SCHEMA:-0}"

if [[ ! -f "$BASELINE_SQL" ]]; then
  echo "missing_baseline_sql:$BASELINE_SQL"
  exit 1
fi

if [[ "$RESET_PUBLIC_SCHEMA" == "1" ]]; then
  echo "postgres_reset_public_schema:1"
  psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";'
fi

echo "postgres_apply_baseline:$BASELINE_SQL"
psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$BASELINE_SQL" >/dev/null
echo "postgres_init_pass"
