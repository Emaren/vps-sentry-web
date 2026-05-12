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

## Runtime IOC / Container Loader Response

Use when VPSSentry reports suspicious runtime behavior rather than ordinary config drift:

- suspicious process IOC
- hostile shell loop
- protected-path loader behavior
- rogue restartable container persistence

Runbook:

1. Open the dashboard and inspect Counterstrike before changing anything.
2. Match the playbook to the threat shape:
   - `Zap #1` for writable-path miner / persistence cleanup
   - `Zap #2` for protected-path or container-loader cases where the runtime is using legit host tools in a hostile way
3. Before execute, confirm the plan is targeting the actual loader or container, not a normal system binary in isolation.
4. Run the selected playbook.
5. Immediately refresh the host snapshot:
   ```bash
   sudo systemctl start vps-sentry.service
   ```
6. Confirm post-action state:
   - `threat.suspicious_processes` is empty
   - `counterstrike-last.json` shows the expected contained result
   - the rogue container is not running again
   - public ports are still expected only

Exit criteria:

- the hostile runtime signal is gone
- no rogue container is restarting
- published status reflects the new contained state
- operator notes include exact timestamps and the playbook used

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
- `cpu_hotspot`
- `host_disk_critical`

Runbook:

1. On `/dashboard`, open the Power / Memory / Disk / Reclaim surface and read **Sentry Diagnosis** first.
2. Use **Scan Now** for a fresh host snapshot before killing or restarting anything.
3. If root disk is critical and **Safe Reclaim** has bytes available, run **Zap Safe Hogs** from the dashboard.
4. If root disk is critical and safe reclaim is `0B`, inspect the listed root pressure leaders. Guided dependency-tree reclaim requires a service stop/reinstall/build plan; do not delete those trees casually.
5. For CPU hotspots, inspect the Power lane and confirm whether the process is a build/deploy burst, a normal hot service, or a runtime IOC. Counterstrike is only for IOC signals, not ordinary CPU pressure.
6. In `/admin`, run workflow `degraded-performance` when broader degradation continues:
   - `status-snapshot`
   - `drain-queue` (low limit)
7. Run load sanity:
   ```bash
   make perf-load-smoke
   ```
8. Recheck security baseline:
   ```bash
   make security-headers-check
   ```
9. If still degraded, review system metrics and consider controlled restart/rollback.

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
