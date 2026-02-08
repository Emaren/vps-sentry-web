# Security + Performance Runbook (Step 8)

This runbook covers:

- security headers and CSP validation
- API rate-limit behavior checks
- load/perf smoke for production endpoints

## 1) Security headers check

Run locally:

```bash
cd /Users/tonyblum/projects/vps-sentry-web
make security-headers-check
```

Expected: `PASS` and all required headers present.

To target a custom URL:

```bash
./scripts/security-headers-check.sh --url https://your-domain.example/
```

## 2) Rate-limit validation

Rate limits are route-aware in middleware.

Quick check for a protected API route:

```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code}\n" https://your-domain.example/api/ops/test-email
done | sort | uniq -c
```

Expected:

- normal responses at first
- eventually `429` when route quota is exceeded

## 3) Load/perf smoke

Run remote load smoke against VPS local endpoint:

```bash
cd /Users/tonyblum/projects/vps-sentry-web
make perf-load-smoke
```

Default target:

- `http://127.0.0.1:$VPS_WEB_PORT/api/status` on VPS via SSH

Custom run:

```bash
./scripts/perf-load-smoke.sh \
  --remote \
  --url http://127.0.0.1:3035/api/status \
  --requests 500 \
  --concurrency 40 \
  --expect 200
```

## 4) Status API cache tuning

`/api/status` now has a short in-process cache for burst handling.

Env knob:

- `VPS_STATUS_CACHE_TTL_MS` (default `1200`)

Guidance:

- `0`: disable cache (fresh disk read every request)
- `500-1500`: good default for load smoothing with near-real-time freshness
- `>3000`: use carefully if you need strict real-time behavior
