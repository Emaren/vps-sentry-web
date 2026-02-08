# Sentinel Prime Runbook (Step 20)

Step 20 adds three operator-grade capabilities:

- supply-chain security gate (vulns + license policy + SBOM + provenance)
- chaos certification drill (restart recovery + load smoke)
- weighted Sentinel Prime readiness scorecard

## 1) Supply-Chain Security Gate

Run default policy:

```bash
cd /Users/tonyblum/projects/vps-sentry-web
make supply-chain-check
```

Run strict mode:

```bash
make supply-chain-check-strict
```

Artifacts:

- `.artifacts/supply-chain/pnpm-audit.json`
- `.artifacts/supply-chain/license-report.json`
- `.artifacts/supply-chain/sbom.cdx.json`
- `.artifacts/supply-chain/provenance.json`

## 2) Chaos Certification

Run full remote drill:

```bash
make chaos-certify
```

Run non-disruptive certification (no restart):

```bash
make chaos-certify-fast
```

Artifacts:

- `.artifacts/chaos/certification-<timestamp>.json`
- `.artifacts/chaos/baseline-smoke.log`
- `.artifacts/chaos/service-restart.log`
- `.artifacts/chaos/perf-smoke.log`

## 3) Sentinel Prime Readiness Scorecard

Run default scorecard:

```bash
make sentinel-scorecard
```

Run strict/pass-fail scorecard:

```bash
make sentinel-scorecard-strict
```

Run fast/non-disruptive scorecard:

```bash
make sentinel-scorecard-fast
```

Artifacts:

- `.artifacts/sentinel-prime/<run-id>/scorecard.json`
- `.artifacts/sentinel-prime/<run-id>/scorecard.md`
- `.artifacts/sentinel-prime/latest.json`
- `.artifacts/sentinel-prime/latest.md`

## 4) Policy Knobs (`.vps.env`)

- `VPS_SUPPLYCHAIN_MAX_CRITICAL`
- `VPS_SUPPLYCHAIN_MAX_HIGH`
- `VPS_SUPPLYCHAIN_MAX_MODERATE`
- `VPS_SUPPLYCHAIN_FAIL_UNKNOWN_LICENSE`
- `VPS_SUPPLYCHAIN_DENY_LICENSE_REGEX`
- `VPS_SUPPLYCHAIN_ARTIFACT_DIR`
- `VPS_CHAOS_MAX_RECOVERY_SECONDS`
- `VPS_CHAOS_POLL_INTERVAL_SECONDS`
- `VPS_CHAOS_PERF_REQUESTS`
- `VPS_CHAOS_PERF_CONCURRENCY`
- `VPS_CHAOS_REQUIRE_PERF_PASS`
- `VPS_CHAOS_ARTIFACT_DIR`
- `VPS_SCORECARD_MIN_PASS_PERCENT`
- `VPS_SCORECARD_ARTIFACT_DIR`
- `VPS_SCORECARD_CHECK_TIMEOUT_SECONDS`

## 5) Recommended Step 20 Execution Order

1. `make supply-chain-check`
2. `make release-gate`
3. `make chaos-certify`
4. `make sentinel-scorecard-strict`
