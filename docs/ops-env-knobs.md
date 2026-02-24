# Ops env knobs (quick reference)

This file documents optional environment variables used by the VPS ops scripts.
Do **not** store real secrets here. Use your real env file on the VPS (e.g. `/etc/vps-sentry-web.env`) for secrets.

---

## Remediation worker (scripts/ops-worker.mjs)

### Core worker knobs
- `OPS_WORKER_BASE_URL` (default: `http://127.0.0.1:3035`)
- `OPS_WORKER_INTERVAL_SECONDS` (default: `15`)
- `OPS_WORKER_IDLE_INTERVAL_SECONDS` (default: `30`)
- `OPS_WORKER_MAX_BACKOFF_SECONDS` (default: `120`)
- `OPS_WORKER_DRAIN_LIMIT` (default: `5`)
- `OPS_WORKER_TOKEN` (optional; can also use `VPS_REMEDIATE_QUEUE_TOKEN`)
- `OPS_WORKER_ALLOW_LOOPBACK_NO_TOKEN` (default: `1`)
  - If enabled and base URL is loopback, token is not required.

### Service manager defaults (scripts/vps-ops-worker-service.sh)
- `VPS_OPS_WORKER_SERVICE` (default: `vps-sentry-ops-worker.service`)
- `VPS_OPS_WORKER_USER` (default: `tony`)
- `VPS_OPS_WORKER_ENV_FILE` (default: `/etc/vps-sentry-web.env`)
- `VPS_OPS_WORKER_LOG_LINES` (default: `120`)

---

## Queue pressure alerts (scripts/vps-queue-alert.sh)

- `VPS_QUEUE_ALERT_BASE_URL` (default: `http://127.0.0.1:3035`)
- `VPS_QUEUE_ALERT_ENDPOINT_PATH` (default: `/api/ops/remediate-queue`)
- `VPS_QUEUE_ALERT_TOKEN` (optional override)
  - Falls back to `VPS_REMEDIATE_QUEUE_TOKEN` when present.
- `VPS_QUEUE_ALERT_CURL_TIMEOUT_SECONDS` (default: `10`)

### Thresholds
Warn:
- `VPS_QUEUE_ALERT_WARN_QUEUED` (default: `2`)
- `VPS_QUEUE_ALERT_WARN_DLQ` (default: `1`)
- `VPS_QUEUE_ALERT_WARN_APPROVAL_PENDING` (default: `2`)

Critical:
- `VPS_QUEUE_ALERT_CRITICAL_QUEUED` (default: `6`)
- `VPS_QUEUE_ALERT_CRITICAL_DLQ` (default: `3`)
- `VPS_QUEUE_ALERT_CRITICAL_APPROVAL_PENDING` (default: `5`)

---

## Combined safety automation (scripts/vps-ops-safety-automation.sh)

- `VPS_OPS_SAFETY_CRON` (default: `*/5 * * * *`)
- `VPS_OPS_SAFETY_LOG_PATH` (default: `/home/tony/vps-sentry-ops-safety.log`)
- `VPS_OPS_SAFETY_ENABLE_QUEUE` (default: `1`)
- `VPS_OPS_SAFETY_ENABLE_SLO` (default: `1`)