# VPSSentry High-ROI Improvement Plan

Last updated: May 18, 2026

## Likely Broken Layer

This plan starts at the planning and render layers, not source data or remediation wiring.

The dashboard already has strong live telemetry and reclaim primitives. The highest immediate return is making the operator path sharper: clearer labels, faster diagnosis, less ambiguous action language, and a documented sequence for deeper work. Every later tranche should still follow the data path in order:

1. source data
2. read/ingest
3. normalize/map
4. render
5. remediation wiring
6. post-action refresh

Do not treat a screenshot as proof of current host state. Verify `/var/lib/vps-sentry/public/status.json`, API output, and the live feed before changing status logic.

## Objective UI Criteria

The UI is objectively better only when it improves at least one measurable operator outcome:

- time to identify the broken layer
- time to choose the next safe action
- fewer ambiguous destructive-action labels
- clearer difference between current state, detected issue, and proposed action
- no color/state mismatch with normalized severity
- no layout shift or unreadable text on desktop and mobile
- fewer clicks to get from alert to inspectable evidence
- better post-action confidence through visible refresh, timestamps, and outcome telemetry

## Highest-ROI Execution Order

### 0. Guard the Baseline

Broken layer: verification and sync discipline.

Files to inspect/edit:

- `README.md`
- `docs/production-ops-runbook.md`
- `docs/operator-playbooks.md`
- `scripts/release-gate.sh`
- `scripts/release-smoke.sh`
- `../REPO_SYNC_MAP.md`

Actions:

- run the narrow tests for touched surfaces
- run `pnpm lint`
- run `pnpm build`
- run `make smoke` before deploy when VPS access is healthy
- run wrapper sync audit after deployment

Exit criteria:

- local repo, GitHub, and VPS agree on the deployed commit
- production smoke passes
- current-state docs name the deployed commit and verification result

### 1. Clarify the Existing Dashboard

Broken layer: render/UX.

Files to inspect/edit:

- `src/app/dashboard/_components/PowerMemoryTile.tsx`
- `src/app/dashboard/_components/GarbageTile.tsx`
- `src/app/dashboard/_components/ReclaimCategoryTile.tsx`
- `src/app/dashboard/_components/ThreatSignals.tsx`
- `src/app/globals.css`
- nearest component tests under `src/__tests__/`

Actions:

- replace vague or playful cleanup wording with precise operator verbs
- keep safe cleanup visually distinct from guided/manual reclaim
- make timestamps and live/snapshot state visible near each decision surface
- preserve current action wiring unless the task explicitly touches remediation

Exit criteria:

- the next action is obvious without implying fake certainty
- safe cleanup, guided reclaim, blocked/manual work, and threat response are visually and verbally distinct
- tests assert the operator-facing labels that matter

Status:

- May 18, 2026: first pass completed for reclaim labels and top CPU pressure wording.
- May 18, 2026: second pass completed for Counterstrike render framing. Stale analysis-only runs with zero candidates no longer claim to be the current red-state blocker when the live threat snapshot is standby; the panel now uses IOC/playbook action labels instead of vague `Zap` wording.
- May 18, 2026: containment/reclaim pass completed. Llama temp-exec IOC evidence was quarantined, `llama-chat.service` gained `/var/tmp` noexec containment, safe caches and root-resident dependency trees were moved off `/`, and the dashboard returned root pressure to green after a forced scan.
- May 20, 2026 local / May 21, 2026 UTC: follow-up IOC pass found `llama-chat.service` still able to execute from private temp paths even though the unit declared `TemporaryFileSystem=...noexec`. Counterstrike contained the two live temp executables, the live service namespace was corrected to real noexec tmpfs mounts, and the host detector was updated to verify live `/proc/<pid>/mountinfo` before calling temp-exec hardening protected.

### 2. Strengthen Data Contracts

Broken layer: read/ingest and normalize/map.

Files to inspect/edit:

- `src/lib/status.ts`
- `src/app/dashboard/_lib/derive.ts`
- `src/app/dashboard/_lib/alert-policy.ts`
- `src/app/dashboard/_lib/panel-health.ts`
- `src/__tests__/status.normalize.test.ts`
- `src/__tests__/alert.policy.test.ts`
- `src/__tests__/dashboard.derive.test.ts`

Actions:

- define fixtures for healthy, stale, root-pressure, IOC, and missing-file states
- make derived status object construction stricter and easier to reason about
- ensure stale source data cannot render as fresh confidence
- keep host/severity mappings explicit and tested

Exit criteria:

- all dashboard severity colors and labels can be traced to a normalized source field
- stale data is rendered as stale, not silently green or red
- adding a new host summary field requires an obvious parser/test change

### 3. Make Guided Reclaim Executable

Broken layer: remediation wiring and post-action refresh.

Files to inspect/edit:

- `src/app/api/ops/garbage/reclaim/route.ts`
- `src/lib/actions/script-catalog.ts`
- `src/lib/remediate/guard.ts`
- `src/lib/remediate/runner.ts`
- `src/app/dashboard/_components/PowerMemoryTile.tsx`
- `../vps-sentry/scripts/vps-guided-disk-rescue.sh`
- `../vps-sentry/deploy/usr-local/bin/vps-sentry-garbage-estimate`

Actions:

