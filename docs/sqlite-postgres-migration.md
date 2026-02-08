# SQLite -> Postgres Migration (Zero-Data-Loss Plan)

This runbook migrates all app data from SQLite to Postgres with:

- source backup before copy
- deterministic table copy in FK-safe order
- parity verification (row counts, keysets, null-vs-empty invariants)
- explicit rollback commands

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

## One-command migration

```bash
cd /Users/tonyblum/projects/vps-sentry-web
export POSTGRES_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/vps_sentry_web?schema=public"
export SQLITE_DB_PATH="/Users/tonyblum/projects/vps-sentry-web/prisma/dev.db"
make db-pg-migrate
```

This does:

1. Backup SQLite (and Postgres dump when available) into `.db-migration-backups/<timestamp>/`
2. Initialize Postgres schema from `prisma/postgres/0001_init.sql`
3. Copy all rows SQLite -> Postgres
4. Verify parity

## Manual phased migration

```bash
cd /Users/tonyblum/projects/vps-sentry-web
make db-pg-init
make db-pg-copy
make db-pg-verify
```

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

## Cutover (app runtime)

When the Postgres dataset is verified:

1. Put app in maintenance/read-only mode.
2. Ensure final SQLite -> Postgres copy/verify pass is green.
3. Update runtime DB env to Postgres (`DATABASE_URL` in app runtime env once app client is switched).
4. Restart app and run release smoke checks.

## Rollback path

If any post-cutover issue appears:

1. Restore previous runtime DB config (SQLite) and restart app.
2. Restore SQLite backup if needed:

```bash
cp .db-migration-backups/<timestamp>/sqlite-precutover.db /path/to/live/dev.db
```

3. Verify app health (`make release-gate`, smoke endpoints).
4. Keep Postgres snapshot for forensic diffing and reattempt.

