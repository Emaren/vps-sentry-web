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

run_remote() {
  ssh "$VPS_HOST" "$@"
}

read -r root_code login_code status_code <<CODES
$(run_remote "curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:$VPS_WEB_PORT/; curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:$VPS_WEB_PORT/login; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$VPS_WEB_PORT/api/status")
CODES

echo "[smoke] / => $root_code"
echo "[smoke] /login => $login_code"
echo "[smoke] /api/status => $status_code"

if [[ "$root_code" != "200" && "$root_code" != "307" ]]; then
  echo "[smoke] FAIL: unexpected / status $root_code"
  exit 1
fi

if [[ "$login_code" != "200" ]]; then
  echo "[smoke] FAIL: unexpected /login status $login_code"
  exit 1
fi

if [[ "$status_code" != "200" ]]; then
  echo "[smoke] FAIL: unexpected /api/status status $status_code"
  exit 1
fi

echo "[smoke] PASS"
