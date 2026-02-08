# vps-sentry-web

Next.js frontend for VPS Sentry.

- Backend/service: https://github.com/Emaren/vps-sentry
- Static landing: https://github.com/Emaren/vps-sentry-landing

## VPS Commands

1. Copy config template:
   ```bash
   cp /Users/tonyblum/projects/vps-sentry-web/.vps.example.env /Users/tonyblum/projects/vps-sentry-web/.vps.env
   ```
2. Edit `/Users/tonyblum/projects/vps-sentry-web/.vps.env`:
   - Set `VPS_APP_DIR` to the deploy repo path on server.
   - If unsure, detect it from systemd:
   ```bash
   ssh hetzner-codex 'systemctl show -p WorkingDirectory --value vps-sentry-web.service'
   ```
   - Optional: set `VPS_GIT_REF=v1.0` to always deploy that branch/ref on VPS.
   - Deploy safety defaults:
     - `VPS_DEPLOY_STRATEGY=abort` (recommended)
     - `VPS_REQUIRE_CLEAN_LOCAL=1`
     - `VPS_REQUIRE_PUSHED_REF=1`
     - `VPS_REQUIRE_NONINTERACTIVE_SUDO=1` (recommended for zero-interactive deploys)
   - SSH reliability defaults:
     - `VPS_SSH_CONNECT_TIMEOUT=10`
     - `VPS_SSH_CONNECTION_ATTEMPTS=2`
     - `VPS_SSH_SERVER_ALIVE_INTERVAL=15`
     - `VPS_SSH_SERVER_ALIVE_COUNT_MAX=3`
     - `VPS_SSH_RETRIES=4`
     - `VPS_SSH_RETRY_DELAY_SECONDS=5`
   - If the VPS repo has drift/local commits and you explicitly want to reset it safely:
     - set `VPS_DEPLOY_STRATEGY=reset` (script creates `backup/pre-deploy-*` then hard-resets to origin)
   - Set either `VPS_SERVICE` (systemd) or `VPS_PM2_APP` (pm2).
3. Run commands:
   ```bash
   cd /Users/tonyblum/projects/vps-sentry-web
   make vps-doctor
   make vps-check
   make vps-hygiene-check
   make deploy
   make vps-prune-archives
   make logs
   make rollback TO=HEAD~1
   ```

## Reliability Backbone (Step 1)

Deploy path now runs in zero-interactive mode:

- SSH uses batch mode + timeout knobs so it fails fast.
- SSH commands auto-retry on transient connection refusals.
- Service restart uses `sudo -n` and will fail clearly if sudo would prompt.
- Run `make vps-doctor` before deploys to validate readiness.

