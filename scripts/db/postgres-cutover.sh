#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/db/common.sh"

require_postgres_url
resolve_sqlite_path
resolve_null_sentinel
require_bin tee

CUTOVER_BASE_DIR="${CUTOVER_BASE_DIR:-$ROOT_DIR/.db-cutover-runs}"
TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${CUTOVER_RUN_DIR:-$CUTOVER_BASE_DIR/$TS}"
mkdir -p "$RUN_DIR"

CUTOVER_CONFIRM_TOKEN="${CUTOVER_CONFIRM_TOKEN:-I_UNDERSTAND_PRODUCTION_CUTOVER}"
CUTOVER_CONFIRM="${CUTOVER_CONFIRM:-}"
CUTOVER_SKIP_CONFIRM="${CUTOVER_SKIP_CONFIRM:-0}"

CUTOVER_GENERATE_PROVIDER="${CUTOVER_GENERATE_PROVIDER:-1}"
CUTOVER_SWITCH_VPS_ENV="${CUTOVER_SWITCH_VPS_ENV:-1}"
CUTOVER_VPS_ENV_FILE="${CUTOVER_VPS_ENV_FILE:-$ROOT_DIR/.vps.env}"
SHADOW_LIMIT="${SHADOW_LIMIT:-50}"

if [[ "$CUTOVER_SKIP_CONFIRM" != "1" && "$CUTOVER_CONFIRM" != "$CUTOVER_CONFIRM_TOKEN" ]]; then
  echo "cutover_confirmation_required"
  echo "set CUTOVER_CONFIRM=$CUTOVER_CONFIRM_TOKEN (or CUTOVER_SKIP_CONFIRM=1)"
  exit 1
fi

upsert_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/vps-env-upsert.XXXXXX")"
  if [[ -f "$file" ]]; then
    awk -v k="$key" -v v="$value" '
      BEGIN { updated = 0 }
      $0 ~ ("^" k "=") { print k "=" v; updated = 1; next }
      { print }
      END { if (!updated) print k "=" v }
    ' "$file" >"$tmp"
  else
    printf "%s=%s\n" "$key" "$value" >"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

echo "cutover_run_dir:$RUN_DIR"
echo "cutover_sqlite_source:$SQLITE_DB_PATH"
echo "cutover_postgres_target:set"

MIGRATION_RUN_DIR="$RUN_DIR/migration" \
POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
NULL_SENTINEL="$NULL_SENTINEL" \
  "$ROOT_DIR/scripts/db/sqlite-to-postgres-migrate.sh" | tee "$RUN_DIR/migration.log"

ACCEPTANCE_RUN_DIR="$RUN_DIR/acceptance" \
POSTGRES_DATABASE_URL="$POSTGRES_DATABASE_URL" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
NULL_SENTINEL="$NULL_SENTINEL" \
SHADOW_LIMIT="$SHADOW_LIMIT" \
  "$ROOT_DIR/scripts/db/sqlite-postgres-acceptance.sh" | tee "$RUN_DIR/acceptance.log"

if [[ "$CUTOVER_GENERATE_PROVIDER" == "1" ]]; then
  DB_PROVIDER=postgres "$ROOT_DIR/scripts/db/prisma-generate-provider.sh" postgres | tee "$RUN_DIR/prisma-generate.log"
fi

if [[ "$CUTOVER_SWITCH_VPS_ENV" == "1" ]]; then
  upsert_env_key "$CUTOVER_VPS_ENV_FILE" "VPS_DB_PROVIDER" "postgres"
  echo "cutover_vps_env_updated:file=$CUTOVER_VPS_ENV_FILE key=VPS_DB_PROVIDER value=postgres"
fi

ROLLBACK_FILE="$RUN_DIR/rollback.env"
{
  echo "ROLLBACK_SQLITE_BACKUP=$RUN_DIR/migration/sqlite-precutover.db"
  echo "SQLITE_DB_PATH=$SQLITE_DB_PATH"
  echo "VPS_ENV_FILE=$CUTOVER_VPS_ENV_FILE"
} >"$ROLLBACK_FILE"
echo "cutover_rollback_env:$ROLLBACK_FILE"

echo "cutover_pass:sqlite_to_postgres"
echo "next_action:deploy_with_postgres_provider"
