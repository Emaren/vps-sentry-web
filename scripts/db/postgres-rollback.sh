#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ROLLBACK_SQLITE_BACKUP="${ROLLBACK_SQLITE_BACKUP:-${1:-}}"
SQLITE_DB_PATH="${SQLITE_DB_PATH:-$ROOT_DIR/prisma/dev.db}"
VPS_ENV_FILE="${VPS_ENV_FILE:-$ROOT_DIR/.vps.env}"
ROLLBACK_SET_VPS_PROVIDER="${ROLLBACK_SET_VPS_PROVIDER:-1}"
ROLLBACK_GENERATE_PROVIDER="${ROLLBACK_GENERATE_PROVIDER:-1}"

if [[ -z "$ROLLBACK_SQLITE_BACKUP" ]]; then
  echo "missing_rollback_sqlite_backup"
  echo "set ROLLBACK_SQLITE_BACKUP=/path/to/sqlite-precutover.db or pass it as arg1"
  exit 1
fi

if [[ ! -f "$ROLLBACK_SQLITE_BACKUP" ]]; then
  echo "missing_rollback_sqlite_backup:$ROLLBACK_SQLITE_BACKUP"
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

mkdir -p "$(dirname "$SQLITE_DB_PATH")"
cp "$ROLLBACK_SQLITE_BACKUP" "$SQLITE_DB_PATH"
echo "rollback_sqlite_restored:$SQLITE_DB_PATH"

if [[ "$ROLLBACK_SET_VPS_PROVIDER" == "1" ]]; then
  upsert_env_key "$VPS_ENV_FILE" "VPS_DB_PROVIDER" "sqlite"
  echo "rollback_vps_env_updated:file=$VPS_ENV_FILE key=VPS_DB_PROVIDER value=sqlite"
fi

if [[ "$ROLLBACK_GENERATE_PROVIDER" == "1" ]]; then
  DB_PROVIDER=sqlite "$ROOT_DIR/scripts/db/prisma-generate-provider.sh" sqlite
fi

echo "rollback_pass:postgres_to_sqlite"
