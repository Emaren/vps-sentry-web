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
- `VPS_REMEDIATE_COMMAND_TIMEOUT_MS`
- `VPS_REMEDIATE_MAX_BUFFER_BYTES`
- `VPS_REMEDIATE_QUEUE_AUTODRAIN`
- `VPS_REMEDIATE_QUEUE_TOKEN` (optional; used by `/api/ops/remediate-drain`)

Runbook:

- `/Users/tonyblum/projects/vps-sentry-web/docs/remediation-queue-runbook.md`

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