- turn the proven Stop -> Move -> Symlink -> Install -> Build -> Start -> Scan path into a deliberate workflow
- require service refs, exact source path, target volume path, and typed confirmation before mutation
- start a maintenance window before service stops
- restart only services that were active before the action
- always rescan and show before/after root-free bytes

Operational risk:

- service stops, filesystem moves, dependency reinstall/build, and symlinks are correctness-sensitive.
- this workflow must remain locked when service refs or target paths are not proven.

Exit criteria:

- guided dependency-tree relocation can be dry-run, executed, audited, rescanned, and rolled back deliberately
- no guided candidate can be executed from the safe cleanup path

### 4. First-Class Temp-Executable Containment

Broken layer: remediation wiring and source explainability.

Files to inspect/edit:

- `src/lib/remediate/containment-kit.ts`
- `src/lib/remediate/actions.ts`
- `src/app/api/ops/contain-runtime-ioc/route.ts`
- `src/app/dashboard/_components/CounterstrikeTile.tsx`
- `src/__tests__/containment.kit.test.ts`
- `src/__tests__/remediate.plan.test.ts`
- `../vps-sentry/scripts/vps-guided-disk-rescue.sh`

Actions:

- model `/tmp`, `/var/tmp`, and `/dev/shm` executables as a distinct containment class
- include owning-unit temp hardening state in IOC details when VPSSentry can prove the unit
- quarantine evidence before deletion
- stop only the owning service when ownership is proven
- add service-specific noexec temp mounts when appropriate
- verify the process does not return, then rescan

Operational risk:

- killing the wrong process or adding a bad service drop-in can create downtime.
- the UI must keep analysis/dry-run separate from execution.

Exit criteria:

- runtime IOC containment is auditable and not confused with ordinary CPU pressure
- post-action dashboard state reflects the new scan, not the pre-action snapshot

Status:

- May 20, 2026 local / May 21, 2026 UTC: source/normalize fix completed for one high-ROI failure mode. VPSSentry now distinguishes declared noexec hardening from actually mounted noexec in the process namespace and reports `ineffective` when systemd config and live mount options diverge. Counterstrike now preserves `/proc/<pid>/exe` and `/proc/<pid>/mountinfo` before killing temp-exec candidates so deleted/private-temp payloads leave useful evidence.

### 5. Host-Side Alert Delivery

Broken layer: source/runtime state and notification delivery.

Files to inspect/edit:

- `../vps-sentry/deploy/usr-local/bin/vps-sentry-notify`
- `../vps-sentry/deploy/usr-local/bin/vps-sentry-service-event`
- `../vps-sentry/deploy/systemd/vps-sentry-unit-event@.service`
- `docs/vps-sentry-upgrade-plan.md`
- `docs/production-ops-runbook.md`

Actions:

- finish host-side notification so `vps-sentry-web` can page when the dashboard itself is down
- dedupe open incidents and send recovery messages
- wire critical service stop/failure events into host-side delivery
- add external sentinel once host-side paging is proven

Exit criteria:

- unexpected `vps-sentry-web.service` stop sends an alert from the host
- recovery sends a recovery alert
- planned maintenance suppresses paging
- full VPS outage has an off-box witness

### 6. Visual QA and Responsiveness

Broken layer: render and verification.

Files to inspect/edit:

- `src/app/globals.css`
- dashboard components under `src/app/dashboard/_components/`
- add visual smoke coverage when the repo has a browser harness

Actions:

- test desktop and mobile viewports for the dashboard, host detail, actions console, and admin panels
- remove layout shift caused by dynamic labels and badges
- tighten dense operational sections without burying severity signal
- avoid decorative surfaces that do not carry operator meaning

Exit criteria:

- no overlapping text or controls
- no status card changes size when live values update
- the critical path remains visible above secondary panels

### 7. Deploy, Sync, and Document Every Slice

Broken layer: promotion discipline.

Files to inspect/edit:

- `README.md`
- `../CURRENT_STATE.md`
- `../REPO_SYNC_MAP.md`
- `docs/high-roi-improvement-plan.md`

Actions:

- document what changed, which layer it touched, and what was verified
- commit and push before deploy
- deploy through `make release` or the documented guarded sequence
- run `../bin/sync-audit`
- record the deployed commit and smoke result

Exit criteria:

- MBP, GitHub, and VPS are synchronized
- production smoke passes
- the handoff doc points to the next highest-ROI slice

## Immediate Next Slices

1. Turn the proven guided dependency-tree relocation path into a first-class dashboard workflow with dry-run, typed confirmation, service stop/start, rescan, and rollback notes.
2. Add strict dashboard fixtures for healthy, stale, root-pressure, runtime-IOC, and post-containment states.
3. Promote temp-exec containment into a reusable VPSSentry workflow so evidence capture, unit-scoped noexec hardening, restart, and rescan are one auditable operator sequence.
4. Finish host-side alert delivery so `vps-sentry-web` is not required to report its own failure.
5. Add authenticated visual regression coverage for the dashboard command surface.

## Do Not Do Casually

- Do not delete guided dependency candidates through safe cleanup.
- Do not change severity colors without tracing the normalized status source.
- Do not claim a host issue is current from a screenshot alone.
- Do not move live data or dependency trees without a service plan and rollback path.
- Do not edit Traffic unless the VPSSentry -> Traffic boundary is confirmed.
