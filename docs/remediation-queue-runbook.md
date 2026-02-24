# Remediation Queue + Worker Runbook (Step 11)

Step 11 upgrades remediation execution into a durable worker flow with:

- retry scheduling with exponential backoff
- dead-letter queue (DLQ) tagging for exhausted/non-replayable runs
- replay tooling for single runs and DLQ batches
- operator visibility APIs and admin console UI
- autonomous queueing tiers with approval/canary/rollback safety gates

## Execution lifecycle

1. User requests `POST /api/remediate` with `mode: "execute"`.
2. API writes `RemediationRun` as `queued` with queue metadata.
3. Worker drain claims queued runs (`running`) and executes commands.
4. Result handling:
   - success => `succeeded`
   - retryable failure => back to `queued` with `nextAttemptAt`
   - non-retryable or max attempts reached => `failed` + `dlq=true`

For high-risk/risky-tier autonomous actions:

- run is queued with `approval.required=true` + `approval.status=pending`
- worker leaves it in queue until operator approves
- operator can approve/reject from Admin Operator Console or `POST /api/ops/remediate-queue`

## Retry / DLQ knobs

Configure in app env:

- `VPS_REMEDIATE_MAX_RETRY_ATTEMPTS`
- `VPS_REMEDIATE_RETRY_BACKOFF_SECONDS`
- `VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS`
- `VPS_REMEDIATE_MAX_QUEUE_PER_HOST`
- `VPS_REMEDIATE_MAX_QUEUE_TOTAL`
- `VPS_REMEDIATE_QUEUE_TTL_MINUTES`
- `VPS_REMEDIATE_COMMAND_TIMEOUT_MS`
- `VPS_REMEDIATE_MAX_BUFFER_BYTES`
- `VPS_REMEDIATE_QUEUE_AUTODRAIN`
- `VPS_REMEDIATE_AUTONOMOUS_ENABLED`
- `VPS_REMEDIATE_AUTONOMOUS_MAX_TIER`
- `VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_CYCLE`
- `VPS_REMEDIATE_AUTONOMOUS_MAX_QUEUED_PER_HOUR`
- `VPS_REMEDIATE_APPROVAL_RISK_THRESHOLD`
- `VPS_REMEDIATE_CANARY_ROLLOUT_PERCENT`
- `VPS_REMEDIATE_CANARY_REQUIRE_CHECKS`
- `VPS_REMEDIATE_AUTO_ROLLBACK`

## Worker runtime

Durable worker process (recommended):

```bash
cd /Users/tonyblum/projects/vps-sentry-web
OPS_WORKER_TOKEN="$VPS_REMEDIATE_QUEUE_TOKEN" npm run ops:worker
```

One-shot tick:

```bash
npm run ops:worker:once
```

Equivalent make targets:

```bash
make ops-worker
make ops-worker-once
```

Persistent worker on VPS (recommended for production):

```bash
make vps-ops-worker-install
make vps-ops-worker-status
make vps-ops-worker-logs
```

Remove if needed:

```bash
make vps-ops-worker-remove
```

Worker env knobs:

- `OPS_WORKER_BASE_URL` (default `http://127.0.0.1:3035`)
- `OPS_WORKER_TOKEN` (falls back to `VPS_REMEDIATE_QUEUE_TOKEN`)
- `OPS_WORKER_DRAIN_LIMIT` (default `5`)
- `OPS_WORKER_INTERVAL_SECONDS` (default `15`)
- `OPS_WORKER_IDLE_INTERVAL_SECONDS` (default `30`)
- `OPS_WORKER_MAX_BACKOFF_SECONDS` (default `120`)

## Queue drain endpoints

### Admin session route

```bash
curl -X POST \
  -H 'content-type: application/json' \
  --cookie '<admin-auth-cookie>' \
  https://<app-host>/api/remediate \
  -d '{"mode":"drain-queue","limit":5}'
```

### Token route (worker/automation)

```bash
curl -X POST \
  -H 'content-type: application/json' \
  -H "x-remediate-queue-token: $VPS_REMEDIATE_QUEUE_TOKEN" \
  https://127.0.0.1:3035/api/ops/remediate-drain \
  -d '{"limit":5}'
```

## Operator visibility

Queue snapshot API (admin):

```bash
curl -sS -X GET \
  --cookie '<admin-auth-cookie>' \
  "https://<app-host>/api/ops/remediate-queue?limit=30"
```

DLQ-only snapshot:

```bash
curl -sS -X GET \
  --cookie '<admin-auth-cookie>' \
  "https://<app-host>/api/ops/remediate-queue?limit=30&dlq=1"
```

Approve/reject an approval-pending run:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<admin-auth-cookie>' \
  https://<app-host>/api/ops/remediate-queue \
  -d '{"runId":"<run-id>","mode":"approve","reason":"validated in canary"}'
```

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<admin-auth-cookie>' \
  https://<app-host>/api/ops/remediate-queue \
  -d '{"runId":"<run-id>","mode":"reject","reason":"manual intervention required"}'
```

## Replay tooling

Replay one run:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<admin-auth-cookie>' \
  https://<app-host>/api/ops/remediate-replay \
  -d '{"mode":"single","runId":"<run-id>"}'
```

Replay DLQ batch:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<admin-auth-cookie>' \
  https://<app-host>/api/ops/remediate-replay \
  -d '{"mode":"dlq-batch","limit":3}'
```

## Incident workflow integration

`critical-triage` workflow now includes:

- `drain-queue`
- `replay-dlq`
- `notify-test`

Run from admin Operator Console or `/api/ops/incident-workflow`.

## Host policy profiles

Per-host profile controls still apply (`strict`, `balanced`, `rapid`) and can override:

- queue sizing/TTL
- retry attempts and backoff
- command guard constraints
- autonomous tier/canary/approval behavior

Update through:

- `PUT /api/hosts/:hostId` with `remediationPolicyProfile`
- `remediationPolicyOverrides`
- `remediationGuardOverrides`
