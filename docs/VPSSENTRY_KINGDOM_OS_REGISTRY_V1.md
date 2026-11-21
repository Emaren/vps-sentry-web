# VPSSentry OS Registry · Kingdom infrastructure adapter v1

**Status:** Source-only candidate. **Owner:** VPSSentry (HEL1 observations), WE1 security oversight. **Consumer:** AoE2WAR Kingdom/Storage OS. **Version:** `aoe2war.vpssentry.kingdom-fleet.v1`. **Date:** November 21, 2026.

## Fixed service ownership

| Scope | Existing owner | Production boundary |
| --- | --- | --- |
| HEL1 root, mounted volume, CPU, RAM, public listeners, current source alerts | VPSSentry host agent | `vps-sentry.service` triggered by existing `vps-sentry.timer`; original root-owned `/var/lib/vps-sentry/public/status.json` |
| Dashboard and read-only API | `vps-sentry-web.service` | Existing Next.js app; no new runtime, listener or login |
| Incident/ops queue, audit and notifications | Existing `vps-sentry-ops-worker.service` | Existing RBAC and incident/remediation APIs |
| M1 source measurements | Existing VPSSentry Mac Storage Pulse | Existing owner-M1 local receipts; no new timer |
| Intel cold measurements | Existing VPSSentry Intel source observer | Source signing/WE2 verification and anti-replay admission distinct; no inferred live reading |
| Classifications, retention and teaching | AoE2WAR Storage OS | VPSSentry may observe, cannot independently decide deletion |
| Release/retirement executor | WE2 Factory | Independent source-bound owner approval and T10 gates |
| Scheduled cleanup | Housekeeping OS | VPSSentry must not introduce a second scheduler |
| Chain, finance and custody | WE1 seven gates | HOLD; no new writer, endpoint or key |

## Adapter route and existing identity

`GET /api/ops/kingdom-os/fleet`: **read-only**, bounded JSON, authenticated using the *existing* VPSSentry `requireOpsAccess` RBAC (ops/owner; no new identity provider). `Cache-Control: private, no-store`. Unauthorized requests return 401/403. No caller-selected paths, no POST, no deletions, no background work and no financial authority. For Kingdom-to-Kingdom automatic consumption, only an **already approved authenticated server-to-server channel or signed source bridge** may be wired; this PR does **not** invent a service credential or claim that cross-app authentication already works.

`src/lib/kingdom-os/reader.ts` opens **one fixed** host-agent status path as a regular root-owned, non-symlink file, checks source size and file mode, and hashes its actual bytes before projection. The DTO contains source identity, content digest, scope, producer, original timestamp, inspection timestamp, TTL, coverage, freshness and explicit missing states. No raw filesystem dump or arbitrary `systemctl` commands are exposed.

`src/lib/kingdom-os/fleet.ts` scopes reclaim bytes by actual pathname/mount:

- `/var/...` candidates count against HEL1 root *guided-review* inventory only.
- `/mnt/HC_Volume_105319120/...` candidates count against the mounted-volume guided inventory only.
- Unclassified candidates remain `unknown`, **never assumed root-reclaimable**.
- `safeNowBytes` stays independent of guided. Safe Now = 0 is valid even when guided inventory is nonzero. A guided `execute_command=guided_review` is a review label, **not** an executable cleanup instruction.

The dashboard adds illuminated M1 and Intel tiles alongside the HEL1 planes. Without signed and independently admitted observations, their measured bytes remain **null** and status **UNVERIFIED**; source outage is never translated into a fake zero-capacity or claimed live machine. A machine physically offline but not provably observed is not claimed OFFLINE by reachability inference. The link goes to the existing https://aoe2war.com/admin/storage-os/explorer; production bridge admission is still pending.

## Alert reconciliation and port treatment

Canonical HEL1 `status.json` observed November 21, 2026 at 19:29 UTC has one `host_disk_critical` alert at 92.9% used. An earlier screenshot showing six and a later snapshot showing one does **not** prove five repairs. The canonical `last.json` now also contains one and `diff.json={}` at this observation; no independently qualified six-to-one transition ledger was produced. Incident IDs/timestamps must come from the existing incident ledger, not synthetic closures; current source-alert IDs are stable `code:path` identifiers with `DETECTED` only, not new authoritative incident records.

Two observed publicly bound listeners: `tcp:27656` (`wolochaind-main`, peer network) and `udp:68` (`systemd-networkd`, DHCP client). Both are **allowlisted** in original VPSSentry policy, with zero unexpected listeners. Listening is not proof of firewall reachability; no allowlist, firewall or exposure thresholds are changed.

Agent snapshot timestamp, storage census `measured_at` (TTL 3600 s), guided catalog `measured_at` (TTL 600 s), and original baseline acceptance time have **different meanings**. Do not relabel baseline acceptance as initial baseline creation. Source drift and systemd service/timer failure counts not present in this source remain `null` rather than fabricated green numbers.

## Repair lifecycle — reuse existing controls

The Kingdom display contract tracks:
`DETECTED → DIAGNOSED → PREVIEWED → REPAIRED | OWNER_ACTION_REQUIRED → VERIFIED`.

**This branch does not launch a second autonomous worker.** The existing ops incident engine, queue policies, idempotency and audit log own any real remediation. Future source-qualified action adapters must restrict automatic execution to individual reversible, preapproved operations (example: refresh the existing `vps-sentry.service` snapshot) and record exact before/after snapshot SHA, timestamps, service result and incident ID. Reject simultaneous or duplicate retries, financial/chain unit changes, automatic root cleanup, generic sudo, unexplained port changes, or inferred success from a refreshed alert count.

**Physical safe-refresh evidence, November 21, 2026 UTC:** The already-authorized single `sudo -n /usr/bin/systemctl start vps-sentry.service` refresh was performed once. Before snapshot: `2026-11-21T19:34:40.928253+00:00` SHA256 `ce477bc58a711e39ef39cdc1322eff5ed35fc0cdaa4a34e57b79670ecd1d5a28`; after: `2026-11-21T19:36:56.371688+00:00` SHA256 `46edc764c1035ef83a700ac79735c5220fde9696d871356e3bc0b86e3639faff`. Service exit 0, original root-pressure alert remains 1/1, public listeners remain 2/2. This proves **snapshot refresh**, not disk repair. No new timer, cleanup or port mutation.

## Acceptance / rollback

Source-only tests: healthy versus stale timestamp, missing M1/Intel signed admission, root/volume accounting, safe-now versus guided, public-listener allowlist, invalid filesystem bytes, invalid source owner/mode, and unauthorized API denial. **Not yet production accepted:** automatic Kingdom OS credential/channel, M1 or Intel signed projection adoption, systemd/timer/failure/drift source coverage, full incident lifecycle transport/repair, new dashboard BUILD_ID/rollback or genuine cross-app event delivery.

Production rollout requires exact PR/CI, independent app source/build and root-source checks, existing web deployment procedure, owner acceptance, and original dashboard appearance/security regression. Rollback is the **existing vps-sentry-web release/rollback procedure**, not a new daemon. The currently live web build and already accepted AoE2WAR Explorer #1438 are not modified by this source branch.

**No current deletion authority, financial activation, automatic incident repair or owner signing role is granted by this registry entry.**
