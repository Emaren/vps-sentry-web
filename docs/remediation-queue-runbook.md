# Remediation Queue Runbook (Step 7)

Remediation execute mode is queue-first.

## Queue flow

1. User requests `POST /api/remediate` with `mode: "execute"`.
2. API writes `RemediationRun` with state `queued`.
3. Queue drain promotes run to `running`, executes guarded commands, and writes final state.

## Queue drain options

### Admin session route

```bash
curl -X POST \
  -H 'content-type: application/json' \
  --cookie '<your-auth-cookie>' \
  https://<app-host>/api/remediate \
  -d '{"mode":"drain-queue","limit":5}'
```

### Token route (for cron/automation)

Set `VPS_REMEDIATE_QUEUE_TOKEN` in app env.

```bash
curl -X POST \
  -H 'content-type: application/json' \
  -H "x-remediate-queue-token: $VPS_REMEDIATE_QUEUE_TOKEN" \
  https://127.0.0.1:3035/api/ops/remediate-drain \
  -d '{"limit":5}'
```

## Host policy profiles

Per-host profile:

- `strict`: lower throughput, tighter limits
- `balanced`: default
- `rapid`: higher throughput for urgent incidents

Update through host API:

```json
{
  "remediationPolicyProfile": "strict",
  "remediationPolicyOverrides": {
    "maxQueuePerHost": 2,
    "maxExecutePerHour": 3
  },
  "remediationGuardOverrides": {
    "maxCommandsPerAction": 8,
    "maxCommandLength": 500,
    "enforceAllowlist": true
  }
}
```

## Core safety knobs

- `VPS_REMEDIATE_MAX_QUEUE_PER_HOST`
- `VPS_REMEDIATE_MAX_QUEUE_TOTAL`
- `VPS_REMEDIATE_QUEUE_TTL_MINUTES`
- `VPS_REMEDIATE_COMMAND_TIMEOUT_MS`
- `VPS_REMEDIATE_MAX_BUFFER_BYTES`
- `VPS_REMEDIATE_QUEUE_AUTODRAIN`
