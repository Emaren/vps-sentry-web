#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SNAPSHOT_RE = re.compile(r"^(?P<stamp>\d{8}T\d{6}Z)(?:-|$)")


@dataclass(frozen=True)
class Snapshot:
    path: Path
    created_at: datetime


def parse_snapshot(path: Path) -> Snapshot | None:
    match = SNAPSHOT_RE.match(path.name)
    if not match or not path.is_dir() or path.is_symlink():
        return None
    try:
        created_at = datetime.strptime(
            match.group("stamp"), "%Y%m%dT%H%M%SZ"
        ).replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return Snapshot(path=path, created_at=created_at)


def retention_plan(
    root: Path,
    *,
    hourly_keep: int,
    keep_days: int,
    now: datetime,
) -> dict[str, list[Snapshot]]:
    if hourly_keep < 1:
        raise ValueError("hourly_keep must be >= 1")
    if keep_days < 1:
        raise ValueError("keep_days must be >= 1")
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")

    snapshots = []
    for child in root.iterdir():
        parsed = parse_snapshot(child)
        if parsed is not None:
            snapshots.append(parsed)
    snapshots.sort(key=lambda item: item.created_at, reverse=True)

    keep: list[Snapshot] = []
    prune: list[Snapshot] = []
    daily_days: set[str] = set()

    for index, snapshot in enumerate(snapshots):
        if index < hourly_keep:
            keep.append(snapshot)
            continue

        age_seconds = max(0.0, (now - snapshot.created_at).total_seconds())
        if age_seconds > keep_days * 86400:
            prune.append(snapshot)
            continue

        day = snapshot.created_at.strftime("%Y%m%d")
        if day not in daily_days:
            daily_days.add(day)
            keep.append(snapshot)
        else:
            prune.append(snapshot)

    return {"keep": keep, "prune": prune}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--hourly-keep", type=int, default=48)
    parser.add_argument("--keep-days", type=int, default=14)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--now", help=argparse.SUPPRESS)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        raise SystemExit(f"backup root is not a directory: {root}")

    now = (
        datetime.fromisoformat(args.now.replace("Z", "+00:00"))
        if args.now
        else datetime.now(timezone.utc)
    )
    plan = retention_plan(
        root,
        hourly_keep=args.hourly_keep,
        keep_days=args.keep_days,
        now=now,
    )

    prune_bytes = 0
    for snapshot in plan["prune"]:
        for base, _, files in os.walk(snapshot.path):
            for name in files:
                try:
                    prune_bytes += (Path(base) / name).stat().st_size
                except FileNotFoundError:
                    pass

    print(
        "[backup-retention] plan:" + json.dumps(
            {
                "root": str(root),
                "hourly_keep": args.hourly_keep,
                "keep_days": args.keep_days,
                "keep_count": len(plan["keep"]),
                "prune_count": len(plan["prune"]),
                "estimated_prune_bytes": prune_bytes,
                "mode": "apply" if args.apply else "preview",
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )

    if args.apply:
        for snapshot in plan["prune"]:
            resolved = snapshot.path.resolve()
            try:
                resolved.relative_to(root)
            except ValueError as exc:
                raise SystemExit(
                    f"refusing path outside backup root: {resolved}"
                ) from exc
            if resolved.parent != root:
                raise SystemExit(
                    f"refusing non-generation path: {resolved}"
                )
            shutil.rmtree(resolved)
            print(f"[backup-retention] pruned:{resolved}")
    else:
        for snapshot in plan["prune"]:
            print(f"[backup-retention] would_prune:{snapshot.path}")

    print("[backup-retention] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
