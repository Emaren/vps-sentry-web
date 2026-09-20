# VPSSentry Backup Retention Policy

## Purpose

The hourly backup producer owns retention. Operators should not need periodic manual cleanup to keep `/home/tony/_backup/vps-sentry-web` bounded.

The backup root may be a symlink to `/mnt/HC_Volume_105319120/root-archive/vps-sentry-web-backups`; retention must resolve the symlink before classifying snapshot directories.

## Tiered policy

Default policy:

- keep the newest **48 snapshots** at hourly fidelity;
- for older snapshots, keep the newest **one snapshot per UTC calendar day**;
- keep daily history only through **14 days** by default;
- ignore non-canonical directories and symlinks instead of deleting them;
- never prune outside the resolved backup root.

Configuration:

```text
VPS_BACKUP_HOURLY_KEEP=48
VPS_BACKUP_KEEP_DAYS=14
```

`VPS_BACKUP_KEEP_DAYS` is the daily-history horizon, not a request to retain every hourly generation for that many days.

## September 3, 2026 incident lesson

The previous producer used only an age threshold. An hourly cron plus a 14-day age threshold naturally accumulated roughly 336 hourly snapshots; the production spring clean found 341 generations. Manual cleanup reduced the estate to the intended shape, but the durable fix is producer-level tiering.

`scripts/vps-backup-retention.py` is now the retention authority used by `scripts/vps-backup.sh`. Its policy is regression-tested by `tests/test_vps_backup_retention.py`, and the release gate runs that test plus `bash -n scripts/vps-backup.sh`.

## Safety contract

Retention acts only on ordinary directories whose names begin with the canonical UTC snapshot timestamp format `YYYYMMDDTHHMMSSZ`. It does not follow snapshot symlinks, does not touch marker/history files, and refuses deletion when a resolved candidate is not an immediate child of the resolved backup root.

This is a retention policy for VPSSentry web backups only. It does not authorize deletion of AoE2WAR database snapshots, parser jobs, WoloChain state, replay evidence, Traffic history, or unrelated archives.
