#!/usr/bin/env python3
"""Patch existing lake grid.json files with per-direction max-fetch stats."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_dir_stats import patch_grid_json


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    index_path = root / "data" / "lakes" / "index.json"
    index = json.loads(index_path.read_text())
    lakes = index.get("lakes", [])
    n_ok = 0
    for lake in lakes:
        lake_id = lake.get("id")
        if not lake_id:
            continue
        lake_dir = root / "data" / "lakes" / lake_id
        print(f"Patching {lake_id} …")
        if patch_grid_json(lake_dir):
            n_ok += 1
        else:
            print("  skipped (missing assets)")
    print(f"Updated {n_ok} / {len(lakes)} lakes")


if __name__ == "__main__":
    main()
