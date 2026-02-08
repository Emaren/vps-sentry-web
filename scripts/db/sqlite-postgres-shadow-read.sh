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

SHADOW_LIMIT="${SHADOW_LIMIT:-50}"
if ! [[ "$SHADOW_LIMIT" =~ ^[0-9]+$ ]] || [[ "$SHADOW_LIMIT" -le 0 ]]; then
  echo "invalid_shadow_limit:$SHADOW_LIMIT"
  exit 1
fi

WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/vps-sqlite-pg-shadow.XXXXXX")}"
mkdir -p "$WORK_DIR"

echo "shadow_read_limit:$SHADOW_LIMIT"
echo "shadow_work_dir:$WORK_DIR"

run_sqlite_query() {
  local query="$1"
  local out_file="$2"
  sqlite3 -separator $'\t' -nullvalue "$NULL_SENTINEL" "$SQLITE_DB_PATH" "$query" >"$out_file"
}

run_postgres_query() {
  local query="$1"
  local out_file="$2"
  psql "$POSTGRES_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F $'\t' -P "null=$NULL_SENTINEL" -c "$query" >"$out_file"
}

compare_query() {
  local name="$1"
  local sqlite_query="$2"
  local postgres_query="$3"
  local sqlite_out="$WORK_DIR/$name.sqlite.tsv"
  local postgres_out="$WORK_DIR/$name.postgres.tsv"

  run_sqlite_query "$sqlite_query" "$sqlite_out"
  run_postgres_query "$postgres_query" "$postgres_out"

  if ! diff -u "$sqlite_out" "$postgres_out" >/dev/null; then
    echo "shadow_read_fail:$name"
    diff -u "$sqlite_out" "$postgres_out" | sed -n '1,160p'
    return 1
  fi

  local rows
  rows="$(wc -l <"$sqlite_out" | tr -d ' ')"
  echo "shadow_read_ok:$name rows=$rows"
}

echo "shadow_read_phase:start"

Q_USERS="SELECT \"id\", COALESCE(\"email\", ''), COALESCE(\"role\", ''), COALESCE(\"plan\", ''), \"hostLimit\" FROM \"User\" ORDER BY \"id\" LIMIT $SHADOW_LIMIT;"
Q_HOSTS="SELECT \"id\", \"userId\", COALESCE(\"name\", ''), COALESCE(\"slug\", ''), CASE WHEN \"enabled\" THEN 1 ELSE 0 END FROM \"Host\" ORDER BY \"userId\", \"id\" LIMIT $SHADOW_LIMIT;"
Q_SNAPSHOTS="SELECT \"hostId\", \"id\", \"alertsCount\", \"publicPortsCount\" FROM \"HostSnapshot\" ORDER BY \"hostId\", \"ts\" DESC, \"id\" LIMIT $SHADOW_LIMIT;"
Q_BREACH_OPEN="SELECT \"hostId\", \"severity\", \"state\", COUNT(*) FROM \"Breach\" WHERE \"state\" = 'open' GROUP BY \"hostId\", \"severity\", \"state\" ORDER BY \"hostId\", \"severity\", \"state\" LIMIT $SHADOW_LIMIT;"
Q_NOTIFY_ENDPOINTS="SELECT \"userId\", \"kind\", CASE WHEN \"enabled\" THEN 1 ELSE 0 END, COUNT(*) FROM \"NotificationEndpoint\" GROUP BY \"userId\", \"kind\", \"enabled\" ORDER BY \"userId\", \"kind\", \"enabled\" LIMIT $SHADOW_LIMIT;"
Q_REMEDIATE_STATES="SELECT \"hostId\", \"state\", COUNT(*) FROM \"RemediationRun\" GROUP BY \"hostId\", \"state\" ORDER BY \"hostId\", \"state\" LIMIT $SHADOW_LIMIT;"
Q_AUDIT_ACTIONS="SELECT \"action\", COUNT(*) FROM \"AuditLog\" GROUP BY \"action\" ORDER BY \"action\" LIMIT $SHADOW_LIMIT;"

compare_query "users" "$Q_USERS" "$Q_USERS"
compare_query "hosts" "$Q_HOSTS" "$Q_HOSTS"
compare_query "snapshots" "$Q_SNAPSHOTS" "$Q_SNAPSHOTS"
compare_query "breach_open_rollup" "$Q_BREACH_OPEN" "$Q_BREACH_OPEN"
compare_query "notify_endpoints_rollup" "$Q_NOTIFY_ENDPOINTS" "$Q_NOTIFY_ENDPOINTS"
compare_query "remediation_rollup" "$Q_REMEDIATE_STATES" "$Q_REMEDIATE_STATES"
compare_query "audit_actions_rollup" "$Q_AUDIT_ACTIONS" "$Q_AUDIT_ACTIONS"

echo "shadow_read_phase:pass"
