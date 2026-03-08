#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"

usage() {
  cat <<'EOF'
Usage: bash vps-remote-app-workflow.sh <deploy|restart|rollback|canary>

This script is streamed over SSH by scripts/vps.sh. It is not meant to be run directly
without the expected VPS_* environment variables.
EOF
}

log() {
  printf 'vps-remote-app-workflow: %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    die "$name must be a positive integer: $value"
  fi
}

require_app_dir() {
  [[ -n "${VPS_APP_DIR:-}" ]] || die "VPS_APP_DIR is required"
  [[ -d "${VPS_APP_DIR}" ]] || die "VPS_APP_DIR missing: ${VPS_APP_DIR}"
}

require_noninteractive_sudo_remote() {
  if [[ "${VPS_REQUIRE_NONINTERACTIVE_SUDO:-1}" != "1" ]]; then
    return 0
  fi

  if [[ -n "${VPS_SERVICE:-}" ]]; then
    sudo -n systemctl show --property=Id "${VPS_SERVICE}" >/dev/null 2>&1 || die "sudo -n systemctl unavailable for ${VPS_SERVICE}"
  elif [[ "${VPS_DEPLOY_USE_MAINTENANCE:-1}" == "1" ]]; then
    sudo -n true >/dev/null 2>&1 || die "sudo -n unavailable for maintenance workflow"
  fi
}

git_sync() {
  git fetch --all --prune

  if ! git diff --quiet || ! git diff --cached --quiet; then
    dirty_status="$(git status --short)"
    only_generated=1
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      path="${line#?? }"
      if [[ "$path" != "next-env.d.ts" ]]; then
        only_generated=0
        break
      fi
    done <<__DIRTY_STATUS__
$dirty_status
__DIRTY_STATUS__

    if [[ "$only_generated" -eq 1 ]]; then
      echo "remote_worktree_autoclean:next-env.d.ts"
      git checkout -- next-env.d.ts
    else
      echo "remote_worktree_dirty:commit/stash/reset remote changes before deploy"
      echo "$dirty_status"
      exit 40
    fi
  fi

  if [[ -n "${VPS_GIT_REF:-}" ]]; then
    target="$VPS_GIT_REF"
    echo "sync_ref:$target"
  else
    current="$(git rev-parse --abbrev-ref HEAD)"
    if git show-ref --verify --quiet "refs/remotes/origin/$current"; then
      echo "sync_origin_branch:$current"
      target="$current"
    else
      default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
      if [[ -z "$default_branch" ]]; then
        default_branch="main"
      fi
      echo "sync_fallback_branch:$default_branch"
      target="$default_branch"
    fi
  fi

  if ! git show-ref --verify --quiet "refs/remotes/origin/$target"; then
    echo "sync_error:origin/$target does not exist"
    exit 41
  fi

  git checkout "$target" >/dev/null 2>&1 || git checkout -b "$target" "origin/$target"

  divergence="$(git rev-list --left-right --count HEAD...origin/$target)"
  set -- $divergence
  ahead="${1:-0}"
  behind="${2:-0}"
  echo "sync_divergence:ahead=$ahead behind=$behind"

  if [[ "$ahead" -gt 0 ]]; then
    if [[ "${VPS_DEPLOY_STRATEGY:-abort}" == "reset" ]]; then
      backup_branch="backup/pre-deploy-$(date +%Y%m%d-%H%M%S)"
      git branch "$backup_branch" HEAD >/dev/null 2>&1 || true
      echo "sync_backup_branch:$backup_branch"
      git reset --hard "origin/$target"
    else
      echo "sync_blocked:remote has local-only commits on $target"
      echo "hint:set VPS_DEPLOY_STRATEGY=reset to auto-backup + hard reset"
      exit 42
    fi
  elif [[ "$behind" -gt 0 ]]; then
    git pull --ff-only origin "$target"
  else
    echo "sync_up_to_date:$target"
  fi
}

