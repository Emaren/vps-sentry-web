#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

BASE_URL="${BASE_URL:-${VPS_WEB_BASE_URL:-http://127.0.0.1:3035}}"
HOST_ID="${HOST_ID:-}"
HOST_TOKEN="${HOST_TOKEN:-${HOST_API_TOKEN:-}}"
HOST_KEY_SCOPE="${HOST_KEY_SCOPE:-host.status.write}"
TOUCH=0
JSON_OUTPUT=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/host-key-verify.sh --host-id <id> --token <token> [options]

Options:
  --scope <scope>      Required scope check (default: host.status.write)
  --base-url <url>     Web base URL (default: VPS_WEB_BASE_URL or http://127.0.0.1:3035)
  --touch              Update key lastUsedAt on successful verify
  --json               Print raw JSON response
  -h, --help           Show help

Env fallbacks:
  HOST_ID
  HOST_TOKEN (or HOST_API_TOKEN)
  HOST_KEY_SCOPE
  BASE_URL (or VPS_WEB_BASE_URL)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host-id)
      [[ $# -lt 2 ]] && { echo "[host-key-verify] missing value for --host-id"; usage; exit 1; }
      HOST_ID="$2"
      shift 2
      ;;
    --token)
      [[ $# -lt 2 ]] && { echo "[host-key-verify] missing value for --token"; usage; exit 1; }
      HOST_TOKEN="$2"
      shift 2
      ;;
    --scope)
      [[ $# -lt 2 ]] && { echo "[host-key-verify] missing value for --scope"; usage; exit 1; }
      HOST_KEY_SCOPE="$2"
      shift 2
      ;;
    --base-url)
      [[ $# -lt 2 ]] && { echo "[host-key-verify] missing value for --base-url"; usage; exit 1; }
      BASE_URL="$2"
      shift 2
      ;;
    --touch)
      TOUCH=1
      shift
      ;;
    --json)
      JSON_OUTPUT=1
      shift
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[host-key-verify] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$HOST_ID" ]]; then
  echo "[host-key-verify] HOST_ID is required"
  usage
  exit 1
fi

if [[ -z "$HOST_TOKEN" ]]; then
  echo "[host-key-verify] HOST_TOKEN is required"
  usage
  exit 1
fi

urlencode() {
  node -e 'console.log(encodeURIComponent(process.argv[1] ?? ""))' "$1"
}

base_url="${BASE_URL%/}"
query="scope=$(urlencode "$HOST_KEY_SCOPE")"
if [[ "$TOUCH" -eq 1 ]]; then
  query="$query&touch=1"
fi
url="$base_url/api/hosts/$HOST_ID/keys/verify?$query"

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

http_status="$(
  curl -sS \
    -o "$tmp_body" \
    -w '%{http_code}' \
    -H "Authorization: Bearer $HOST_TOKEN" \
    "$url"
)"

if [[ "$JSON_OUTPUT" -eq 1 ]]; then
  cat "$tmp_body"
  echo
fi

node - "$tmp_body" "$http_status" "$HOST_KEY_SCOPE" "$JSON_OUTPUT" <<'NODE'
const fs = require("node:fs");

const [bodyPath, statusRaw, requiredScope, jsonOutputRaw] = process.argv.slice(2);
const status = Number(statusRaw || "0");
const jsonOutput = jsonOutputRaw === "1";
const raw = fs.readFileSync(bodyPath, "utf8");

let body;
try {
  body = JSON.parse(raw);
} catch {
  if (!jsonOutput) {
    console.error(`[host-key-verify] FAIL status=${status} (invalid JSON response)`);
    if (raw.trim()) console.error(raw.trim());
  }
  process.exit(1);
}

if (status >= 200 && status < 300 && body?.ok) {
  if (!jsonOutput) {
    const key = body.key ?? {};
    const scopes = Array.isArray(key.scopes) ? key.scopes.join(",") : "";
    console.log(
      `[host-key-verify] PASS host=${body.host?.id ?? "unknown"} key=${key.prefix ?? "unknown"} version=${key.version ?? "?"} state=${key.state ?? "?"}`
    );
    console.log(
      `[host-key-verify] scope=${requiredScope} matched=true touched=${body.touched ? "yes" : "no"} scopes=[${scopes}]`
    );
  }
  process.exit(0);
}

if (!jsonOutput) {
  console.error(
    `[host-key-verify] FAIL status=${status} error=${body?.error ?? "unknown"} code=${body?.code ?? "unknown"}`
  );
  if (body?.requiredScope) {
    console.error(`[host-key-verify] requiredScope=${body.requiredScope}`);
  }
}
process.exit(1);
NODE
