# Incident Workflows (Step 17)

Step 17 upgrades incident handling from a static step catalog into a persistent
incident workflow engine with assignment, acknowledgement timers, escalation
sweeps, timeline history, and postmortem scaffolding.

## What’s New in v2

- Persistent `IncidentWorkflowRun` records for every incident.
- Assignment model (`assigneeUserId` + `assigneeEmail`) with timeline events.
- Explicit lifecycle states:
  - `open` -> `acknowledged` -> `resolved` -> `closed`
- Escalation timers:
  - `ackDueAt`
  - `nextEscalationAt`
  - `escalationCount`
- Rich timeline via `IncidentWorkflowEvent`.
- Postmortem scaffold fields:
  - status (`not_started`, `draft`, `published`, `waived`)
  - summary, impact, root cause, action items.

## Data Model

Source of truth:

- `prisma/schema.prisma`
- `prisma/schema.postgres.prisma`

SQLite migration:

- `prisma/migrations/20260208223500_incident_workflow_engine_v2/migration.sql`

Postgres additive SQL:

- `prisma/postgres/0004_incident_workflow_engine_v2.sql`

## API Surface

### Existing Catalog + Step Executor

- `GET /api/ops/incident-workflow`
- `POST /api/ops/incident-workflow`

Used for catalog listing and standalone API-safe workflow step execution.

### Incident Engine v2

- `GET /api/ops/incidents`
  - list incidents with counts and filters (`state`, `hostId`, `assigneeUserId`, `includeClosed`)
- `POST /api/ops/incidents`
  - `action=create` create incident run
  - `action=escalation-sweep` run due escalation timers
- `GET /api/ops/incidents/[incidentId]`
  - fetch incident detail + timeline
- `POST /api/ops/incidents/[incidentId]`
  - lifecycle and ops actions:
    - `assign`
    - `acknowledge`
    - `resolve`
    - `close`
    - `reopen`
    - `note`
    - `postmortem`
    - `step` (execute API-safe workflow step and append timeline event)
- `POST /api/ops/incidents/escalate`
  - token or ops-authenticated escalation sweep endpoint for automation.

All endpoints are RBAC-gated (`ops+`), audit-logged, and observed.

## Timer Policy

Defaults by severity:

- `critical`: ack 5m, escalate every 10m
- `high`: ack 15m, escalate every 20m
- `medium`: ack 30m, escalate every 45m

Override via runtime env:

- `VPS_INCIDENT_ACK_MINUTES_CRITICAL`
- `VPS_INCIDENT_ACK_MINUTES_HIGH`
- `VPS_INCIDENT_ACK_MINUTES_MEDIUM`
- `VPS_INCIDENT_ESCALATE_EVERY_MINUTES_CRITICAL`
- `VPS_INCIDENT_ESCALATE_EVERY_MINUTES_HIGH`
- `VPS_INCIDENT_ESCALATE_EVERY_MINUTES_MEDIUM`

Optional automation token:

- `VPS_INCIDENT_ESCALATE_TOKEN`
  - sent as header `x-incident-escalate-token` to
    `POST /api/ops/incidents/escalate`.

## Admin UX

`/admin` now includes **Incident Workflow Engine v2** with:

- incident creation panel
- active incident list + detail selection
- assign / acknowledge / resolve / close / reopen controls
- workflow step execution per incident
- timeline notes and event stream
- postmortem scaffold editing
- escalation sweep action

## Related Code

- `src/lib/ops/incident-engine.ts`
- `src/lib/ops/workflow-executor.ts`
- `src/app/api/ops/incidents/route.ts`
- `src/app/api/ops/incidents/[incidentId]/route.ts`
- `src/app/api/ops/incidents/escalate/route.ts`
- `src/app/admin/IncidentEnginePanel.tsx`
