from __future__ import annotations

import importlib.util
import tempfile
import unittest
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "vps-backup-retention.py"
SPEC = importlib.util.spec_from_file_location("vps_backup_retention", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class BackupRetentionTests(unittest.TestCase):
    def test_keeps_newest_48_then_one_daily_within_14_days(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            now = datetime(2026, 9, 3, tzinfo=timezone.utc)
            for hours_ago in range(15 * 24):
                stamp = now - timedelta(hours=hours_ago)
                (root / stamp.strftime("%Y%m%dT%H%M%SZ")).mkdir()

            plan = MODULE.retention_plan(
                root,
                hourly_keep=48,
                keep_days=14,
                now=now,
            )

            kept = plan["keep"]
            pruned = plan["prune"]
            self.assertEqual(len(kept) + len(pruned), 15 * 24)
            self.assertEqual(
                [item.created_at for item in kept[:48]],
                sorted(
                    [item.created_at for item in kept[:48]],
                    reverse=True,
                ),
            )

            older_kept = kept[48:]
            days = [item.created_at.strftime("%Y%m%d") for item in older_kept]
            self.assertEqual(len(days), len(set(days)))
            self.assertTrue(
                all((now - item.created_at).total_seconds() <= 14 * 86400 for item in older_kept)
            )
            self.assertTrue(
                all((now - item.created_at).total_seconds() > 47 * 3600 for item in older_kept)
            )

    def test_ignores_noncanonical_directories_and_symlinks(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "not-a-snapshot").mkdir()
            target = root / "20260903T000000Z"
            target.mkdir()
            (root / "20260902T230000Z-link").symlink_to(target, target_is_directory=True)

            plan = MODULE.retention_plan(
                root,
                hourly_keep=48,
                keep_days=14,
                now=datetime(2026, 9, 3, tzinfo=timezone.utc),
            )
            self.assertEqual([item.path for item in plan["keep"]], [target])
            self.assertEqual(plan["prune"], [])

    def test_old_snapshots_are_pruned_after_daily_horizon(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            now = datetime(2026, 9, 3, tzinfo=timezone.utc)
            recent = root / (now - timedelta(hours=1)).strftime("%Y%m%dT%H%M%SZ")
            old = root / (now - timedelta(days=20)).strftime("%Y%m%dT%H%M%SZ")
            recent.mkdir(); old.mkdir()
            plan = MODULE.retention_plan(root, hourly_keep=1, keep_days=14, now=now)
            self.assertEqual([item.path for item in plan["keep"]], [recent])
            self.assertEqual([item.path for item in plan["prune"]], [old])


if __name__ == "__main__":
    unittest.main()
