#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_ARCHIVE_BASE="${VPS_ARCHIVE_BASE:-/home/tony/_archive/vps-sentry}"
VPS_ARCHIVE_KEEP_DAYS="${VPS_ARCHIVE_KEEP_DAYS:-30}"
mode="apply"

usage() {
  cat <<'EOF'
Usage: ./scripts/vps-archive-prune.sh [--dry-run|--apply] [--days N]

Prunes VPS archive snapshots older than N days from VPS_ARCHIVE_BASE.

Env:
  VPS_HOST                SSH host (default: hetzner-codex)
  VPS_ARCHIVE_BASE        Archive root (default: /home/tony/_archive/vps-sentry)
  VPS_ARCHIVE_KEEP_DAYS   Retention days (default: 30)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      mode="dry-run"
      shift
      ;;
    --apply)
      mode="apply"
      shift
      ;;
    --days)
      if [[ $# -lt 2 ]]; then
        echo "missing value for --days"
        usage
        exit 1
      fi
      VPS_ARCHIVE_KEEP_DAYS="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if ! [[ "$VPS_ARCHIVE_KEEP_DAYS" =~ ^[0-9]+$ ]]; then
  echo "VPS_ARCHIVE_KEEP_DAYS must be an integer: $VPS_ARCHIVE_KEEP_DAYS"
  exit 1
fi

echo "[archive-prune] host: $VPS_HOST"
echo "[archive-prune] base: $VPS_ARCHIVE_BASE"
echo "[archive-prune] keep_days: $VPS_ARCHIVE_KEEP_DAYS"
echo "[archive-prune] mode: $mode"

ssh "$VPS_HOST" \
  "VPS_ARCHIVE_BASE=$(printf %q "$VPS_ARCHIVE_BASE") VPS_ARCHIVE_KEEP_DAYS=$(printf %q "$VPS_ARCHIVE_KEEP_DAYS") VPS_ARCHIVE_MODE=$(printf %q "$mode") bash -s" <<'REMOTE_EOF'
set -euo pipefail

if [[ ! -d "$VPS_ARCHIVE_BASE" ]]; then
  echo "[archive-prune] archive_base_missing:$VPS_ARCHIVE_BASE"
  exit 0
fi

to_prune="$(find "$VPS_ARCHIVE_BASE" -mindepth 1 -maxdepth 1 -type d -mtime +"$VPS_ARCHIVE_KEEP_DAYS" | sort || true)"

if [[ -z "$to_prune" ]]; then
  echo "[archive-prune] nothing_to_prune"
  exit 0
fi

echo "[archive-prune] candidates:"
echo "$to_prune"

if [[ "$VPS_ARCHIVE_MODE" == "dry-run" ]]; then
  echo "[archive-prune] dry_run_complete"
  exit 0
fi

while IFS= read -r dir; do
  [[ -z "$dir" ]] && continue
  rm -rf "$dir"
  echo "[archive-prune] removed:$dir"
done <<<"$to_prune"

find "$VPS_ARCHIVE_BASE" -mindepth 1 -type d -empty -delete || true
echo "[archive-prune] done"
REMOTE_EOF
