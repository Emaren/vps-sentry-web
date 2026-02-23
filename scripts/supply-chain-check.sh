#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.vps.env"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

ARTIFACT_DIR="${VPS_SUPPLYCHAIN_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/supply-chain}"
MAX_CRITICAL="${VPS_SUPPLYCHAIN_MAX_CRITICAL:-0}"
MAX_HIGH="${VPS_SUPPLYCHAIN_MAX_HIGH:-0}"
MAX_MODERATE="${VPS_SUPPLYCHAIN_MAX_MODERATE:-0}"
FAIL_UNKNOWN_LICENSE="${VPS_SUPPLYCHAIN_FAIL_UNKNOWN_LICENSE:-0}"
DENY_LICENSE_REGEX="${VPS_SUPPLYCHAIN_DENY_LICENSE_REGEX:-(^|[^A-Za-z])(AGPL|GPL-3\\.0|SSPL|BUSL)([^A-Za-z]|$)}"
UNKNOWN_LICENSE_ALLOWLIST="${VPS_SUPPLYCHAIN_UNKNOWN_LICENSE_ALLOWLIST:-@emnapi/runtime,@img/sharp-darwin-x64,@img/sharp-libvips-darwin-x64,@img/sharp-libvips-linux-arm,@img/sharp-libvips-linux-arm64,@img/sharp-libvips-linux-ppc64,@img/sharp-libvips-linux-riscv64,@img/sharp-libvips-linux-s390x,@img/sharp-libvips-linux-x64,@img/sharp-libvips-linuxmusl-arm64,@img/sharp-libvips-linuxmusl-x64,@img/sharp-linux-arm,@img/sharp-linux-arm64,@img/sharp-linux-ppc64,@img/sharp-linux-riscv64,@img/sharp-linux-s390x,@img/sharp-linux-x64,@img/sharp-linuxmusl-arm64,@img/sharp-linuxmusl-x64,@img/sharp-wasm32,@img/sharp-win32-arm64,@img/sharp-win32-ia32,@img/sharp-win32-x64,@next/swc-darwin-x64,@next/swc-linux-arm64-gnu,@next/swc-linux-arm64-musl,@next/swc-linux-x64-gnu,@next/swc-linux-x64-musl,@next/swc-win32-arm64-msvc,@next/swc-win32-x64-msvc}"
VERIFY_LOCK=1
SKIP_AUDIT=0
SKIP_LICENSE_POLICY=0
SKIP_SBOM=0
STRICT_MODE=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/supply-chain-check.sh [options]

Step 20 supply-chain guard:
- lockfile/frozen dependency verification
- production dependency vulnerability thresholds
- license policy scan
- SBOM + provenance artifact generation

Options:
  --strict                Tighten vuln thresholds (critical/high/moderate all 0).
  --no-lock-verify        Skip frozen-lock install check.
  --skip-audit            Skip vulnerability audit step.
  --skip-license-policy   Do not fail on denied/unknown license policy results.
  --skip-sbom             Skip SBOM generation.
  --unknown-allowlist STR Comma/newline/|| list of unknown-license package names to allow.
  --artifact-dir PATH     Output artifact directory.
  -h, --help              Show this help.

