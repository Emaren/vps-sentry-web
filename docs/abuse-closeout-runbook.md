# Abuse Closeout Runbook

Use this when a provider abuse ticket is open and you must submit remediation proof quickly.

## Objective

Produce a clean, repeatable closeout packet and submit a human-authored statement before deadline.

## Preconditions

- Incident is already contained on VPS.
- Latest evidence capture exists under `~/projects/VPSSentry/context`.
- You can SSH to VPS and run wrapper commands from MBP.

## One-Shot Flow

1. Run local preflight:

```bash
~/projects/VPSSentry/bin/dev-doctor
```

2. Confirm repo + deployment sync:

```bash
~/projects/VPSSentry/bin/sync-audit
```

3. Generate fresh context and clean artifacts:

```bash
~/projects/VPSSentry/bin/full-context
~/projects/VPSSentry/bin/context-hygiene --apply
```

4. Build closeout packet from latest evidence:

```bash
~/projects/VPSSentry/bin/abuse-closeout --abuse-id <ABUSE_ID>
```

5. On VPS, verify evidence-chain integrity:

```bash
sudo vps-sentry-evidence-verify
```

6. Submit provider statement manually:

- Request recheck in provider portal.
- Use your own words (do not paste machine-generated statement).
- Include cause, remediation, and validation.
- Attach latest evidence file from the generated closeout packet.

## Hard Gates (Do Not Submit If Any Fail)

- `sync-audit` result is not `PASS`.
- Latest evidence file is empty (`0 bytes`).
- `vps-sentry-evidence-verify` fails.
- Unexpected public listener remains open without explicit decision.

## Output Artifacts

- Packet dir: `~/projects/VPSSentry/context/abuse-closeout-<id>-<timestamp>/`
- Checklist: `submission-checklist.md`
- Attachments index: `attachments.txt`
- Local evidence source: `hetzner-*-evidence-*.txt`

