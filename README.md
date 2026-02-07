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
   - Set either `VPS_SERVICE` (systemd) or `VPS_PM2_APP` (pm2).
3. Run commands:
   ```bash
   cd /Users/tonyblum/projects/vps-sentry-web
   make vps-check
   make deploy
   make logs
   make rollback TO=HEAD~1
   ```
