#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_APP_DIR="${VPS_APP_DIR:-}"
VPS_SERVICE="${VPS_SERVICE:-}"
VPS_PM2_APP="${VPS_PM2_APP:-}"
VPS_LOG_LINES="${VPS_LOG_LINES:-150}"
VPS_GIT_REF="${VPS_GIT_REF:-}"
VPS_DEPLOY_STRATEGY="${VPS_DEPLOY_STRATEGY:-abort}"
VPS_REQUIRE_CLEAN_LOCAL="${VPS_REQUIRE_CLEAN_LOCAL:-1}"
VPS_REQUIRE_PUSHED_REF="${VPS_REQUIRE_PUSHED_REF:-1}"
VPS_REQUIRE_NONINTERACTIVE_SUDO="${VPS_REQUIRE_NONINTERACTIVE_SUDO:-1}"
VPS_SSH_CONNECT_TIMEOUT="${VPS_SSH_CONNECT_TIMEOUT:-10}"
VPS_SSH_CONNECTION_ATTEMPTS="${VPS_SSH_CONNECTION_ATTEMPTS:-2}"
VPS_SSH_SERVER_ALIVE_INTERVAL="${VPS_SSH_SERVER_ALIVE_INTERVAL:-15}"
VPS_SSH_SERVER_ALIVE_COUNT_MAX="${VPS_SSH_SERVER_ALIVE_COUNT_MAX:-3}"
VPS_SSH_RETRIES="${VPS_SSH_RETRIES:-4}"
VPS_SSH_RETRY_DELAY_SECONDS="${VPS_SSH_RETRY_DELAY_SECONDS:-5}"
VPS_DB_PROVIDER="${VPS_DB_PROVIDER:-sqlite}"
VPS_RUN_DB_MIGRATIONS="${VPS_RUN_DB_MIGRATIONS:-1}"

usage() {
  cat <<'EOF'
Usage: ./scripts/vps.sh <command> [args]

Commands:
  check                Validate SSH + app directory + optional service/pm2 target.
  doctor               Run fail-fast readiness checks for SSH/sudo/restart path.
  deploy               Pull latest code, install deps, build, then restart app target.
  restart              Restart app target (systemd or pm2).
  logs                 Tail app logs (systemd journal or pm2 logs).
  rollback [commitish] Roll back app directory to commitish (default: HEAD~1), then restart.

Config:
  Create .vps.env from .vps.example.env.

Deploy safety knobs:
  VPS_DEPLOY_STRATEGY=abort|reset
    - abort (default): fail deploy when remote branch has local-only commits.
    - reset: create backup branch on VPS, then hard-reset to origin/<target>.
  VPS_REQUIRE_CLEAN_LOCAL=1|0
    - 1 (default): require clean local git worktree before deploy.
  VPS_REQUIRE_PUSHED_REF=1|0
    - 1 (default): if VPS_GIT_REF is set, require local HEAD to exist on origin/<ref>.
  VPS_REQUIRE_NONINTERACTIVE_SUDO=1|0
    - 1 (default): fail fast if sudo would prompt (zero-interactive deploy mode).

SSH reliability knobs:
  VPS_SSH_CONNECT_TIMEOUT=10
  VPS_SSH_CONNECTION_ATTEMPTS=2
  VPS_SSH_SERVER_ALIVE_INTERVAL=15
  VPS_SSH_SERVER_ALIVE_COUNT_MAX=3
  VPS_SSH_RETRIES=4
  VPS_SSH_RETRY_DELAY_SECONDS=5

DB provider knob:
  VPS_DB_PROVIDER=sqlite|postgres
    - sqlite (default): generate Prisma client from prisma/schema.prisma
    - postgres: generate Prisma client from prisma/schema.postgres.prisma
  VPS_RUN_DB_MIGRATIONS=1|0
    - 1 (default): run `prisma migrate deploy` during VPS deploy.
EOF
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -le 0 ]]; then
    echo "$name must be a positive integer: $value"
    exit 1
  fi
}