Env knobs:
  VPS_SUPPLYCHAIN_MAX_CRITICAL       Default 0
  VPS_SUPPLYCHAIN_MAX_HIGH           Default 0
  VPS_SUPPLYCHAIN_MAX_MODERATE       Default 0
  VPS_SUPPLYCHAIN_FAIL_UNKNOWN_LICENSE Default 0
  VPS_SUPPLYCHAIN_DENY_LICENSE_REGEX Default (^|[^A-Za-z])(AGPL|GPL-3\.0|SSPL|BUSL)([^A-Za-z]|$)
  VPS_SUPPLYCHAIN_UNKNOWN_LICENSE_ALLOWLIST Default platform binary allowlist (@img/*, @next/swc-*, @emnapi/runtime)
USAGE
}

trim() {
  local value="$1"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "$value"
}

require_non_negative_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "[supply] $name must be a non-negative integer: $value"
    exit 1
  fi
}

read_bool() {
  local raw="$1"
  local fallback="$2"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')"
  case "$(trim "$normalized")" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    *) printf '%s' "$fallback" ;;
  esac
}

pnpm_cmd() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return $?
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return $?
  fi
  echo "[supply] pnpm is required (pnpm or corepack pnpm)"
  return 127
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT_MODE=1
      shift
      ;;
    --no-lock-verify)
      VERIFY_LOCK=0
      shift
      ;;
    --skip-audit)
      SKIP_AUDIT=1
      shift
      ;;
    --skip-license-policy)
      SKIP_LICENSE_POLICY=1
      shift
      ;;
    --skip-sbom)
      SKIP_SBOM=1
      shift
      ;;
    --unknown-allowlist)
      [[ $# -lt 2 ]] && { echo "[supply] missing value for --unknown-allowlist"; usage; exit 1; }
      UNKNOWN_LICENSE_ALLOWLIST="$2"
      shift 2
      ;;
    --artifact-dir)
      [[ $# -lt 2 ]] && { echo "[supply] missing value for --artifact-dir"; usage; exit 1; }
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "[supply] unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$STRICT_MODE" -eq 1 ]]; then
  MAX_CRITICAL=0
  MAX_HIGH=0
  MAX_MODERATE=0
  FAIL_UNKNOWN_LICENSE=1
fi

FAIL_UNKNOWN_LICENSE="$(read_bool "$FAIL_UNKNOWN_LICENSE" 0)"
require_non_negative_int "VPS_SUPPLYCHAIN_MAX_CRITICAL" "$MAX_CRITICAL"
require_non_negative_int "VPS_SUPPLYCHAIN_MAX_HIGH" "$MAX_HIGH"
require_non_negative_int "VPS_SUPPLYCHAIN_MAX_MODERATE" "$MAX_MODERATE"

cd "$ROOT_DIR"
mkdir -p "$ARTIFACT_DIR"

if [[ ! -f "$ROOT_DIR/pnpm-lock.yaml" ]]; then
  echo "[supply] missing pnpm-lock.yaml"
  exit 1
fi

if [[ "$VERIFY_LOCK" -eq 1 ]]; then
  echo "[supply] verifying frozen lockfile"
  pnpm_cmd install --frozen-lockfile --ignore-scripts --prefer-offline >/dev/null
  echo "[supply] lockfile_frozen:ok"
else
  echo "[supply] lockfile_frozen:skipped"
fi

LS_JSON="$ARTIFACT_DIR/pnpm-ls.json"
SBOM_JSON="$ARTIFACT_DIR/sbom.cdx.json"
LICENSE_JSON="$ARTIFACT_DIR/license-report.json"
AUDIT_JSON="$ARTIFACT_DIR/pnpm-audit.json"
PROVENANCE_JSON="$ARTIFACT_DIR/provenance.json"

echo "[supply] generating dependency tree"
pnpm_cmd ls --prod --depth Infinity --json > "$LS_JSON"

if [[ "$SKIP_AUDIT" -eq 0 ]]; then
  echo "[supply] running vulnerability audit"
  set +e
  pnpm_cmd audit --prod --json > "$AUDIT_JSON"
  audit_exit=$?
  set -e

  eval "$(
    node - "$AUDIT_JSON" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error("parse_failed=1");
  process.exit(0);
}
const v = (data && data.metadata && data.metadata.vulnerabilities) || {};
const critical = Number(v.critical || 0);
const high = Number(v.high || 0);
const moderate = Number(v.moderate || 0);
const low = Number(v.low || 0);
const info = Number(v.info || 0);
console.log(`parse_failed=0`);
console.log(`audit_critical=${critical}`);
console.log(`audit_high=${high}`);
console.log(`audit_moderate=${moderate}`);
console.log(`audit_low=${low}`);
console.log(`audit_info=${info}`);
NODE
  )"

  if [[ "${parse_failed:-1}" -ne 0 ]]; then
    echo "[supply] audit output was not valid JSON"
    exit 1
  fi

  echo "[supply] audit_counts: critical=${audit_critical:-0} high=${audit_high:-0} moderate=${audit_moderate:-0} low=${audit_low:-0} info=${audit_info:-0}"

  if [[ "${audit_critical:-0}" -gt "$MAX_CRITICAL" ]]; then
    echo "[supply] FAIL: critical vulns ${audit_critical:-0} > allowed $MAX_CRITICAL"
    exit 1
  fi
  if [[ "${audit_high:-0}" -gt "$MAX_HIGH" ]]; then
    echo "[supply] FAIL: high vulns ${audit_high:-0} > allowed $MAX_HIGH"
    exit 1
  fi
  if [[ "${audit_moderate:-0}" -gt "$MAX_MODERATE" ]]; then
    echo "[supply] FAIL: moderate vulns ${audit_moderate:-0} > allowed $MAX_MODERATE"
    exit 1
  fi

  if [[ "$audit_exit" -ne 0 ]]; then
    echo "[supply] audit command exited $audit_exit (accepted by threshold policy)"
  fi
else
  echo "[supply] audit:skipped"
fi

deny_regex="$DENY_LICENSE_REGEX"
fail_unknown="$FAIL_UNKNOWN_LICENSE"
if [[ "$SKIP_LICENSE_POLICY" -eq 1 ]]; then
  deny_regex=""
  fail_unknown=0
fi

report_args=(
  --ls-json "$LS_JSON"
  --report "$LICENSE_JSON"
  --deny-regex "$deny_regex"
  --fail-unknown "$fail_unknown"
  --allow-unknown-packages "$UNKNOWN_LICENSE_ALLOWLIST"
)

if [[ "$SKIP_SBOM" -eq 0 ]]; then
  report_args+=(--sbom "$SBOM_JSON")
fi

echo "[supply] generating license report$( [[ "$SKIP_SBOM" -eq 0 ]] && printf ' + SBOM' )"
node "$ROOT_DIR/scripts/supply-chain-report.mjs" "${report_args[@]}"

eval "$(
  node - "$LICENSE_JSON" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const data = JSON.parse(raw);
const denied = Number(data?.totals?.deniedLicenses || 0);
const unknown = Number(data?.totals?.unknownLicenses || 0);
const unknownAllowed = Number(data?.totals?.unknownLicensesAllowed || 0);
const unknownBlocked = Number(data?.totals?.unknownLicensesBlocked || 0);
const unique = Number(data?.totals?.uniquePackages || 0);
console.log(`license_denied=${denied}`);
console.log(`license_unknown=${unknown}`);
console.log(`license_unknown_allowed=${unknownAllowed}`);
console.log(`license_unknown_blocked=${unknownBlocked}`);
console.log(`license_unique=${unique}`);
NODE
)"

echo "[supply] license_summary: unique=${license_unique:-0} denied=${license_denied:-0} unknown=${license_unknown:-0} unknown_allowed=${license_unknown_allowed:-0} unknown_blocked=${license_unknown_blocked:-0}"

pnpm_version="$(pnpm_cmd --version 2>/dev/null || echo unknown)"
lock_sha="$(shasum -a 256 "$ROOT_DIR/pnpm-lock.yaml" | awk '{print $1}')"
pkg_sha="$(shasum -a 256 "$ROOT_DIR/package.json" | awk '{print $1}')"
git_branch="$(git rev-parse --abbrev-ref HEAD)"
git_commit="$(git rev-parse --short=12 HEAD)"

git_dirty=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  git_dirty=1
fi

GIT_BRANCH="$git_branch" \
GIT_COMMIT="$git_commit" \
GIT_DIRTY="$git_dirty" \
PNPM_VERSION="$pnpm_version" \
LOCK_SHA="$lock_sha" \
PKG_SHA="$pkg_sha" \
node - "$PROVENANCE_JSON" <<'NODE'
const fs = require("node:fs");
const outPath = process.argv[2];
const payload = {
  generatedAt: new Date().toISOString(),
  git: {
    branch: process.env.GIT_BRANCH || "",
    commit: process.env.GIT_COMMIT || "",
    dirty: process.env.GIT_DIRTY === "1",
  },
  runtime: {
    node: process.version,
    pnpm: process.env.PNPM_VERSION || "unknown",
  },
  checksums: {
    "pnpm-lock.yaml.sha256": process.env.LOCK_SHA || "",
    "package.json.sha256": process.env.PKG_SHA || "",
  },
  ci: {
    provider: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    runId: process.env.GITHUB_RUN_ID || "",
    runNumber: process.env.GITHUB_RUN_NUMBER || "",
    workflow: process.env.GITHUB_WORKFLOW || "",
  },
};
fs.mkdirSync(require("node:path").dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
NODE

if [[ "$SKIP_SBOM" -eq 0 ]]; then
  echo "[supply] sbom:$SBOM_JSON"
fi
echo "[supply] license_report:$LICENSE_JSON"
echo "[supply] provenance:$PROVENANCE_JSON"
echo "[supply] PASS"