Recovery runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/vps-recovery-runbook.md`

## Alert Quality Knobs

Set these in your web app environment (`/etc/vps-sentry-web.auth.env` for systemd, then restart service):

- `VPS_ALERT_SUPPRESS_REGEX`: optional suppression regex list (`||` or newline separated)
  - example: `VPS_ALERT_SUPPRESS_REGEX=^Packages changed$||cloud-locale-test`
- `VPS_SUPPRESS_PACKAGES_CHANGED=1`: suppress "Packages changed" alerts in dashboard actioning
- `VPS_MAINTENANCE_MODE=1`: enable maintenance mode (suppresses non-critical alerts)
- `VPS_MAINTENANCE_UNTIL=2026-02-10T03:00:00Z`: maintenance window end timestamp

## Host Heartbeat + Ingest Integrity Knobs (v1.3)

Set these in your web app environment (`/etc/vps-sentry-web.auth.env`):

- `VPS_HEARTBEAT_EXPECTED_MINUTES=5`
  - target scan cadence for a healthy host
- `VPS_HEARTBEAT_STALE_MULTIPLIER=3`
  - host transitions to `stale` after `expected * stale_multiplier`
- `VPS_HEARTBEAT_MISSING_MULTIPLIER=12`
  - host transitions to `missing` after `expected * missing_multiplier`
- `VPS_INGEST_MAX_PAYLOAD_BYTES=1000000`
  - reject oversized ingest requests (defaults to 1 MB)
- `VPS_INGEST_MAX_CLOCK_SKEW_MINUTES=30`
  - flag ingest payloads whose `ts` is too far from server time

After changing env:

```bash
sudo systemctl restart vps-sentry-web.service
sudo systemctl status vps-sentry-web.service --no-pager -n 30
```

## Incident Timeline + Signal Correlation (v1.4)

New in web `v1.4`:

- Host detail page now includes an **Incident Timeline** derived from recent snapshots.
- Signals are normalized into severities (`critical/high/medium/low/info`) from:
  - watched-file/config tamper alerts
  - auth anomalies (`ssh_failed_password`, `ssh_invalid_user`)
  - unexpected public ports
  - ingest integrity warnings
- Duplicate noise is collapsed using a short dedupe window.

API:

- `GET /api/hosts/:hostId/timeline?limit=40`
  - Auth required (session)
  - Returns `timeline` and `summary` for UI/automation consumers.

## Safe Response Playbook (v1.5)

New in web `v1.5`:

- Host detail page includes a **Response Playbook (Safe)** section.
- Suggested actions are generated from recent incident signals (no auto-execution).
- Each action includes:
  - priority (`P0/P1/P2`)
  - risk level
  - copy-ready command block
  - rollback notes where applicable

API:

- `POST /api/remediate`
  - Auth required (session)
  - Body: `{ "hostId": "<host-id>", "limit": 40 }`
  - Returns safe action recommendations derived from recent host snapshots.

## Guided Containment (v1.6)

New in web `v1.6`:

- Response actions now render with host-aware command targets (for example, concrete unexpected ports).
- Response flow is now explicit:
  - `Dry run`: logs what would execute, executes nothing
  - `Execute`: requires a typed confirmation phrase and writes a remediation run record
- Execute now enforces a fresh dry-run window per action/host.
  - default: `30` minutes (override with `VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES`)
- Host detail page now includes **Remediation Runs** (state, timestamps, output/error).
- Every dry-run/execute writes audit logs (`remediate.dry_run`, `remediate.execute`).

API (`POST /api/remediate`, auth required):

- Plan mode (default):
  - Body: `{ "hostId": "<host-id>", "mode": "plan" }`
- Dry run:
  - Body: `{ "hostId": "<host-id>", "mode": "dry-run", "actionId": "quarantine-unexpected-listener" }`
- Execute:
  - Body: `{ "hostId": "<host-id>", "mode": "execute", "actionId": "...", "confirmPhrase": "EXECUTE ..." }`

## v2.0 M6 Hardening + Release Gate

Hardening controls:

- Action command guard (allowlist + blocklist) enforced before dry-run/execute.
- Execute safety limits:
  - fresh dry-run window required
  - per-action execute cooldown
  - per-host execute hourly cap
  - block concurrent execute for the same host/action
- Runner output redaction masks likely secrets (`Authorization Bearer`, `token=`, `password=`).
- RBAC gate for privileged admin/ops surfaces:
  - `/admin`
  - `POST /api/ops/report-now`
  - `POST /api/ops/test-email`
- Privileged actions now write structured `AuditLog` entries with IP/user-agent where request context exists.

Tuning env knobs:

- `VPS_SIGNAL_DEDUPE_WINDOW_MINUTES` (default `30`)
- `VPS_REMEDIATE_DRY_RUN_MAX_AGE_MINUTES` (default `30`)
- `VPS_REMEDIATE_EXECUTE_COOLDOWN_MINUTES` (default `5`)
- `VPS_REMEDIATE_MAX_EXECUTE_PER_HOUR` (default `6`)
- `VPS_REMEDIATE_ENFORCE_ALLOWLIST` (default `1`)
- `VPS_REMEDIATE_MAX_COMMANDS_PER_ACTION` (default `20`)
- `VPS_REMEDIATE_MAX_COMMAND_LENGTH` (default `800`)
- `VPS_ADMIN_EMAILS` (optional; comma/newline-separated admin allowlist)
  - fallback default: `tonyblumdev@gmail.com`
- Optional regex extensions:
  - `VPS_REMEDIATE_ALLOWLIST_REGEX`
  - `VPS_REMEDIATE_BLOCKLIST_REGEX`

## v2.1 Step 4 Features (Support + Notify + Breaches)

Support bundle API:

- `GET /api/support/bundle`
  - Auth required (session)
  - Query params:
    - `hostId` (optional)
    - `limit` (optional, default 80)
    - `includeRaw=1` (optional)
    - `download=1` (optional; returns attachment header)
- `POST /api/support/bundle`
  - Auth required (session)
  - Body supports same options as GET.

Notify test API:

- `POST /api/notify/test`
  - Admin RBAC required
  - Sends real notify tests to saved endpoints (`NotificationEndpoint`) or ad-hoc `target`.
  - Body:
    - `kind`: `EMAIL` or `WEBHOOK` (optional if inferable from `target`)
    - `target`: email or webhook URL (optional)
    - `hostId`: optional host context
    - `title`, `detail`: optional custom test message
  - Persists `NotificationEvent` rows for each attempt.

Breaches API:

- `GET /api/hosts/:hostId/breaches`
  - Auth required (session, host ownership enforced)
  - Filters:
    - `state=open|fixed|ignored|all`
    - `severity=info|warn|critical|all`
    - `q` (title/detail/code search)
    - `cursor` + `limit` (pagination)
    - `includeEvidence=1`
- `POST /api/hosts/:hostId/breaches`
  - Auth required (session, host ownership enforced)
  - Actions:
    - `create`
    - `mark-fixed`
    - `reopen`
    - `ignore`
    - `set-state`

## v2.2 Step 5 (SQLite -> Postgres Migration)

Migration artifacts:

- Postgres Prisma schema: `/Users/tonyblum/projects/vps-sentry-web/prisma/schema.postgres.prisma`
- Postgres baseline SQL: `/Users/tonyblum/projects/vps-sentry-web/prisma/postgres/0001_init.sql`
- Runbook: `/Users/tonyblum/projects/vps-sentry-web/docs/sqlite-postgres-migration.md`

Commands:

```bash
# env setup
export POSTGRES_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/vps_sentry_web?schema=public"
export SQLITE_DB_PATH="/Users/tonyblum/projects/vps-sentry-web/prisma/dev.db"

