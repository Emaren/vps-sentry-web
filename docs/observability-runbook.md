# Observability Runbook

Step 14 introduces full-stack observability across API, operator actions, and notification delivery:

- structured JSON logs
- request correlation IDs and trace IDs
- in-memory counters and timing metrics
- trace span capture with duration/status
- alert metadata trail for notify/email/webhook actions
- operator dashboard + API endpoints for observability and metrics

## Correlation and trace headers

All requests now use:

- `x-correlation-id`
- `x-trace-id`
- `x-span-id`
- `x-request-id` (mirrors correlation ID)

These are injected by middleware and returned in API responses.

## Metrics + traces

Metrics are captured in-process for:

- API requests (count/status/duration)
- middleware/rate-limit decisions
- notify email/webhook attempts + failures
- remediation queue/replay endpoints
- audit-log write success/failure
- trace span start/finish + duration

Trace spans are emitted for observed API routes and stored in a rolling in-memory window.

## Endpoints

- `GET /api/ops/observability`
  - admin-only
  - returns counters, timings, recent logs, recent traces, recent alert metadata
- `GET /api/ops/metrics`
  - ops/admin
  - returns Prometheus-style plaintext metrics

## Dashboard visibility

Admin page now includes an **Observability** section with:

- uptime and request health pills
- top counters + top timings
- recent alert metadata
- recent traces
- structured logs stream
- refresh button + direct `/api/ops/metrics` opener

## Alert metadata

Notify dispatch now records:

- correlation/trace IDs
- route/method context
- target and delivery status
- status/error detail

Metadata appears in:

- in-memory observability alert stream
- notification event payloads
- notify test email payload/headers context

## Buffer sizing

Tune in `.vps.env`:

- `VPS_OBS_MAX_LOGS`
- `VPS_OBS_MAX_TRACES`
- `VPS_OBS_MAX_ALERTS`

These are process-local in-memory ring buffers (cleared on restart/deploy).
