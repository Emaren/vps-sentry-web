#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

VPS_HOST="${VPS_HOST:-hetzner-codex}"
VPS_WEB_PORT="${VPS_WEB_PORT:-3035}"
url="http://127.0.0.1:${VPS_WEB_PORT}/"
remote_mode=1

usage() {
  cat <<'USAGE'
Usage: ./scripts/security-headers-check.sh [--url URL] [--local|--remote]

Verifies key security headers are present.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      [[ $# -lt 2 ]] && { echo "[sec-headers] missing value for --url"; usage; exit 1; }
      url="$2"
      shift 2
      ;;
    --local)
      remote_mode=0
      shift
      ;;
    --remote)
      remote_mode=1
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[sec-headers] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$remote_mode" -eq 1 ]]; then
  headers="$(ssh "$VPS_HOST" "curl -sSI $(printf %q "$url")")"
else
  headers="$(curl -sSI "$url")"
fi

required=(
  "content-security-policy"
  "x-content-type-options"
  "x-frame-options"
  "referrer-policy"
  "permissions-policy"
  "cross-origin-opener-policy"
  "cross-origin-resource-policy"
)

missing=0
for h in "${required[@]}"; do
  if printf '%s\n' "$headers" | tr '[:upper:]' '[:lower:]' | grep -q "^${h}:"; then
    echo "[sec-headers] ok: $h"
  else
    echo "[sec-headers] missing: $h"
    missing=1
  fi
done

if [[ "$missing" -ne 0 ]]; then
  echo "[sec-headers] FAIL"
  exit 1
fi

echo "[sec-headers] PASS"
