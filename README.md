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
