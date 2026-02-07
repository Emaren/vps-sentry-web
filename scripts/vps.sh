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

usage() {
  cat <<'EOF'
Usage: ./scripts/vps.sh <command> [args]

Commands:
  check                Validate SSH + app directory + optional service/pm2 target.
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
EOF
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
  fi
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
  ssh "$VPS_HOST" "$@"
}

remote_tty() {
  ssh -t "$VPS_HOST" "$@"
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

if node -e "const p=require(\"./package.json\"); process.exit(p?.scripts?.build ? 0 : 1)"; then
  npm run build
fi
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
    remote_tty "sudo systemctl restart '$VPS_SERVICE' && sudo systemctl status '$VPS_SERVICE' --no-pager -n 30"
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

case "$cmd" in
  check)
    require_app_dir
    remote "set -e; echo connected:\$(whoami)@\$(hostname); if [ ! -d '$VPS_APP_DIR' ]; then echo app_dir_missing:'$VPS_APP_DIR'; exit 1; fi; echo app_dir_ok:'$VPS_APP_DIR'; cd '$VPS_APP_DIR'; echo branch:\$(git rev-parse --abbrev-ref HEAD); echo commit:\$(git rev-parse --short HEAD)"
    if [[ -n "$VPS_SERVICE" ]]; then
      remote "systemctl is-active '$VPS_SERVICE' >/dev/null 2>&1 && echo service_active:'$VPS_SERVICE' || echo service_inactive:'$VPS_SERVICE'"
    fi
    if [[ -n "$VPS_PM2_APP" ]]; then
      remote "pm2 describe '$VPS_PM2_APP' >/dev/null 2>&1 && echo pm2_ok:'$VPS_PM2_APP' || echo pm2_missing:'$VPS_PM2_APP'"
    fi
    ;;

  deploy)
    require_app_dir
    require_local_deploy_safety
    remote_tty "VPS_GIT_REF=\"$VPS_GIT_REF\" VPS_DEPLOY_STRATEGY=\"$VPS_DEPLOY_STRATEGY\" bash -c 'set -euo pipefail; cd \"$VPS_APP_DIR\"; echo branch:\$(git rev-parse --abbrev-ref HEAD); $(git_sync_block); $(install_and_build_block)'"
    restart_target
    ;;

  restart)
    restart_target
    ;;

  logs)
    if [[ -n "$VPS_SERVICE" ]]; then
      remote_tty "sudo journalctl -u '$VPS_SERVICE' -n '$VPS_LOG_LINES' -f --no-pager"
      exit 0
    fi
    if [[ -n "$VPS_PM2_APP" ]]; then
      remote_tty "pm2 logs '$VPS_PM2_APP' --lines '$VPS_LOG_LINES'"
      exit 0
    fi
    echo "No log target configured. Set VPS_SERVICE or VPS_PM2_APP in $ENV_FILE."
    exit 1
    ;;

  rollback)
    require_app_dir
    target="${arg:-HEAD~1}"
    remote_tty "bash -c 'set -euo pipefail; cd \"$VPS_APP_DIR\"; git fetch --all --prune; git rev-parse \"$target\" >/dev/null; echo rollback_to:$target; git reset --hard \"$target\"; $(install_and_build_block)'"
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