validate_runtime_config() {
  require_positive_int "VPS_SSH_CONNECT_TIMEOUT" "$VPS_SSH_CONNECT_TIMEOUT"
  require_positive_int "VPS_SSH_CONNECTION_ATTEMPTS" "$VPS_SSH_CONNECTION_ATTEMPTS"
  require_positive_int "VPS_SSH_SERVER_ALIVE_INTERVAL" "$VPS_SSH_SERVER_ALIVE_INTERVAL"
  require_positive_int "VPS_SSH_SERVER_ALIVE_COUNT_MAX" "$VPS_SSH_SERVER_ALIVE_COUNT_MAX"
  require_positive_int "VPS_SSH_RETRIES" "$VPS_SSH_RETRIES"
  require_positive_int "VPS_SSH_RETRY_DELAY_SECONDS" "$VPS_SSH_RETRY_DELAY_SECONDS"

  case "$VPS_DB_PROVIDER" in
    sqlite|postgres) ;;
    *)
      echo "VPS_DB_PROVIDER must be sqlite or postgres: $VPS_DB_PROVIDER"
      exit 1
      ;;
  esac
}

require_local_deploy_safety() {
  if [[ "$VPS_REQUIRE_CLEAN_LOCAL" == "1" ]]; then
    if ! git -C "$ROOT_DIR" diff --quiet || ! git -C "$ROOT_DIR" diff --cached --quiet; then
      echo "local_worktree_dirty: commit/stash changes before deploy, or set VPS_REQUIRE_CLEAN_LOCAL=0"
      git -C "$ROOT_DIR" status --short
      exit 1
    fi
  fi

  if [[ "$VPS_REQUIRE_PUSHED_REF" == "1" && -n "$VPS_GIT_REF" ]]; then
    if git -C "$ROOT_DIR" show-ref --verify --quiet "refs/remotes/origin/$VPS_GIT_REF"; then
      if ! git -C "$ROOT_DIR" merge-base --is-ancestor HEAD "origin/$VPS_GIT_REF"; then
        echo "local_head_not_pushed: HEAD is not on origin/$VPS_GIT_REF"
        echo "hint: push first or set VPS_REQUIRE_PUSHED_REF=0"
        exit 1
      fi
    fi
  fi
}

remote() {
  local attempt=1
  local max_attempts="$VPS_SSH_RETRIES"
  local retry_delay="$VPS_SSH_RETRY_DELAY_SECONDS"
  local exit_code=0

  while true; do
    if ssh \
      -o BatchMode=yes \
      -o LogLevel=ERROR \
      -o ConnectTimeout="$VPS_SSH_CONNECT_TIMEOUT" \
      -o ConnectionAttempts="$VPS_SSH_CONNECTION_ATTEMPTS" \
      -o ServerAliveInterval="$VPS_SSH_SERVER_ALIVE_INTERVAL" \
      -o ServerAliveCountMax="$VPS_SSH_SERVER_ALIVE_COUNT_MAX" \
      "$VPS_HOST" "$@"; then
      return 0
    else
      exit_code=$?
    fi

    if [[ "$exit_code" -ne 255 || "$attempt" -ge "$max_attempts" ]]; then
      return "$exit_code"
    fi

    echo "ssh_retry:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

remote_tty() {
  local attempt=1
  local max_attempts="$VPS_SSH_RETRIES"
  local retry_delay="$VPS_SSH_RETRY_DELAY_SECONDS"
  local exit_code=0

  while true; do
    if ssh -tt \
      -o BatchMode=yes \
      -o LogLevel=ERROR \
      -o ConnectTimeout="$VPS_SSH_CONNECT_TIMEOUT" \
      -o ConnectionAttempts="$VPS_SSH_CONNECTION_ATTEMPTS" \
      -o ServerAliveInterval="$VPS_SSH_SERVER_ALIVE_INTERVAL" \
      -o ServerAliveCountMax="$VPS_SSH_SERVER_ALIVE_COUNT_MAX" \
      "$VPS_HOST" "$@"; then
      return 0
    else
      exit_code=$?
    fi

    if [[ "$exit_code" -ne 255 || "$attempt" -ge "$max_attempts" ]]; then
      return "$exit_code"
    fi

    echo "ssh_retry_tty:$attempt/$max_attempts host=$VPS_HOST delay=${retry_delay}s" >&2
    sleep "$retry_delay"
    attempt=$((attempt + 1))
  done
}

check_ssh_connectivity() {
  local err=""
  if ! err="$(remote "echo ssh_ok:\$(whoami)@\$(hostname)" 2>&1 >/dev/null)"; then
    echo "ssh_unreachable:$VPS_HOST"
    echo "hint: verify sshd is running, port 22 is open, and key auth works."
    if [[ -n "$err" ]]; then
      echo "ssh_error:$err"
    fi
    exit 50
  fi
}

require_noninteractive_sudo() {
  if [[ "$VPS_REQUIRE_NONINTERACTIVE_SUDO" != "1" ]]; then
    return
  fi

  if [[ -z "$VPS_SERVICE" ]]; then
    return
  fi

  local err=""
  if ! err="$(remote "sudo -n systemctl show --property=Id '$VPS_SERVICE' >/dev/null 2>&1" 2>&1 >/dev/null)"; then
    if [[ "$err" == *"Connection refused"* || "$err" == *"timed out"* || "$err" == *"No route to host"* ]]; then
      echo "ssh_unreachable:$VPS_HOST"
      echo "hint: transport failure occurred while checking non-interactive sudo."
      echo "ssh_error:$err"
      exit 50
    fi

    cat <<'EOF'
sudo_noninteractive_required: cannot run sudo -n on VPS.
This deploy flow is zero-interactive and will not wait for password prompts.
Fix options:
  1) Configure NOPASSWD sudo for service restart/status/log commands.
  2) Set VPS_REQUIRE_NONINTERACTIVE_SUDO=0 (not recommended).