install_and_build() {
  if [[ -f pnpm-lock.yaml ]]; then
    export CI="${CI:-true}"
    if command -v pnpm >/dev/null 2>&1; then
      pnpm install --frozen-lockfile
    elif command -v corepack >/dev/null 2>&1; then
      corepack pnpm install --frozen-lockfile
    else
      npm install
    fi
  elif [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi

  if [[ -x ./scripts/db/prisma-generate-provider.sh ]]; then
    ./scripts/db/prisma-generate-provider.sh "${VPS_DB_PROVIDER:-sqlite}"
  fi

  if [[ "${VPS_RUN_DB_MIGRATIONS:-1}" == "1" ]] && [[ -d prisma/migrations ]]; then
    PRISMA_SCHEMA="prisma/schema.prisma"
    if [[ "${VPS_DB_PROVIDER:-sqlite}" == "postgres" ]]; then
      PRISMA_SCHEMA="prisma/schema.postgres.prisma"
    fi

    if command -v npx >/dev/null 2>&1; then
      npx prisma migrate deploy --schema "$PRISMA_SCHEMA"
    elif [[ -x ./node_modules/.bin/prisma ]]; then
      ./node_modules/.bin/prisma migrate deploy --schema "$PRISMA_SCHEMA"
    else
      echo "prisma_migrate_skipped:no_prisma_binary"
    fi
  fi

  if node -e 'const p=require("./package.json"); process.exit(p?.scripts?.build ? 0 : 1)'; then
    npm run build
  fi
}

restart_target() {
  if [[ -n "${VPS_SERVICE:-}" ]]; then
    require_noninteractive_sudo_remote
    sudo -n systemctl restart "${VPS_SERVICE}"
    sudo -n systemctl is-active "${VPS_SERVICE}" >/dev/null
    echo "service_active:${VPS_SERVICE}"
    sudo -n systemctl status "${VPS_SERVICE}" --no-pager -n 30
    return 0
  fi

  if [[ -n "${VPS_PM2_APP:-}" ]]; then
    pm2 restart "${VPS_PM2_APP}"
    pm2 status "${VPS_PM2_APP}"
    return 0
  fi

  die "No restart target configured. Set VPS_SERVICE or VPS_PM2_APP."
}

diagnostics_on_failure() {
  if [[ -n "${VPS_SERVICE:-}" ]]; then
    echo "deploy_canary_diagnostics:systemd:${VPS_SERVICE}"
    sudo -n systemctl status "${VPS_SERVICE}" --no-pager -n 40 || true
    sudo -n journalctl -u "${VPS_SERVICE}" -n 120 --no-pager || true
    return 0
  fi

  if [[ -n "${VPS_PM2_APP:-}" ]]; then
    echo "deploy_canary_diagnostics:pm2:${VPS_PM2_APP}"
    pm2 status "${VPS_PM2_APP}" || true
    pm2 logs "${VPS_PM2_APP}" --lines 80 --nostream || true
  fi
}

maintenance_scope() {
  if [[ -n "${VPS_SERVICE:-}" ]]; then
    printf '%s' "${VPS_SERVICE}"
    return 0
  fi
  if [[ -n "${VPS_PM2_APP:-}" ]]; then
    printf '%s' "${VPS_PM2_APP}"
    return 0
  fi
  return 1
}

MAINTENANCE_STARTED=0
MAINTENANCE_SCOPE=""

stop_maintenance() {
  if [[ "$MAINTENANCE_STARTED" -ne 1 ]] || [[ -z "$MAINTENANCE_SCOPE" ]]; then
    return 0
  fi
  sudo -n /usr/local/bin/vps-sentry-maintenance stop --scope "$MAINTENANCE_SCOPE" >/dev/null 2>&1 || true
  echo "maintenance_cleared:scope=$MAINTENANCE_SCOPE"
}

start_maintenance() {
  local reason="$1"
  if [[ "${VPS_DEPLOY_USE_MAINTENANCE:-1}" != "1" ]]; then
    echo "maintenance:skipped"
    return 0
  fi

  if [[ ! -x /usr/local/bin/vps-sentry-maintenance ]]; then
    die "maintenance helper missing: /usr/local/bin/vps-sentry-maintenance"
  fi

  MAINTENANCE_SCOPE="$(maintenance_scope || true)"
  [[ -n "$MAINTENANCE_SCOPE" ]] || die "maintenance requested but no service or pm2 scope configured"

  require_noninteractive_sudo_remote
  sudo -n /usr/local/bin/vps-sentry-maintenance start --scope "$MAINTENANCE_SCOPE" --ttl "${VPS_DEPLOY_MAINTENANCE_TTL:-15m}" --reason "$reason"
  MAINTENANCE_STARTED=1
  echo "maintenance_active:scope=$MAINTENANCE_SCOPE ttl=${VPS_DEPLOY_MAINTENANCE_TTL:-15m} reason=$reason"
}

probe_canary_once() {
  local base_url root_code login_code ready_code status_code ready_file summary summary_rc
  local errors=()

  base_url="http://127.0.0.1:${VPS_WEB_PORT:-3035}"
  ready_file="$(mktemp)"

  root_code="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/" || echo 000)"
  login_code="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/login" || echo 000)"
  ready_code="$(curl -sS -o "$ready_file" -w '%{http_code}' "$base_url/api/readyz?check=status" || echo 000)"
  status_code="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/status" || echo 000)"

  set +e
  summary="$(python3 - "$ready_file" <<'PY'
