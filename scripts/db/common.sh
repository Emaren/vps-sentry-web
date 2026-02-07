#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_SQLITE_DB_PATH="$ROOT_DIR/prisma/dev.db"
DEFAULT_NULL_SENTINEL="__VPSS_NULL__"

db_tables() {
  cat <<'EOF'
User
Subscription
Host
HostApiKey
HostSnapshot
Breach
NotificationEndpoint
NotificationEvent
RemediationAction
RemediationRun
AuditLog
Account
Session
VerificationToken
EOF
}

table_key_columns() {
  case "$1" in
    VerificationToken) printf '"identifier", "token"' ;;
    *) printf '"id"' ;;
  esac
}

join_table_names_for_truncate() {
  local first=1
  local table
  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    if [[ "$first" -eq 1 ]]; then
      printf '"%s"' "$table"
      first=0
    else
      printf ',"%s"' "$table"
    fi
  done < <(db_tables)
}

require_bin() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "missing_binary:$bin"
    exit 1
  fi
}

require_postgres_url() {
  POSTGRES_DATABASE_URL="${POSTGRES_DATABASE_URL:-${PG_URL:-}}"
  if [[ -z "$POSTGRES_DATABASE_URL" ]]; then
    cat <<'EOF'
missing_postgres_url: set POSTGRES_DATABASE_URL (or PG_URL).
example:
  export POSTGRES_DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"
EOF
    exit 1
  fi
}

resolve_sqlite_path() {
  SQLITE_DB_PATH="${SQLITE_DB_PATH:-$DEFAULT_SQLITE_DB_PATH}"
  if [[ ! -f "$SQLITE_DB_PATH" ]]; then
    echo "missing_sqlite_db:$SQLITE_DB_PATH"
    exit 1
  fi
}

resolve_null_sentinel() {
  NULL_SENTINEL="${NULL_SENTINEL:-$DEFAULT_NULL_SENTINEL}"
  if [[ -z "$NULL_SENTINEL" ]]; then
    echo "null_sentinel_empty"
    exit 1
  fi
}

sql_escape_single_quotes() {
  printf "%s" "$1" | sed "s/'/''/g"
}

sqlite_text_columns() {
  local table="$1"
  sqlite3 "$SQLITE_DB_PATH" "PRAGMA table_info(\"$table\");" \
    | awk -F'|' 'BEGIN{IGNORECASE=1} {t=$3; if (t=="" || t ~ /(CHAR|CLOB|TEXT)/) print $2}'
}
