#!/usr/bin/env bash
set -euo pipefail

# Keep local quality checks deterministic even when host-level Datadog injects NODE_OPTIONS.
export DD_TRACE_ENABLED=false
export NODE_OPTIONS=""

npm run lint
npm test
npm run build
