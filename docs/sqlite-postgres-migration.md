# SQLite -> Postgres Migration + Cutover (Step 10)

This runbook handles production-grade cutover from SQLite to Postgres with:

- source and target backup snapshots
- deterministic FK-safe table copy
- parity verification (counts + keysets + null/empty invariants)
- shadow-read parity checks on representative read queries
- cutover acceptance artifacts for auditability
- explicit rollback path back to SQLite

## Scope

Migrated tables:

- `User`
- `Subscription`
- `Host`
- `HostApiKey`
- `HostSnapshot`
- `Breach`
- `NotificationEndpoint`
- `NotificationEvent`
- `RemediationAction`
- `RemediationRun`
- `AuditLog`
- `Account`
- `Session`
- `VerificationToken`

## Prerequisites

- `sqlite3`, `psql`, and (optional) `pg_dump` installed
- Postgres DB created and reachable
- `POSTGRES_DATABASE_URL` exported
- `SQLITE_DB_PATH` set (defaults to `prisma/dev.db`)
- Node dependencies installed (for Prisma client generation)
- deploy config supports provider switching with `VPS_DB_PROVIDER=sqlite|postgres`

## Core Migration Commands

```bash
cd /Users/tonyblum/projects/vps-sentry-web
export POSTGRES_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/vps_sentry_web?schema=public"
export SQLITE_DB_PATH="/Users/tonyblum/projects/vps-sentry-web/prisma/dev.db"
make db-pg-init
make db-pg-copy
make db-pg-verify
make db-pg-shadow
make db-pg-acceptance
```

### One-command migration pass

```bash
cd /Users/tonyblum/projects/vps-sentry-web
make db-pg-migrate
```

This performs:

1. Backup SQLite and optional Postgres dump into `.db-migration-backups/<timestamp>/`
2. Initialize Postgres schema from `prisma/postgres/0001_init.sql`
3. Copy all rows SQLite -> Postgres
4. Run parity verification

## Zero-data-loss strategy

- Pre-cutover source snapshot:
  - SQLite file copy: `.db-migration-backups/<timestamp>/sqlite-precutover.db`
  - Postgres dump (if `pg_dump` exists): `.db-migration-backups/<timestamp>/postgres-precutover.sql`
- Null handling guard:
  - copy script enforces a dedicated null sentinel and fails on sentinel collisions in text columns
- Parity checks:
  - row counts table-by-table
  - keyset identity checks (`id`, or `identifier+token` for `VerificationToken`)
  - null vs empty-string invariants for text columns
- Acceptance checks:
  - shadow-read parity across representative app reads (`make db-pg-shadow`)
  - stable keyset SHA256 artifacts per table (`make db-pg-acceptance`)

## Production Cutover (Recommended)

Run the orchestrated cutover script:

```bash
cd /Users/tonyblum/projects/vps-sentry-web
export POSTGRES_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/vps_sentry_web?schema=public"
export SQLITE_DB_PATH="/Users/tonyblum/projects/vps-sentry-web/prisma/dev.db"
CUTOVER_CONFIRM=I_UNDERSTAND_PRODUCTION_CUTOVER make db-pg-cutover
```

This script:

1. Runs migration with backups into `.db-cutover-runs/<timestamp>/migration/`
2. Runs acceptance verification into `.db-cutover-runs/<timestamp>/acceptance/`
3. Generates Prisma client for Postgres provider
4. Updates `.vps.env` to `VPS_DB_PROVIDER=postgres`
5. Writes rollback pointer file: `.db-cutover-runs/<timestamp>/rollback.env`

After script success:

1. Ensure app runtime env contains `POSTGRES_DATABASE_URL`
2. Deploy/restart app with Postgres provider:
   - `make release` (or `make deploy` + `make smoke`)
3. Confirm health:
   - `/`, `/login`, `/api/status` return `200`
   - admin/dashboard read paths render correctly

## Rollback path

If post-cutover behavior is incorrect:

1. Restore SQLite snapshot and switch provider:

```bash
cd /Users/tonyblum/projects/vps-sentry-web
source .db-cutover-runs/<timestamp>/rollback.env
ROLLBACK_SQLITE_BACKUP="$ROLLBACK_SQLITE_BACKUP" \
SQLITE_DB_PATH="$SQLITE_DB_PATH" \
VPS_ENV_FILE="$VPS_ENV_FILE" \
make db-pg-rollback
```

2. Rebuild/redeploy service on SQLite provider:
   - `make deploy`
3. Verify:
   - `make release-gate`
   - `make smoke`
4. Keep cutover artifacts for forensic diff and retry planning.

## Operator Notes

- Keep both DB URLs available during transition (`DATABASE_URL` for SQLite fallback and `POSTGRES_DATABASE_URL` for Postgres provider).
- Do not delete SQLite backup artifacts until cutover is stable in production.
- Repeat `make db-pg-acceptance` right before final deploy if high write activity occurred between earlier migration and release window.
