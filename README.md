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
   - If the VPS repo has drift/local commits and you explicitly want to reset it safely:
     - set `VPS_DEPLOY_STRATEGY=reset` (script creates `backup/pre-deploy-*` then hard-resets to origin)
   - Set either `VPS_SERVICE` (systemd) or `VPS_PM2_APP` (pm2).
3. Run commands:
   ```bash
   cd /Users/tonyblum/projects/vps-sentry-web
   make vps-check
   make deploy
   make logs
   make rollback TO=HEAD~1
   ```

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
