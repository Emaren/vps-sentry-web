# Host Key Lifecycle Runbook

This runbook covers scoped host API keys, versioned rotation, revocation, and verification.

## Key model

Each host API key now carries:

- immutable `version` (monotonic per host)
- optional human `label`
- explicit scope set (`scopeJson`)
- optional `expiresAt`
- optional `revokedAt` + `revokedReason`
- optional `rotatedFromKeyId` lineage

Supported scopes:

- `host.status.write`
- `host.status.read`
- `host.history.read`

## Operator workflow (safe default)

1. Create host key with minimum required scopes.
2. Verify key against the scope before rollout.
3. Deploy key to agent/automation.
4. Rotate periodically (or immediately after suspected leak).
5. Revoke previous key once replacement is live.

## API surfaces

- `GET /api/hosts/:hostId/keys`
  - session-auth admin endpoint
  - lists keys with lifecycle metadata
- `POST /api/hosts/:hostId/keys`
  - session-auth admin endpoint
  - actions:
    - `create`
    - `rotate`
    - `revoke`
    - `verify` (admin-side token verification)
- `GET /api/hosts/:hostId/keys/verify`
  - bearer token verification endpoint
  - query:
    - `scope=<scope>` optional
    - `touch=1` optional to update `lastUsedAt`
- `POST /api/hosts/:hostId/keys/verify`
  - bearer token verification endpoint
  - JSON body:
    - `scope` (or `requiredScope`)

## Verification tooling

Command-line verifier:

```bash
./scripts/host-key-verify.sh \
  --host-id <host-id> \
  --token <host-api-token> \
  --scope host.status.write
```

Optional `lastUsedAt` update:

```bash
./scripts/host-key-verify.sh \
  --host-id <host-id> \
  --token <host-api-token> \
  --scope host.status.read \
  --touch
```

Make target wrapper:

```bash
make host-key-verify HOST_ID=<host-id> HOST_TOKEN=<host-api-token> HOST_KEY_SCOPE=host.status.write BASE_URL=https://vps-sentry.example.com
```

## Rotation example (session-auth API)

```json
{
  "action": "rotate",
  "sourceKeyId": "<old-key-id>",
  "label": "primary-2026-02",
  "reason": "scheduled_rotation",
  "scopes": ["host.status.write", "host.status.read", "host.history.read"],
  "expiresAt": "2026-05-01T00:00:00.000Z"
}
```

Result:

- creates a new higher-version key
- links to prior key with `rotatedFromKeyId`
- revokes source key with `revokedReason`
- returns plaintext secret once

## Emergency response

If token leak is suspected:

1. Rotate immediately.
2. Verify new key with `scripts/host-key-verify.sh`.
3. Revoke compromised key (`action: revoke`).
4. Confirm ingest still works (`/api/hosts/:hostId/status` with new token).
5. Review audit logs (`host.key.create`, `host.key.rotate`, `host.key.revoke`).