# phased
make db-pg-init
make db-pg-copy
make db-pg-verify

# one-command (backup + init + copy + verify)
make db-pg-migrate
```

Zero-data-loss controls:

- Pre-cutover source snapshot (`.db-migration-backups/<timestamp>/sqlite-precutover.db`).
- Optional Postgres pre/post copy dumps if `pg_dump` is present.
- Parity verification:
  - row counts
  - keyset identity checks
  - null-vs-empty text invariants.

## v2.3 Step 6 (Production Ops: Monitor + Alert + Backup + Restore Drill)

New scripts:

- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-monitor.sh`
  - Checks service health, smoke endpoints, disk threshold, and backup freshness.
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-alert.sh`
  - Sends alerts to webhook and/or local mail/sendmail transports.
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-backup.sh`
  - Creates snapshot artifacts (app archive, sqlite snapshot, optional postgres dump).
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-restore-drill.sh`
  - Verifies backup integrity and performs a non-prod restore drill.
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-backup-automation.sh`
  - Installs/removes/checks VPS cron automation for hourly backups.

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/production-ops-runbook.md`

## v4.0 Step 20 (Supply-Chain Security + Chaos Certification + Sentinel Prime Scorecard)

Step 20 adds final readiness controls:

- supply-chain policy gate:
  - frozen lockfile verification
  - production vuln threshold enforcement
  - license policy scan
  - SBOM + provenance artifacts
- chaos certification:
  - baseline smoke
  - controlled service restart drill
  - measured recovery-time objective
  - post-restart load smoke
- Sentinel Prime scorecard:
  - weighted pass/fail scoring across release, security, recovery, and chaos dimensions
  - JSON + Markdown artifacts for operator evidence

New commands:

```bash
make supply-chain-check
make supply-chain-check-strict
make chaos-certify
make chaos-certify-fast
make sentinel-scorecard
make sentinel-scorecard-fast
make sentinel-scorecard-strict
```

NPM equivalents:

```bash
npm run supplychain:check
npm run supplychain:check:strict
npm run chaos:certify
npm run chaos:certify:fast
npm run sentinel:scorecard
npm run sentinel:scorecard:fast
npm run sentinel:scorecard:strict
```

Artifacts:

- `.artifacts/supply-chain/*`
- `.artifacts/chaos/*`
- `.artifacts/sentinel-prime/<run-id>/scorecard.{json,md}`
- `.artifacts/sentinel-prime/latest.{json,md}`

Step 20 runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/sentinel-prime-runbook.md`

## v3.5 Step 19 (Fleet Policy Management + Staged Rollout + Blast-Radius Safeguards)

Step 19 adds fleet-wide remediation controls:

- host fleet metadata in `Host.metaJson.fleetPolicy`:
  - `group`
  - `tags[]`
  - `scopes[]`
  - `rolloutPaused`
  - `rolloutPriority`
- fleet policy inventory + bulk patch API
- staged fleet remediation rollout API with:
  - selector filtering (group/tag/scope/hostId)
  - strategy (`group_canary` or `sequential`)
  - blast-radius controls (`max hosts`, `% enabled fleet`, `max per group`)
  - stage confirmation phrase requirement

New APIs:

- `GET|POST /api/ops/fleet-policy` (admin)
- `POST /api/ops/remediate-fleet` (ops/admin)

Per-host API updates:

- `GET /api/hosts`
- `GET /api/hosts/:hostId`
- `PUT /api/hosts/:hostId`
- `POST /api/hosts`

Now support fleet fields:

- `fleetGroup`
- `fleetTags`
- `fleetScopes`
- `fleetRolloutPaused`
- `fleetRolloutPriority`

Step 19 env knobs (in `.vps.env`):

- `VPS_REMEDIATE_FLEET_MAX_HOSTS`
- `VPS_REMEDIATE_FLEET_MAX_PER_GROUP`
- `VPS_REMEDIATE_FLEET_MAX_PERCENT_ENABLED`
- `VPS_REMEDIATE_FLEET_DEFAULT_STAGE_SIZE`
- `VPS_REMEDIATE_FLEET_REQUIRE_SELECTOR`
- `VPS_REMEDIATE_FLEET_POLICY_MAX_HOST_UPDATES`

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/fleet-rollout-runbook.md`

Make targets:

```bash
make vps-monitor
make vps-monitor-alert
make vps-backup-dry-run
make vps-backup
make vps-restore-drill
make vps-backup-automation-status
make vps-backup-automation-install
make vps-backup-automation-remove
```

Recommended operator flow:

```bash
# 1) Preview backup output
make vps-backup-dry-run

# 2) Take real snapshot and write freshness marker
make vps-backup

# 3) Validate restore path
make vps-restore-drill

# 4) Install hourly automation on VPS cron
make vps-backup-automation-install

# 5) Run monitor with alert fanout
make vps-monitor-alert
```

Step 6 env knobs live in:

- `/Users/tonyblum/projects/vps-sentry-web/.vps.example.env`

Important Postgres drill note:

- If backup includes `postgres.sql`, set `VPS_RESTORE_DRILL_POSTGRES_URL` to a dedicated scratch DB.
- Restore drill resets `public` schema on that drill DB (never point it at live production DB).

## v2.4 Step 7 (Queued Remediation + Host Policy Profiles + Stronger Safety)

Remediation execute path is now queue-first:

- `POST /api/remediate` with `mode: "execute"` now writes a `queued` run first.
- Queue safety controls enforce:
  - per-host queue cap
  - global queue cap
  - queued-run TTL
  - dry-run freshness gate
  - cooldown + hourly execute rate limits
- Queue drain can run via:
  - `POST /api/remediate` with `mode: "drain-queue"` (admin session)
  - `POST /api/ops/remediate-drain` (admin session or `x-remediate-queue-token`)

Host policy profiles:

- Per-host profile can be set to:
  - `strict`
  - `balanced` (default)
  - `rapid`
- Host update API supports policy config:
  - `PUT /api/hosts/:hostId`
  - body keys:
    - `remediationPolicyProfile`
    - `remediationPolicyOverrides` (queue/rate/timeout knobs)
    - `remediationGuardOverrides` (allowlist + command-length/count knobs)

Step 7 env knobs:

- `VPS_REMEDIATE_MAX_QUEUE_PER_HOST`
- `VPS_REMEDIATE_MAX_QUEUE_TOTAL`
- `VPS_REMEDIATE_QUEUE_TTL_MINUTES`
- `VPS_REMEDIATE_MAX_RETRY_ATTEMPTS`
- `VPS_REMEDIATE_RETRY_BACKOFF_SECONDS`
- `VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS`
- `VPS_REMEDIATE_COMMAND_TIMEOUT_MS`
- `VPS_REMEDIATE_MAX_BUFFER_BYTES`
- `VPS_REMEDIATE_QUEUE_AUTODRAIN`
- `VPS_REMEDIATE_QUEUE_TOKEN` (optional; used by `/api/ops/remediate-drain`)

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/remediation-queue-runbook.md`

## v2.5 Step 8 (Security Headers + CSP + Rate Limits + Load Hardening)

Global web hardening:

- Middleware now injects security headers + CSP on app/API responses:
  - `Content-Security-Policy`
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `Cross-Origin-Opener-Policy`
  - `Cross-Origin-Resource-Policy`
  - `Strict-Transport-Security` (when served via HTTPS)

API abuse protection:

- Middleware applies route-aware request rate limiting with `429` enforcement.
- Rate limit response headers are emitted (`X-RateLimit-*` and `RateLimit-*`).
- Higher-risk write routes (`/api/auth/*`, `/api/remediate`, `/api/ops/*`, ingest POST) use stricter quotas.

Performance/load hardening:

- `/api/status` now uses short in-process micro-cache to reduce repeated disk reads under burst load.
- Default TTL is `1200ms`, configurable via:
  - `VPS_STATUS_CACHE_TTL_MS` (set `0` to disable).

Operational verification scripts:

```bash
make security-headers-check
make perf-load-smoke
```

Step 8 runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/security-performance-runbook.md`

Release gate commands:

```bash
make release-gate   # test + typecheck + vps-check + vps-hygiene-check + smoke
make release        # release-gate + deploy + smoke
```

CI gate:

- GitHub Actions workflow: `/Users/tonyblum/projects/vps-sentry-web/.github/workflows/ci.yml`
- Pipeline order: `test -> typecheck -> lint -> build`
- Local equivalent:

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

Archive pruning:

```bash
make vps-prune-archives                       # apply default retention (30 days)
./scripts/vps-archive-prune.sh --dry-run     # preview only
./scripts/vps-archive-prune.sh --days 14      # apply custom retention
```

Optional env knobs in `.vps.env`:

- `VPS_ARCHIVE_BASE=/home/tony/_archive/vps-sentry`
- `VPS_ARCHIVE_KEEP_DAYS=30`

## v2.6 Step 9 (Operator Playbooks + Incident Workflows + Admin UX)

New operator docs:

- `/Users/tonyblum/projects/vps-sentry-web/docs/operator-playbooks.md`
- `/Users/tonyblum/projects/vps-sentry-web/docs/incident-workflows.md`

Incident workflow API:

- `GET /api/ops/incident-workflow`
  - Returns workflow catalog for admin responders.
- `POST /api/ops/incident-workflow`
  - Executes API-safe workflow step actions (`status-snapshot`, `drain-queue`, `replay-dlq`, `notify-test`).
  - Manual-only steps are intentionally blocked from API execution.
  - Step failures are surfaced as `ok: false` and written to audit logs.

Admin UX improvements (`/admin`):

- New **Operator Console** panel with:
  - quick action buttons (drain queue, report-now, notify test, status snapshot)
  - one-click workflow step runner for API-safe steps
  - manual-step labels for human-only actions
  - recent privileged ops timeline (audit log derived)
  - latest action result preview for operator feedback

Step 9 verification:

```bash
npm test
npx tsc --noEmit
npm run lint -- --max-warnings=0
```

## v2.7 Step 10 (Production Postgres Cutover + Shadow Reads + Rollback)

Step 10 adds production cutover controls:

- deploy-time Prisma provider switch (`VPS_DB_PROVIDER=sqlite|postgres`)
- shadow-read parity checks (`make db-pg-shadow`)
- acceptance artifact generation (`make db-pg-acceptance`)
- one-command orchestrated cutover (`make db-pg-cutover`)
- one-command rollback to pre-cutover SQLite snapshot (`make db-pg-rollback`)

New DB commands:

```bash
make db-generate-sqlite
make db-generate-postgres
make db-pg-shadow
make db-pg-acceptance
make db-pg-cutover
make db-pg-rollback
```

Recommended cutover flow:

```bash
cd /Users/tonyblum/projects/vps-sentry-web
export POSTGRES_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/vps_sentry_web?schema=public"
export SQLITE_DB_PATH="/Users/tonyblum/projects/vps-sentry-web/prisma/dev.db"
CUTOVER_CONFIRM=I_UNDERSTAND_PRODUCTION_CUTOVER make db-pg-cutover
make release
make smoke
```

Rollback flow (if needed):

```bash
cd /Users/tonyblum/projects/vps-sentry-web
source .db-cutover-runs/<timestamp>/rollback.env
ROLLBACK_SQLITE_BACKUP="$ROLLBACK_SQLITE_BACKUP" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
VPS_ENV_FILE="$VPS_ENV_FILE" \
make db-pg-rollback
make deploy
make smoke
```

Cutover runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/sqlite-postgres-migration.md`

## v2.8 Step 11 (Durable Remediation Worker + Retries + DLQ + Replay)

Step 11 upgrades remediation queue operations with durable worker semantics:

- retry scheduling with exponential backoff
- dead-letter queue tagging on max-attempt or non-retryable failures
- replay APIs for single run and DLQ batch replay
- operator queue visibility APIs + admin console UI
- durable worker runtime script for continuous queue draining

New ops APIs:

- `GET /api/ops/remediate-queue` (queue snapshot / DLQ view)
- `POST /api/ops/remediate-replay` (single replay or DLQ batch replay)

Worker runtime:

```bash
make ops-worker
make ops-worker-once
```

Or npm:

```bash
npm run ops:worker
npm run ops:worker:once
```

Step 11 env knobs:

- `VPS_REMEDIATE_MAX_RETRY_ATTEMPTS`
- `VPS_REMEDIATE_RETRY_BACKOFF_SECONDS`
- `VPS_REMEDIATE_RETRY_BACKOFF_MAX_SECONDS`
- `OPS_WORKER_BASE_URL`
- `OPS_WORKER_TOKEN` (or `VPS_REMEDIATE_QUEUE_TOKEN`)
- `OPS_WORKER_DRAIN_LIMIT`
- `OPS_WORKER_INTERVAL_SECONDS`
- `OPS_WORKER_IDLE_INTERVAL_SECONDS`
- `OPS_WORKER_MAX_BACKOFF_SECONDS`

Step 11 runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/remediation-queue-runbook.md`

## v2.9 Step 13 (Key/Secret Lifecycle Hardening)

Step 13 upgrades host API key handling with lifecycle controls:

- scoped host keys (`host.status.write`, `host.status.read`, `host.history.read`)
- monotonic key versioning per host
- explicit rotation lineage (`rotatedFromKeyId`)
- revocation reason tracking
- optional key expiry timestamps
- token verification API + CLI tooling

New/updated endpoints:

- `POST /api/hosts/:hostId/keys`
  - actions: `create`, `rotate`, `revoke`, `verify`
- `GET /api/hosts/:hostId/keys/verify`
  - bearer-token verification endpoint (optional `scope`, optional `touch=1`)
- `POST /api/hosts/:hostId/keys/verify`
  - bearer-token verification endpoint (body `scope`/`requiredScope`)

Verification tooling:

```bash
./scripts/host-key-verify.sh --host-id <host-id> --token <token> --scope host.status.write
make host-key-verify HOST_ID=<host-id> HOST_TOKEN=<token> HOST_KEY_SCOPE=host.status.read BASE_URL=https://vps-sentry.example.com
```

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/key-lifecycle-runbook.md`

## v3.0 Step 14 (Full Observability: Logs, Metrics, Traces, Correlation IDs)

Step 14 adds platform-wide observability:

- middleware-level correlation + trace headers (`x-correlation-id`, `x-trace-id`, `x-span-id`)
- structured JSON logging with request/user/host context
- in-memory counters and timing metrics for API, notify, queue, and audit flows
- trace span capture with duration + status
- alert metadata capture for notify/email/webhook delivery attempts
- admin observability dashboard panel

New observability APIs:

- `GET /api/ops/observability` (admin-only snapshot JSON)
- `GET /api/ops/metrics` (ops/admin Prometheus text)

Admin UX:

- `/admin` now includes a live Observability section (refreshable logs/metrics/traces/alerts).

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/observability-runbook.md`

## v3.1 Step 15 (SLOs + Burn-Rate Alerting + MTTD/MTTR Goals)

Step 15 adds objective reliability targets with routing-aware burn-rate alerting:

- SLO objectives for:
  - `/api/status` availability
  - notification delivery success
  - ingest freshness (heartbeat health)
  - MTTD and MTTR duration goals
- burn-rate severity evaluation (`ok/warn/critical`) with route selection (`none/webhook/email/both`)
- automation-safe endpoint with ops RBAC, token auth, or trusted loopback probe auth
- ops scripts + Make targets for non-interactive checks and alerting

New API:

- `GET /api/ops/slo` (ops/admin, `x-slo-token`, or loopback host probe when `VPS_SLO_ALLOW_LOOPBACK_PROBE=1`)

New scripts/targets:

```bash
make vps-slo-check
make vps-slo-alert

# or npm
npm run ops:slo:check
npm run ops:slo:alert
```

New env knobs (in `.vps.env`):

- `VPS_SLO_WINDOW_HOURS`
- `VPS_SLO_BURN_SHORT_WINDOW_MINUTES`
- `VPS_SLO_BURN_LONG_WINDOW_MINUTES`
- `VPS_SLO_BURN_WARN`
- `VPS_SLO_BURN_CRITICAL`
- `VPS_SLO_AVAILABILITY_TARGET_PCT`
- `VPS_SLO_NOTIFY_DELIVERY_TARGET_PCT`
- `VPS_SLO_INGEST_FRESH_TARGET_PCT`
- `VPS_SLO_MTTD_TARGET_MINUTES`
- `VPS_SLO_MTTR_TARGET_MINUTES`
- `VPS_SLO_ROUTE_WARN`
- `VPS_SLO_ROUTE_CRITICAL`
- `VPS_SLO_TOKEN` (optional token auth for automation)
- `VPS_SLO_ALLOW_LOOPBACK_PROBE` (allow non-interactive VPS-host loopback probes)

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/slo-burn-rate-runbook.md`

## v3.2 Step 16 (Backup/Restore Hardening + Recurring Verified Drills + RPO/RTO Reports)

Step 16 hardens recovery operations with objective measurement and recurring verification:

- backup automation now supports direct local mode execution on VPS cron (`VPS_LOCAL_EXEC=1`)
- restore drill now writes durable run/success telemetry markers and history records
- objective recovery report script computes RPO/RTO and drill recency against targets
- recurring restore-drill automation installs weekly verified drills with breach alerts

New scripts:

- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-rpo-rto-report.sh`
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-restore-drill-automation.sh`

Updated scripts:

- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-backup.sh`
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-restore-drill.sh`
- `/Users/tonyblum/projects/vps-sentry-web/scripts/vps-backup-automation.sh`

Make targets:

```bash
make vps-rpo-rto-report
make vps-rpo-rto-report-alert
make vps-restore-drill-automation-status
make vps-restore-drill-automation-install
make vps-restore-drill-automation-remove
```

Step 16 env knobs:

- `VPS_BACKUP_REPORT_AFTER_RUN`
- `VPS_RESTORE_DRILL_CRON`
- `VPS_RESTORE_DRILL_LOG_PATH`
- `VPS_RESTORE_DRILL_HISTORY_FILE`
- `VPS_RPO_TARGET_MINUTES`
- `VPS_RTO_TARGET_MINUTES`
- `VPS_RESTORE_DRILL_MAX_AGE_HOURS`

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/production-ops-runbook.md`
