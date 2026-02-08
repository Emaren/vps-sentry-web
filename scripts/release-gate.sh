#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[gate] branch: $(git rev-parse --abbrev-ref HEAD)"

echo "[gate] test"
npm test

echo "[gate] typecheck"
npx tsc --noEmit

echo "[gate] supply-chain-check"
./scripts/supply-chain-check.sh --no-lock-verify

echo "[gate] vps-check"
./scripts/vps.sh check

echo "[gate] vps-ssh-stability-check"
./scripts/vps.sh ssh-stability-check

echo "[gate] vps-hygiene-check"
./scripts/vps-hygiene-check.sh

echo "[gate] smoke"
./scripts/release-smoke.sh

if [[ "${VPS_GATE_INCLUDE_CHAOS:-0}" == "1" ]]; then
  echo "[gate] chaos-certify"
  ./scripts/chaos-certify.sh --remote --skip-restart
fi

echo "[gate] PASS"
