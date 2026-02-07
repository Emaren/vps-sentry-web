#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[gate] branch: $(git rev-parse --abbrev-ref HEAD)"

echo "[gate] test"
npm test

echo "[gate] typecheck"
npx tsc --noEmit

echo "[gate] vps-check"
./scripts/vps.sh check

echo "[gate] smoke"
./scripts/release-smoke.sh

echo "[gate] PASS"
