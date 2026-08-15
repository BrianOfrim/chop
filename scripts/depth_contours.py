#!/usr/bin/env python3
"""Marching-squares depth contours from Chop depth.bin (same rules as the old JS)."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np

EMPTY = {"type": "FeatureCollection", "features": []}


def contour_interval_m(max_depth_m: float) -> float:
    if max_depth_m <= 12:
        return 1.0
    if max_depth_m <= 25:
        return 2.0
    return 5.0


def _key(p: tuple[float, float]) -> tuple[float, float]:
    return (round(p[0], 6), round(p[1], 6))


def _stitch(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> list[list[list[float]]]:
    adj: dict[tuple[float, float], list[int]] = defaultdict(list)
    for i, (a, b) in enumerate(segments):
        adj[_key(a)].append(i)
        adj[_key(b)].append(i)
    used = [False] * len(segments)
    lines: list[list[list[float]]] = []

    def other(seg_i: int, pt: tuple[float, float]) -> tuple[float, float]:
        a, b = segments[seg_i]
        return b if _key(a) == _key(pt) else a

    for i, (a, b) in enumerate(segments):
        if used[i]:
            continue
        used[i] = True
        line = [a, b]
        for end_idx in (1, 0):
            while True:
                pt = line[end_idx]
                nxt = None
                for si in adj[_key(pt)]:
                    if used[si]:
                        continue
                    used[si] = True
                    nxt = other(si, pt)
                    break
                if nxt is None:
                    break
                if end_idx == 1:
                    line.append(nxt)
                else:
                    line.insert(0, nxt)
        if len(line) >= 2:
            lines.append([[p[0], p[1]] for p in line])
    return lines


def _lerp(
    a: tuple[float, float],
    va: float,
    b: tuple[float, float],
    vb: float,
    iso: float,
) -> tuple[float, float]:
    t = (iso - va) / (vb - va if vb != va else 1e-9)
    t = min(1.0, max(0.0, t))
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def depth_contours_geojson(
    depth: np.ndarray,
    west: float,
    south: float,
    east: float,
    north: float,
    nodata: float,
    interval_m: float,
) -> dict:
    nrows, ncols = depth.shape
    if interval_m <= 0 or ncols < 2 or nrows < 2:
        return dict(EMPTY)

    valid = (depth > nodata) & np.isfinite(depth)
    if not valid.any():
        return dict(EMPTY)
    z_max = float(depth[valid].max())
    levels = []
    z = interval_m
    while z < z_max - 0.05:
        levels.append(round(z, 2))
        z += interval_m
    if not levels:
        return dict(EMPTY)

    def lonlat(col: int, row: int) -> tuple[float, float]:
        lon = west + ((col + 0.5) / ncols) * (east - west)
        lat = north - ((row + 0.5) / nrows) * (north - south)
        return (lon, lat)

    features: list[dict] = []
    for iso in levels:
        segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for j in range(nrows - 1):
            for i in range(ncols - 1):
                tl, tr = float(depth[j, i]), float(depth[j, i + 1])
                bl, br = float(depth[j + 1, i]), float(depth[j + 1, i + 1])
                if not all(v > nodata and np.isfinite(v) for v in (tl, tr, bl, br)):
                    continue
                ptl, ptr = lonlat(i, j), lonlat(i + 1, j)
                pbl, pbr = lonlat(i, j + 1), lonlat(i + 1, j + 1)
                idx = (
                    (8 if tl >= iso else 0)
                    | (4 if tr >= iso else 0)
                    | (2 if br >= iso else 0)
                    | (1 if bl >= iso else 0)
                )
                if idx in (0, 15):
                    continue

                def top() -> tuple[float, float]:
                    return _lerp(ptl, tl, ptr, tr, iso)

                def right() -> tuple[float, float]:
                    return _lerp(ptr, tr, pbr, br, iso)

                def bottom() -> tuple[float, float]:
                    return _lerp(pbl, bl, pbr, br, iso)

                def left() -> tuple[float, float]:
                    return _lerp(ptl, tl, pbl, bl, iso)

                if idx in (1, 14):
                    segs.append((left(), bottom()))
                elif idx in (2, 13):
                    segs.append((bottom(), right()))
                elif idx in (3, 12):
                    segs.append((left(), right()))
                elif idx in (4, 11):
                    segs.append((top(), right()))
                elif idx in (6, 9):
                    segs.append((top(), bottom()))
                elif idx in (7, 8):
                    segs.append((left(), top()))
                elif idx == 5:
                    segs.append((left(), top()))
                    segs.append((bottom(), right()))
                elif idx == 10:
                    segs.append((left(), bottom()))
                    segs.append((top(), right()))

        major = (iso % (interval_m * 5) == 0) or (iso % 5 == 0)
        for coords in _stitch(segs):
            features.append(
                {
                    "type": "Feature",
                    "properties": {"depthM": iso, "major": major},
                    "geometry": {"type": "LineString", "coordinates": coords},
                }
            )
    return {"type": "FeatureCollection", "features": features}


def write_depth_contours(lake_dir: Path) -> float:
    """Read depth.bin + grid.json in lake_dir; write depth-contours.geojson. Return interval."""
    meta = json.loads((lake_dir / "grid.json").read_text())
    ncols, nrows = int(meta["ncols"]), int(meta["nrows"])
    nodata = float(meta["nodata"])
    depth = np.fromfile(lake_dir / "depth.bin", dtype=np.float32).reshape(nrows, ncols)
    valid = depth[depth > nodata]
    z_max = float(valid.max()) if valid.size else 0.0
    interval = contour_interval_m(z_max)
    fc = depth_contours_geojson(
        depth,
        float(meta["west"]),
        float(meta["south"]),
        float(meta["east"]),
        float(meta["north"]),
        nodata,
        interval,
    )
    (lake_dir / "depth-contours.geojson").write_text(
        json.dumps(fc, separators=(",", ":")) + "\n"
    )
    files = meta.setdefault("files", {})
    files["contours"] = "depth-contours.geojson"
    meta["contourIntervalM"] = interval
    (lake_dir / "grid.json").write_text(json.dumps(meta, indent=2) + "\n")
    return interval


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "data" / "lakes"
    for grid in sorted(root.glob("*/grid.json")):
        lake = grid.parent
        interval = write_depth_contours(lake)
        n = json.loads((lake / "depth-contours.geojson").read_text())
        print(f"{lake.name}: interval={interval:g} m  lines={len(n['features'])}")


if __name__ == "__main__":
    main()
