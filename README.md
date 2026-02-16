# vps-sentry-web

Web control plane for VPS Sentry (dashboard, API, operator workflows, and deploy tooling).

- Host agent/runtime repo: <https://github.com/Emaren/vps-sentry>
- Public marketing/landing repo: <https://github.com/Emaren/vps-sentry-landing>

## Repo Map (Layman)

- `vps-sentry`:
  - Runs on the VPS itself.
  - Think of it as the "security camera + sensor pack" on the server.
  - It scans, detects drift/threat signals, and sends host snapshots.
- `vps-sentry-web` (this repo):
  - Runs the app you log into.
  - Think of it as the "command center dashboard + response console."
  - It stores data, scores severity, shows alerts, and controls safe response actions.
- `vps-sentry-landing`:
  - Public-facing brochure/entry site.
  - Think of it as the "front desk website," not the secure operator console.

## Feature Ranking (Full Capability Set)

This is the full capability ranking, not only the newest IOC additions.

1. **Closed-loop defense workflow**
   - Ingest host telemetry, prioritize risk, generate response options, track execution history, and keep operator audit trails.
2. **Safe remediation engine with execution guardrails**
   - Plan/dry-run/execute modes, typed confirmations, allow/block lists, cooldowns, rate caps, and command safety enforcement.
3. **Fleet staged rollout with blast-radius controls**
   - Group/tag/scope selection, canary-style stages, per-group caps, percent-of-fleet limits, and required stage confirmation phrase.
4. **Incident workflow engine**
   - Persistent incidents with assignment, ack/resolution lifecycle, escalation timers, timeline events, and postmortem scaffolding.
5. **Critical threat awareness from host IOC telemetry**
   - Threat indicators from `vps-sentry` (including suspicious outbound/process behavior) are surfaced and prioritized as critical.
6. **Correlated timeline + breach ledger**
   - Host timeline signal normalization/deduping plus breach records (`open/fixed/ignored`) with searchable evidence.
7. **Host auth + ingest hardening**
   - Scoped host API keys, key lifecycle/verification endpoints, heartbeat expectations, payload size/clock-skew gates.
8. **RBAC + operator accountability**
   - Owner/admin/ops/viewer role model with privileged-route enforcement and structured audit logs.
9. **Notification + reporting pipeline**
   - Email/webhook endpoints, test-delivery APIs, and operator-triggered report delivery flows.
10. **Support bundle generation**
    - Downloadable investigation bundles with host snapshots and optional raw evidence context.
11. **Production reliability toolkit**
    - Monitor/alert scripts, backup automation, restore drills, SLO burn-rate checks, and RPO/RTO reporting.
12. **Release security + resilience certification**
    - Security-header/rate-limit checks, supply-chain checks, chaos drills, and Sentinel Prime scorecard artifacts.
13. **Database migration path (SQLite -> Postgres)**
    - Phased migration scripts with backup/parity verification and rollback support.
14. **Billing + account plan controls**
    - Stripe checkout/portal/webhook flow and plan/limit enforcement.

## Architecture At A Glance

1. `vps-sentry` runs on each VPS and publishes status payloads.
2. `vps-sentry-web` ingests snapshots and computes alert posture/severity.
3. Operators use dashboard/admin/remediation APIs to respond safely.
4. Notifications, audit logs, incidents, and evidence bundles support operations.

## Quick Start (Local)

```bash
pnpm install
pnpm dev
```

Default local DB path is `file:./dev.db` (`.env`).

Quality checks:

```bash
pnpm test
pnpm lint
pnpm build
```

## Deploy Workflow (MBP -> VPS)

1. Copy deploy config:

```bash
cp .vps.example.env .vps.env
```

2. Fill `.vps.env`:
   - set target host/user
   - set `VPS_APP_DIR`
   - choose service manager (`VPS_SERVICE` or `VPS_PM2_APP`)

3. Run deploy guardrails + deploy:

```bash
make vps-doctor
make vps-check
make vps-ssh-stability-check
make vps-hygiene-check
make deploy
make smoke
```

4. If needed:

```bash
make logs
make rollback TO=HEAD~1
```

## Command Matrix

### Core deploy/ops

```bash
make vps-doctor
make vps-check
make deploy
make restart
make logs
make rollback TO=HEAD~1
```

### Reliability + recovery

```bash
make vps-monitor
make vps-monitor-alert
make vps-slo-check
make vps-slo-alert
make vps-backup-dry-run
make vps-backup
make vps-restore-drill
make vps-rpo-rto-report
make vps-rpo-rto-report-alert
```

### Security/performance + release confidence

```bash
make security-headers-check
make perf-load-smoke
make supply-chain-check
make supply-chain-check-strict
make chaos-certify
make chaos-certify-fast
make sentinel-scorecard
make sentinel-scorecard-fast
make sentinel-scorecard-strict
make release-gate
make release
```

### Data migration (SQLite -> Postgres)

```bash
make db-pg-init
make db-pg-copy
make db-pg-verify
make db-pg-migrate
make db-pg-cutover
make db-pg-rollback
```

## API Surface (High-Level)

- Host/core:
  - `/api/status`
  - `/api/hosts`
  - `/api/hosts/:hostId`
  - `/api/hosts/:hostId/status`
  - `/api/hosts/:hostId/timeline`
  - `/api/hosts/:hostId/history`
  - `/api/hosts/:hostId/keys`
  - `/api/hosts/:hostId/keys/verify`
- Response + evidence:
  - `/api/remediate`
  - `/api/hosts/:hostId/breaches`
  - `/api/support/bundle`
  - `/api/notify/test`
- Ops/admin:
  - `/api/ops/incidents`
  - `/api/ops/incidents/:incidentId`
  - `/api/ops/incidents/escalate`
  - `/api/ops/incident-workflow`
  - `/api/ops/fleet-policy`
  - `/api/ops/remediate-fleet`
  - `/api/ops/remediate-queue`
  - `/api/ops/remediate-drain`
  - `/api/ops/remediate-replay`
  - `/api/ops/metrics`
  - `/api/ops/observability`
  - `/api/ops/slo`
  - `/api/ops/report-now`
  - `/api/ops/test-email`
- Billing/auth:
  - `/api/auth/[...nextauth]`
  - `/api/billing/checkout`
  - `/api/billing/portal`
  - `/api/billing/cancel`
  - `/api/billing/webhook`

## Runbooks

- `docs/vps-recovery-runbook.md`
- `docs/production-ops-runbook.md`
- `docs/security-performance-runbook.md`
- `docs/remediation-queue-runbook.md`
- `docs/fleet-rollout-runbook.md`
- `docs/incident-workflows.md`
- `docs/operator-playbooks.md`
- `docs/observability-runbook.md`
- `docs/slo-burn-rate-runbook.md`
- `docs/sqlite-postgres-migration.md`
- `docs/sentinel-prime-runbook.md`
- `docs/key-lifecycle-runbook.md`

## Notes

- CI workflow: `.github/workflows/ci.yml`
- Deploy/runtime knobs: `.vps.example.env`
- This repo is the operator app/control plane. It is intentionally separate from:
  - host runtime (`vps-sentry`)
  - public marketing site (`vps-sentry-landing`)
