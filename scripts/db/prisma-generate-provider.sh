#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

DB_PROVIDER="${1:-${DB_PROVIDER:-sqlite}}"
PRISMA_BIN="${PRISMA_BIN:-}"

case "$DB_PROVIDER" in
  sqlite)
    SCHEMA_PATH="$ROOT_DIR/prisma/schema.prisma"
    ;;
  postgres)
    SCHEMA_PATH="$ROOT_DIR/prisma/schema.postgres.prisma"
    ;;
  *)
    echo "invalid_db_provider:$DB_PROVIDER"
    echo "expected: sqlite|postgres"
    exit 1
    ;;
esac

if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "missing_schema:$SCHEMA_PATH"
  exit 1
fi

if [[ -z "$PRISMA_BIN" ]]; then
  if command -v npx >/dev/null 2>&1; then
    PRISMA_BIN="npx prisma"
  elif [[ -x "$ROOT_DIR/node_modules/.bin/prisma" ]]; then
    PRISMA_BIN="$ROOT_DIR/node_modules/.bin/prisma"
  else
    echo "missing_prisma_binary: install dependencies first"
    exit 1
  fi
fi

echo "prisma_generate_provider:$DB_PROVIDER"
echo "prisma_schema:$SCHEMA_PATH"

# shellcheck disable=SC2086
$PRISMA_BIN generate --schema "$SCHEMA_PATH" >/dev/null
echo "prisma_generate_provider_pass:$DB_PROVIDER"
