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
EOF
}

require_app_dir() {
  if [[ -z "$VPS_APP_DIR" ]]; then
    echo "VPS_APP_DIR is not set. Add it in $ENV_FILE."
    exit 1
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

if [ -n "${VPS_GIT_REF:-}" ]; then
  target="$VPS_GIT_REF"
  echo sync_ref:$target
  git checkout "$target" >/dev/null 2>&1 || git checkout -b "$target" "origin/$target"
  git pull --ff-only origin "$target"
else
  current="$(git rev-parse --abbrev-ref HEAD)"
  if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
    echo sync_upstream:$(git rev-parse --abbrev-ref --symbolic-full-name "@{u}")
    git pull --ff-only
  elif git show-ref --verify --quiet "refs/remotes/origin/$current"; then
    echo sync_origin_branch:$current
    git pull --ff-only origin "$current"
  else
    default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed "s@^origin/@@")"
    if [ -z "$default_branch" ]; then
      default_branch="main"
    fi
    echo sync_fallback_branch:$default_branch
    git checkout "$default_branch" >/dev/null 2>&1 || git checkout -b "$default_branch" "origin/$default_branch"
    git pull --ff-only origin "$default_branch"
  fi
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
    remote_tty "VPS_GIT_REF=\"$VPS_GIT_REF\" bash -c 'set -euo pipefail; cd \"$VPS_APP_DIR\"; echo branch:\$(git rev-parse --abbrev-ref HEAD); $(git_sync_block); $(install_and_build_block)'"
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
