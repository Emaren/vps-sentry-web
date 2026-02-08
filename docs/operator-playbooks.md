# Operator Playbooks (Step 9)

This document gives operators a plain, repeatable response flow for common incidents.
Use it with the admin Operator Console and `docs/incident-workflows.md`.

## Safety Baseline

- Take a snapshot before changing anything (status, logs, queue state).
- Prefer reversible actions first (drain queue, notify, smoke checks).
- Keep changes narrow: one workflow at a time.
- Confirm service health after each workflow: `/`, `/login`, `/api/status`.
- Record operator notes in incident ticket/chat with exact timestamps.

## Critical Incident Triage

Use when alerts suggest high-risk drift or compromise:

- `config_tamper`
- `firewall_drift`
- `unexpected_public_ports`

Runbook:

1. Open `/admin` and run workflow `critical-triage`:
   - `status-snapshot`
   - `drain-queue`
   - `replay-dlq` (when DLQ count > 0 and root cause is fixed)
   - `notify-test`
2. Run smoke validation:
   ```bash
   make smoke
   ```
3. If degradation continues, run:
   ```bash
   make vps-monitor-alert
   ```
4. Capture post-action summary in incident notes:
   - what changed
   - current user impact
   - next checkpoint time

Exit criteria:

- smoke endpoints return `200`
- queue drain no longer showing stuck critical runs
- DLQ backlog is cleared or intentionally deferred with operator notes
- notification path confirmed

## Auth Abuse Response

Use when auth anomaly metrics spike:

- `ssh_failed_password`
- `ssh_invalid_user`

Runbook:

1. In `/admin`, run workflow `auth-abuse-response`:
   - `status-snapshot`
   - `notify-test`
2. Perform manual host hardening checks:
   - confirm key-based SSH only
   - validate firewall rules still expected
   - confirm no accidental lockout for operators
3. Validate service health:
   ```bash
   make smoke
   ```

Exit criteria:

- auth anomaly rate trends downward
- operators still have expected access
- no customer-facing outage introduced

## Service Degradation Response

Use when latency or error rates rise without clear security signals:

- `api_latency`
- `high_error_rate`
- `resource_pressure`

Runbook:

1. In `/admin`, run workflow `degraded-performance`:
   - `status-snapshot`
   - `drain-queue` (low limit)
2. Run load sanity:
   ```bash
   make perf-load-smoke
   ```
3. Recheck security baseline:
   ```bash
   make security-headers-check
   ```
4. If still degraded, review system metrics and consider controlled restart/rollback.

Exit criteria:

- latency and error profile stabilizes
- load smoke has no unexpected failures
- security checks still pass

## Audit Expectations

Privileged workflow activity must produce audit records. For each incident, verify logs include:

- `ops.incident_workflow.list` (catalog viewed)
- `ops.incident_workflow.step` or `ops.incident_workflow.step.failed`
- related quick-action logs (`ops.remediate_queue_drain`, `ops.report_now.*`, `ops.test_email.*`)

If logs are missing, treat as operational risk and fix before next release.
