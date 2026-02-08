# Production Ops Runbook (Step 6)

This runbook covers:

- monitoring and alert fanout
- backup automation
- restore drill verification

## 1) Configure `.vps.env`

Start from the template:

```bash
cp /Users/tonyblum/projects/vps-sentry-web/.vps.example.env /Users/tonyblum/projects/vps-sentry-web/.vps.env
```

Set at least:

- `VPS_HOST`
- `VPS_APP_DIR`
- `VPS_SERVICE`
- `VPS_BACKUP_BASE`
- alert channels (`VPS_ALERT_WEBHOOK_URLS` and/or `VPS_ALERT_EMAIL_TO`)

Optional but recommended:

- `VPS_POSTGRES_DATABASE_URL` (for postgres dump backup)
- `VPS_RESTORE_DRILL_POSTGRES_URL` (dedicated scratch DB for restore drill)

## 2) Monitoring

Run health checks without alert fanout:

```bash
make vps-monitor
```

Run health checks and alert on failure:

```bash
make vps-monitor-alert
```

Checks included:

- app directory exists
- configured service is active
- `/`, `/login`, `/api/status` on `127.0.0.1:$VPS_WEB_PORT`
- root filesystem usage threshold
- backup freshness (`$VPS_BACKUP_BASE/last_success_epoch`)

## 3) Alerting

Manual alert test:

```bash
./scripts/vps-alert.sh --severity info --title "Manual alert test" --detail "Alert channel smoke test"
```

Delivery channels:

- webhook(s): `VPS_ALERT_WEBHOOK_URLS`
- email via system `mail` or `sendmail`: `VPS_ALERT_EMAIL_TO`

## 4) Backup

Preview a backup run:

```bash
make vps-backup-dry-run
```

Create backup snapshot:

```bash
make vps-backup
```

Artifacts created (when available):

- `app.tar.gz`
- `sqlite.db`
- `postgres.sql`
- `metadata.env`
- `checksums.sha256`

After successful backup, marker files are updated:

- `$VPS_BACKUP_BASE/last_success_epoch`
- `$VPS_BACKUP_BASE/last_success_path`

## 5) Backup Automation

Install hourly backup cron on VPS:

```bash
make vps-backup-automation-install
```

Check status:

```bash
make vps-backup-automation-status
```

Remove automation:

```bash
make vps-backup-automation-remove
```

## 6) Restore Drill

Run a restore drill against latest backup:

```bash
make vps-restore-drill
```

Run against a specific backup directory:

```bash
./scripts/vps-restore-drill.sh --from /home/tony/_backup/vps-sentry-web/<snapshot-dir>
```

### Postgres drill safety

If `postgres.sql` exists and `VPS_RESTORE_DRILL_POSTGRES_URL` is set, the drill does:

1. `DROP SCHEMA IF EXISTS public CASCADE`
2. `CREATE SCHEMA public`
3. restore SQL dump and verify expected tables

Always point drill URL to a dedicated scratch database.

## 7) Suggested cadence

- hourly: backup automation
- every 5-15 minutes: monitor with alerts
- weekly: restore drill
- before release: `make release-gate` + `make vps-monitor`
