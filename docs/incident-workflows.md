# Incident Workflows (Step 9)

Incident workflows provide a structured sequence for admin responders.
They are intentionally additive and safety-first:

- API steps can be executed from `/admin`.
- Manual steps remain explicit and require human confirmation.
- Every call is RBAC-gated and audit-logged.

## Workflow Catalog

Source of truth:

- `src/lib/ops/workflows.ts`

Current workflow IDs:

- `critical-triage` (severity: `critical`)
- `auth-abuse-response` (severity: `high`)
- `degraded-performance` (severity: `medium`)

## API Contract

Route:

- `GET /api/ops/incident-workflow`
- `POST /api/ops/incident-workflow`

Auth:

- Admin session required (`requireAdminAccess`).

### List Workflows

```bash
curl -sS -X GET "https://<your-host>/api/ops/incident-workflow" \
  --cookie "<admin-session-cookie>"
```

Response shape:

```json
{
  "ok": true,
  "workflows": [
    {
      "id": "critical-triage",
      "severity": "critical",
      "steps": [
        { "id": "status-snapshot", "kind": "api" },
        { "id": "manual-validate", "kind": "manual" }
      ]
    }
  ]
}
```

### Execute API Step

```bash
curl -sS -X POST "https://<your-host>/api/ops/incident-workflow" \
  -H "content-type: application/json" \
  --cookie "<admin-session-cookie>" \
  -d '{
    "workflowId": "critical-triage",
    "stepId": "notify-test",
    "payload": {
      "target": "ops@example.com",
      "kind": "EMAIL"
    }
  }'
```

Behavior:

- Rejects unknown workflow or step IDs.
- Rejects manual-only steps via API.
- Merges `defaultPayload` from workflow step with request `payload`.
- Returns top-level `ok: false` if step execution reports failure.
- Writes audit log entry for both success and failure.

## Admin UX Flow

The `/admin` page now includes an **Operator Console** with:

- quick actions (drain queue, report now, notify test, status snapshot)
- workflow cards with one-click API step execution
- manual-step labeling to prevent accidental API execution
- recent ops timeline from audit logs
- compact result preview for last action

## Design Constraints

- No hidden auto-remediation in Step 9.
- Workflow API executes only pre-approved safe actions:
  - `status-snapshot`
  - `drain-queue`
  - `notify-test`
- High-risk/manual interventions remain documented playbook steps.

## Related Docs

- `docs/operator-playbooks.md`
- `docs/remediation-queue-runbook.md`
- `docs/production-ops-runbook.md`
- `docs/security-performance-runbook.md`