See docs/vps-recovery-runbook.md.
EOF
    if [[ -n "$err" ]]; then
      echo "sudo_probe_error:$err"
    fi
    exit 51
  fi
}

install_and_build_block() {
  cat <<'EOF'
if [ -f pnpm-lock.yaml ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  elif command -v corepack >/dev/null 2>&1; then
    corepack pnpm install --frozen-lockfile
  else
    npm install
  fi
elif [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

if [ -x ./scripts/db/prisma-generate-provider.sh ]; then
  ./scripts/db/prisma-generate-provider.sh "${VPS_DB_PROVIDER:-sqlite}"
fi

if [ "${VPS_RUN_DB_MIGRATIONS:-1}" = "1" ] && [ -d prisma/migrations ]; then
  PRISMA_SCHEMA="prisma/schema.prisma"
  if [ "${VPS_DB_PROVIDER:-sqlite}" = "postgres" ]; then
    PRISMA_SCHEMA="prisma/schema.postgres.prisma"
  fi

  if command -v npx >/dev/null 2>&1; then
    npx prisma migrate deploy --schema "$PRISMA_SCHEMA"
  elif [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma migrate deploy --schema "$PRISMA_SCHEMA"
  else
    echo "prisma_migrate_skipped:no_prisma_binary"
  fi
fi

if node -e "const p=require(\"./package.json\"); process.exit(p?.scripts?.build ? 0 : 1)"; then
  npm run build
fi
EOF
}

restart_block() {
  if [[ -n "$VPS_SERVICE" ]]; then
    cat <<EOF
if [ "\${VPS_REQUIRE_NONINTERACTIVE_SUDO:-1}" = "1" ]; then
  sudo -n systemctl show --property=Id '$VPS_SERVICE' >/dev/null 2>&1
fi
sudo -n systemctl restart '$VPS_SERVICE'
sudo -n systemctl is-active '$VPS_SERVICE' >/dev/null
echo service_active:'$VPS_SERVICE'
sudo -n systemctl status '$VPS_SERVICE' --no-pager -n 30
EOF
    return
  fi

  if [[ -n "$VPS_PM2_APP" ]]; then
    cat <<EOF
pm2 restart '$VPS_PM2_APP'
pm2 status '$VPS_PM2_APP'
EOF
    return
  fi

  cat <<'EOF'
echo "No restart target configured. Set VPS_SERVICE or VPS_PM2_APP in .vps.env."
exit 1
EOF
}

git_sync_block() {
  cat <<'EOF'
git fetch --all --prune

# Never deploy over a dirty remote working tree.
if ! git diff --quiet || ! git diff --cached --quiet; then
  dirty_status="$(git status --short)"
  only_generated=1
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    path="${line#?? }"
    if [ "$path" != "next-env.d.ts" ]; then
      only_generated=0
      break
    fi
  done <<__DIRTY_STATUS__
$dirty_status
__DIRTY_STATUS__

  if [ "$only_generated" -eq 1 ]; then
    echo "remote_worktree_autoclean: next-env.d.ts"
    git checkout -- next-env.d.ts
  else
    echo "remote_worktree_dirty: commit/stash/reset remote changes before deploy"
    echo "$dirty_status"
    exit 40
  fi
fi

if [ -n "${VPS_GIT_REF:-}" ]; then
  target="$VPS_GIT_REF"
  echo sync_ref:$target
else
  current="$(git rev-parse --abbrev-ref HEAD)"
  if git show-ref --verify --quiet "refs/remotes/origin/$current"; then
    echo sync_origin_branch:$current
    target="$current"
  else
    default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s@^origin/@@")"
    if [ -z "$default_branch" ]; then
      default_branch="main"
    fi
    echo sync_fallback_branch:$default_branch
    target="$default_branch"
  fi
fi

if ! git show-ref --verify --quiet "refs/remotes/origin/$target"; then
  echo "sync_error: origin/$target does not exist"
  exit 41
fi

git checkout "$target" >/dev/null 2>&1 || git checkout -b "$target" "origin/$target"

divergence="$(git rev-list --left-right --count HEAD...origin/$target)"
set -- $divergence
ahead="${1:-0}"
behind="${2:-0}"
echo "sync_divergence:ahead=$ahead behind=$behind"

if [ "$ahead" -gt 0 ]; then
  if [ "${VPS_DEPLOY_STRATEGY:-abort}" = "reset" ]; then
    backup_branch="backup/pre-deploy-$(date +%Y%m%d-%H%M%S)"
    git branch "$backup_branch" HEAD >/dev/null 2>&1 || true
    echo "sync_backup_branch:$backup_branch"
    git reset --hard "origin/$target"
  else
    echo "sync_blocked: remote has local-only commits on $target"
    echo "hint: set VPS_DEPLOY_STRATEGY=reset to auto-backup + hard reset"
    exit 42
  fi
elif [ "$behind" -gt 0 ]; then
  git pull --ff-only origin "$target"
else
  echo "sync_up_to_date:$target"
fi
EOF
}

restart_target() {
  if [[ -n "$VPS_SERVICE" ]]; then
    require_noninteractive_sudo
    remote "set -eu; sudo -n systemctl restart '$VPS_SERVICE'; sudo -n systemctl is-active '$VPS_SERVICE' >/dev/null; echo service_active:'$VPS_SERVICE'; sudo -n systemctl status '$VPS_SERVICE' --no-pager -n 30"
    return
  fi

  if [[ -n "$VPS_PM2_APP" ]]; then
    remote "pm2 restart '$VPS_PM2_APP' && pm2 status '$VPS_PM2_APP'"
    return
  fi

  echo "No restart target configured. Set VPS_SERVICE or VPS_PM2_APP in $ENV_FILE."
  exit 1
}

cmd="${1:-}"
arg="${2:-}"

validate_runtime_config

case "$cmd" in
  check)
    require_app_dir
    remote "set -e
      echo connected:\$(whoami)@\$(hostname)
      if [ ! -d '$VPS_APP_DIR' ]; then
        echo app_dir_missing:'$VPS_APP_DIR'
        exit 1
      fi
      echo app_dir_ok:'$VPS_APP_DIR'
      cd '$VPS_APP_DIR'
      echo branch:\$(git rev-parse --abbrev-ref HEAD)
      echo commit:\$(git rev-parse --short HEAD)

      if [ -n '$VPS_SERVICE' ]; then
        if systemctl is-active '$VPS_SERVICE' >/dev/null 2>&1; then
          echo service_active:'$VPS_SERVICE'
        else
          echo service_inactive:'$VPS_SERVICE'
        fi
      fi

      if [ -n '$VPS_PM2_APP' ]; then
        if pm2 describe '$VPS_PM2_APP' >/dev/null 2>&1; then
          echo pm2_ok:'$VPS_PM2_APP'
        else
          echo pm2_missing:'$VPS_PM2_APP'
        fi
      fi"
    ;;

  doctor)
    require_app_dir
    remote "set -eu
      doctor_ok=1

      echo doctor_connected:\$(whoami)@\$(hostname)
      if [ ! -d '$VPS_APP_DIR' ]; then
        echo doctor_app_dir_missing:'$VPS_APP_DIR'
        exit 1
      fi
      if [ ! -d '$VPS_APP_DIR/.git' ]; then
        echo doctor_app_not_git:'$VPS_APP_DIR'
        exit 1
      fi
      echo doctor_app_dir_ok:'$VPS_APP_DIR'

      if [ -n '$VPS_SERVICE' ]; then
        if sudo -n systemctl show --property=Id '$VPS_SERVICE' >/dev/null 2>&1; then
          echo doctor_sudo_noninteractive:ok
        else
          echo doctor_sudo_noninteractive:missing
          if [ '$VPS_REQUIRE_NONINTERACTIVE_SUDO' = '1' ]; then
            doctor_ok=0
          fi
        fi

        if systemctl cat '$VPS_SERVICE' >/dev/null 2>&1; then
          echo doctor_service_unit_found:'$VPS_SERVICE'
        else
          echo doctor_service_unit_missing:'$VPS_SERVICE'
        fi
      fi

      if [ -n '$VPS_PM2_APP' ]; then
        if pm2 describe '$VPS_PM2_APP' >/dev/null 2>&1; then
          echo doctor_pm2_ok:'$VPS_PM2_APP'
        else
          echo doctor_pm2_missing:'$VPS_PM2_APP'
        fi
      fi

      if [ \"\$doctor_ok\" -ne 1 ]; then
        echo doctor_fail:non-interactive sudo is required but unavailable
        exit 51
      fi

      echo doctor_pass"
    ;;

  deploy)
    require_app_dir
    require_local_deploy_safety
    check_ssh_connectivity
    remote "VPS_GIT_REF=\"$VPS_GIT_REF\" VPS_DEPLOY_STRATEGY=\"$VPS_DEPLOY_STRATEGY\" VPS_REQUIRE_NONINTERACTIVE_SUDO=\"$VPS_REQUIRE_NONINTERACTIVE_SUDO\" VPS_DB_PROVIDER=\"$VPS_DB_PROVIDER\" bash -c 'set -euo pipefail; cd \"$VPS_APP_DIR\"; echo branch:\$(git rev-parse --abbrev-ref HEAD); $(git_sync_block); $(install_and_build_block); $(restart_block)'"
    ;;

  restart)
    restart_target
    ;;

  logs)
    if [[ -n "$VPS_SERVICE" ]]; then
      check_ssh_connectivity
      require_noninteractive_sudo
      remote_tty "sudo -n journalctl -u '$VPS_SERVICE' -n '$VPS_LOG_LINES' -f --no-pager"
      exit 0
    fi
    if [[ -n "$VPS_PM2_APP" ]]; then
      check_ssh_connectivity
      remote_tty "pm2 logs '$VPS_PM2_APP' --lines '$VPS_LOG_LINES'"
      exit 0
    fi
    echo "No log target configured. Set VPS_SERVICE or VPS_PM2_APP in $ENV_FILE."
    exit 1
    ;;

  rollback)
    require_app_dir
    target="${arg:-HEAD~1}"
    check_ssh_connectivity
    require_noninteractive_sudo
    remote "VPS_DB_PROVIDER=\"$VPS_DB_PROVIDER\" bash -c 'set -euo pipefail; cd \"$VPS_APP_DIR\"; git fetch --all --prune; git rev-parse \"$target\" >/dev/null; echo rollback_to:$target; git reset --hard \"$target\"; $(install_and_build_block)'"
    restart_target
    ;;

  ""|-h|--help|help)
    usage
    ;;

  *)
    echo "Unknown command: $cmd"
    usage
    exit 1
    ;;
esac