import json
import sys

path = sys.argv[1]

try:
    with open(path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
except Exception as exc:
    print(f"readyz_json_error={exc}")
    raise SystemExit(3)

checks = payload.get("checks") or {}
status = checks.get("status") or {}
files = status.get("files") or {}
missing = [name for name in ("status", "last", "diff") if files.get(name) is not True]
app_ok = bool(payload.get("ok")) and bool(status.get("ok"))

if app_ok and not missing:
    print("readyz_ok")
    raise SystemExit(0)

detail = status.get("error") or "status_files_unhealthy"
if missing:
    detail = f"{detail} missing={','.join(missing)}"
print(detail)
raise SystemExit(4)
PY
)"
  summary_rc=$?
  set -e

  rm -f "$ready_file"

  if [[ "$root_code" != "200" && "$root_code" != "307" ]]; then
    errors+=("root=$root_code")
  fi
  if [[ "$login_code" != "200" ]]; then
    errors+=("login=$login_code")
  fi
  if [[ "$ready_code" != "200" || "$summary_rc" -ne 0 ]]; then
    errors+=("readyz=$ready_code detail=$summary")
  fi
  if [[ "$status_code" != "200" && "$status_code" != "401" ]]; then
    errors+=("status=$status_code")
  fi

  if [[ "${#errors[@]}" -eq 0 ]]; then
    printf 'root=%s login=%s readyz=%s status=%s detail=%s\n' "$root_code" "$login_code" "$ready_code" "$status_code" "$summary"
    return 0
  fi

  printf '%s\n' "${errors[*]}"
  return 1
}

run_canary() {
  local required interval timeout attempt deadline consecutive output

  if [[ "${VPS_DEPLOY_CANARY_ENABLED:-1}" != "1" ]]; then
    echo "deploy_canary:skipped"
    return 0
  fi

  required="${VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES:-3}"
  interval="${VPS_DEPLOY_CANARY_INTERVAL_SECONDS:-3}"
  timeout="${VPS_DEPLOY_CANARY_TIMEOUT_SECONDS:-120}"

  require_positive_int "VPS_DEPLOY_CANARY_REQUIRED_SUCCESSES" "$required"
  require_positive_int "VPS_DEPLOY_CANARY_INTERVAL_SECONDS" "$interval"
  require_positive_int "VPS_DEPLOY_CANARY_TIMEOUT_SECONDS" "$timeout"
  require_positive_int "VPS_WEB_PORT" "${VPS_WEB_PORT:-3035}"

  attempt=0
  consecutive=0
  deadline="$(( $(date +%s) + timeout ))"

  while true; do
    attempt="$(( attempt + 1 ))"
    if output="$(probe_canary_once)"; then
      consecutive="$(( consecutive + 1 ))"
      echo "deploy_canary_probe_${attempt}:pass consecutive=${consecutive}/${required} ${output}"
      if [[ "$consecutive" -ge "$required" ]]; then
        echo "deploy_canary:pass attempts=$attempt"
        return 0
      fi
    else
      consecutive=0
      echo "deploy_canary_probe_${attempt}:fail ${output}"
    fi

    if [[ "$(date +%s)" -ge "$deadline" ]]; then
      echo "deploy_canary:fail timeout=${timeout}s attempts=$attempt"
      diagnostics_on_failure
      return 61
    fi

    sleep "$interval"
  done
}

run_deploy() {
  require_app_dir
  cd "${VPS_APP_DIR}"
  echo "branch:$(git rev-parse --abbrev-ref HEAD)"
  git_sync
  install_and_build
  start_maintenance "deploy:${VPS_SERVICE:-${VPS_PM2_APP:-app}}"
  restart_target
  run_canary
}

run_restart() {
  require_app_dir
  cd "${VPS_APP_DIR}"
  start_maintenance "restart:${VPS_SERVICE:-${VPS_PM2_APP:-app}}"
  restart_target
  run_canary
}

run_rollback() {
  require_app_dir
  cd "${VPS_APP_DIR}"
  target="${VPS_ROLLBACK_TARGET:-HEAD~1}"
  git fetch --all --prune
  git rev-parse "$target" >/dev/null
  echo "rollback_to:$target"
  git reset --hard "$target"
  install_and_build
  start_maintenance "rollback:${VPS_SERVICE:-${VPS_PM2_APP:-app}}"
  restart_target
  run_canary
}

run_canary_only() {
  run_canary
}

trap stop_maintenance EXIT

case "$action" in
  deploy)
    run_deploy
    ;;
  restart)
    run_restart
    ;;
  rollback)
    run_rollback
    ;;
  canary)
    run_canary_only
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    die "unknown action: $action"
    ;;
esac
