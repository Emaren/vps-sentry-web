# SLO + Burn-Rate Runbook (Step 15)

Step 15 adds objective SLO tracking with burn-rate alerting and measurable MTTD/MTTR goals.

## Objectives and targets

Default targets are configurable in `.vps.env`:

- Availability (`/api/status`): `VPS_SLO_AVAILABILITY_TARGET_PCT=99.9`
- Notify delivery success: `VPS_SLO_NOTIFY_DELIVERY_TARGET_PCT=99`
- Ingest freshness (non-missing host heartbeat): `VPS_SLO_INGEST_FRESH_TARGET_PCT=99`
- MTTD target: `VPS_SLO_MTTD_TARGET_MINUTES=5`
- MTTR target: `VPS_SLO_MTTR_TARGET_MINUTES=60`

Measurement windows:

- Main SLO window: `VPS_SLO_WINDOW_HOURS` (default `24`)
- Burn short window: `VPS_SLO_BURN_SHORT_WINDOW_MINUTES` (default `5`)
- Burn long window: `VPS_SLO_BURN_LONG_WINDOW_MINUTES` (default `60`)

## Burn-rate policy

Burn-rate compares current error rate to allowed error budget:

- warning threshold: `VPS_SLO_BURN_WARN` (default `6`)
- critical threshold: `VPS_SLO_BURN_CRITICAL` (default `14`)

Severity is elevated by:

- burn threshold breaches
- target misses on percent objectives
- MTTD/MTTR objective breach
- open breaches older than MTTD target

## Routing and channels

SLO severity can map to channel route:

- `VPS_SLO_ROUTE_WARN` (`none|webhook|email|both`)
- `VPS_SLO_ROUTE_CRITICAL` (`none|webhook|email|both`)
- `VPS_SLO_ALLOW_LOOPBACK_PROBE` (`1|0`, default `1`)

Alert delivery is handled by `scripts/vps-alert.sh` with route support:

- `none`
- `webhook`
- `email`
- `both`
- `auto` (severity-driven via `VPS_ALERT_ROUTE_INFO|WARN|CRITICAL`)

## API and auth

Endpoint:

- `GET /api/ops/slo`

Auth:

- ops/admin session OR
- `x-slo-token` header when `VPS_SLO_TOKEN` is configured server-side
- trusted loopback probe from the VPS host itself (`Host: 127.0.0.1|localhost`, no proxy headers) when
  `VPS_SLO_ALLOW_LOOPBACK_PROBE=1`

## Operator commands

```bash
# Check SLO state only (warn/critical returns non-zero)
make vps-slo-check

# Check + route alerts
make vps-slo-alert

# Raw JSON for debugging
./scripts/vps-slo-burn-rate.sh --json --no-alert
```

Exit codes for `vps-slo-burn-rate.sh`:

- `0` healthy
- `30` warning
- `31` critical
- `1` endpoint/auth/parse/alert transport failure

## Suggested automation

Run every 5 minutes:

```bash
cd /var/www/vps-sentry-web
./scripts/vps-slo-burn-rate.sh --alert --soft >> /var/log/vps-sentry-slo.log 2>&1
```

`--soft` keeps cron exit status `0` while still sending routed alerts.

## MTTD and MTTR interpretation

- MTTD: average minutes from `Breach.openedTs` to first delivered notify event on that host.
- MTTR: average minutes from `Breach.openedTs` to `Breach.fixedTs`.

Use these to track response quality over time:

- if MTTD rises, detection/notification path is lagging.
- if MTTR rises, remediation workflow or staffing is lagging.
