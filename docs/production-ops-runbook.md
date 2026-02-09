# Production Ops Runbook (Step 6 + Step 16)

This runbook covers:

- monitoring and alert fanout
- backup automation
- recurring restore drill verification
- measured RPO/RTO objective reporting

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
- `VPS_RPO_TARGET_MINUTES`
- `VPS_RTO_TARGET_MINUTES`
- `VPS_RESTORE_DRILL_MAX_AGE_HOURS`

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

App readiness probes:

- process-only readiness: `curl -fsS "http://127.0.0.1:${VPS_WEB_PORT}/api/readyz"`
- DB-inclusive readiness: `curl -fsS "http://127.0.0.1:${VPS_WEB_PORT}/api/readyz?check=db"`

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
- `$VPS_BACKUP_BASE/last_success_iso`
- `$VPS_BACKUP_BASE/last_success_path`
- `$VPS_BACKUP_BASE/backup-history.log`

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

Notes:

- Backup automation now runs with `VPS_LOCAL_EXEC=1` on the VPS cron host (no nested SSH hop).
- If `VPS_BACKUP_REPORT_AFTER_RUN=1`, each backup run also emits a fresh RPO/RTO report.

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

Restore drill marker outputs:

- `$VPS_BACKUP_BASE/restore_last_run_epoch`
- `$VPS_BACKUP_BASE/restore_last_run_status`
- `$VPS_BACKUP_BASE/restore_last_run_rto_seconds`
- `$VPS_BACKUP_BASE/restore_last_run_rpo_seconds`
- `$VPS_BACKUP_BASE/restore_last_success_epoch`
- `$VPS_BACKUP_BASE/restore_last_success_rto_seconds`
- `$VPS_BACKUP_BASE/restore-drill-history.log` (default path)

## 7) RPO/RTO Report

Generate objective recovery report:

```bash
make vps-rpo-rto-report
```

Generate report and alert on objective breach:

```bash
make vps-rpo-rto-report-alert
```

Output includes:

- actual backup freshness age (RPO actual)
- actual restore runtime from last successful drill (RTO actual)
- restore drill recency age
- target pass/fail status and overall result

## 8) Recurring Restore Drill Automation

Install weekly restore drill + objective report cron:

```bash
make vps-restore-drill-automation-install
```

Check status:

```bash
make vps-restore-drill-automation-status
```

Remove:

```bash
make vps-restore-drill-automation-remove
```

The scheduled job runs:

1. `./scripts/vps-restore-drill.sh`
2. `./scripts/vps-rpo-rto-report.sh --alert --soft`

## 9) Suggested cadence

- hourly: backup automation
- every 5-15 minutes: monitor with alerts
- weekly: restore drill automation
- daily: objective report check (`make vps-rpo-rto-report`)
- before release: `make release-gate` + `make vps-monitor`
