# Fleet Policy + Staged Remediation Runbook (Step 19)

Step 19 introduces fleet-wide control for:

- host grouping (`group`)
- host tagging (`tags[]`)
- host scoping (`scopes[]`)
- staged remediation waves with blast-radius safeguards

All fleet metadata is stored in `Host.metaJson` under `fleetPolicy`.

## APIs

### 1) Fleet metadata inventory / bulk update

Route: `GET|POST /api/ops/fleet-policy`  
Role: `admin+`

`GET` returns inventory counts by group/tag/scope and per-host fleet metadata.

`POST` applies metadata patch in bulk with selector matching.

Example patch:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<admin-auth-cookie>' \
  https://<app-host>/api/ops/fleet-policy \
  -d '{
    "selector": { "groups": ["prod"], "tagsAny": ["web"] },
    "patch": {
      "addScopes": ["internet-facing"],
      "rolloutPaused": false,
      "rolloutPriority": 10
    }
  }'
```

### 2) Fleet remediation preview/execute (staged)

Route: `POST /api/ops/remediate-fleet`  
Role: `ops+`

Modes:

- `preview`: select hosts, apply safeguards, and return waves
- `execute`: run one stage (`stageIndex`) by queueing host-level autonomous remediation

Example preview:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<ops-auth-cookie>' \
  https://<app-host>/api/ops/remediate-fleet \
  -d '{
    "mode": "preview",
    "selector": {
      "groups": ["prod"],
      "tagsAny": ["web","api"],
      "enabledOnly": true
    },
    "rollout": {
      "strategy": "group_canary",
      "stageSize": 3,
      "stageIndex": 1
    }
  }'
```

Example execute stage 1:

```bash
curl -sS -X POST \
  -H 'content-type: application/json' \
  --cookie '<ops-auth-cookie>' \
  https://<app-host>/api/ops/remediate-fleet \
  -d '{
    "mode": "execute",
    "selector": {
      "groups": ["prod"],
      "tagsAny": ["web","api"],
      "enabledOnly": true
    },
    "rollout": {
      "strategy": "group_canary",
      "stageSize": 3,
      "stageIndex": 1
    },
    "confirmPhrase": "EXECUTE FLEET STAGE 1",
    "reason": "prod wave 1"
  }'
```

## Selector fields

- `hostIds[]`
- `groups[]`
- `tagsAll[]`
- `tagsAny[]`
- `scopesAll[]`
- `scopesAny[]`
- `enabledOnly` (default false)
- `includePaused` (default false)

By default, paused hosts (`fleetPolicy.rolloutPaused=true`) are excluded.

## Staging strategies

- `group_canary` (default): first wave takes one host per group, then remaining hosts
- `sequential`: hosts are chunked directly by stage size

## Blast-radius controls

Env knobs:

- `VPS_REMEDIATE_FLEET_MAX_HOSTS`
- `VPS_REMEDIATE_FLEET_MAX_PER_GROUP`
- `VPS_REMEDIATE_FLEET_MAX_PERCENT_ENABLED`
- `VPS_REMEDIATE_FLEET_DEFAULT_STAGE_SIZE`
- `VPS_REMEDIATE_FLEET_REQUIRE_SELECTOR`
- `VPS_REMEDIATE_FLEET_POLICY_MAX_HOST_UPDATES`

Enforcement:

- stage target is clamped by max hosts and max % enabled fleet
- per-group cap prevents too many hosts from one group in the same rollout selection
- wide-open selector can be blocked unless explicitly overridden
- execute requires confirmation phrase: `EXECUTE FLEET STAGE <n>`
