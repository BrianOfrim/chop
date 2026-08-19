"""Per-direction max-fetch stats for Chop lake grids.

Used by lake builders and the one-shot patcher so compare ranking can estimate
lake-max Hs without loading full depth/fetch binaries in the browser.

For each wind-direction bin we store fetch and depth at the water cell that
maximizes depth-capped SMB Hs at a 10 m/s reference wind. That is a better
proxy for lake-max chop than the raw longest-fetch cell, which is often a
shallow shoreline pixel.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

NODATA = -1.0
G = 9.81
# Same representative open-water wind used to pick the per-dir cell.
U_REF_MPS = 10.0


def smb_hs_depth_limited(u_mps: float, fetch_m: np.ndarray, depth_m: np.ndarray) -> np.ndarray:
    u = float(u_mps)
    fetch = np.maximum(fetch_m.astype(np.float64), 1.0)
    depth = np.maximum(depth_m.astype(np.float64), 0.5)
    dim = (G * fetch) / (u * u)
    hs = 0.283 * ((u * u) / G) * np.tanh(0.0125 * np.power(dim, 0.42))
    hs = np.where((u > 0) & (fetch_m > 0), hs, 0.0)
    return np.minimum(hs, 0.4 * depth)


def fetch_dir_max_stats(
    depth: np.ndarray,
    fetch: np.ndarray,
    mask: np.ndarray | None = None,
    nodata: float = NODATA,
) -> tuple[list[float], list[float]]:
    """Return (fetchMaxByDirM, depthAtFetchMaxByDirM) for each fetch band.

    For each direction, pick the water cell that maximizes depth-capped SMB Hs
    at 10 m/s, then store that cell's fetch and depth.

    depth: (nrows, ncols)
    fetch: (nDirs, nrows, ncols)
    mask: water cells; default is finite depth > 0 and not nodata
    """
    if mask is None:
        mask = np.isfinite(depth) & (depth != nodata) & (depth > 0)
    n_dirs = int(fetch.shape[0])
    fetch_max: list[float] = []
    depth_at: list[float] = []
    depth_flat = depth.ravel()
    for d in range(n_dirs):
        band = fetch[d]
        hs = np.where(mask, smb_hs_depth_limited(U_REF_MPS, band, depth), -np.inf)
        flat = int(np.argmax(hs))
        if not np.isfinite(hs.ravel()[flat]):
            fetch_max.append(0.0)
            depth_at.append(0.0)
            continue
        fetch_max.append(float(band.ravel()[flat]))
        depth_at.append(float(depth_flat[flat]))
    return fetch_max, depth_at


def patch_grid_json(lake_dir: Path) -> bool:
    """Add fetchMaxByDirM / depthAtFetchMaxByDirM to an existing grid.json.

    Returns True when stats were written (or already present and refreshed).
    """
    grid_path = lake_dir / "grid.json"
    depth_path = lake_dir / "depth.bin"
    fetch_path = lake_dir / "fetch_16dir.bin"
    if not grid_path.is_file() or not depth_path.is_file() or not fetch_path.is_file():
        return False
    meta = json.loads(grid_path.read_text())
    ncols = int(meta["ncols"])
    nrows = int(meta["nrows"])
    n_dirs = int(meta.get("nDirs", 16))
    nodata = float(meta.get("nodata", NODATA))
    depth = np.fromfile(depth_path, dtype=np.float32)
    fetch = np.fromfile(fetch_path, dtype=np.float32)
    n = ncols * nrows
    if depth.size != n:
        raise ValueError(f"{lake_dir}: depth.bin length {depth.size} != {n}")
    if fetch.size != n_dirs * n:
        raise ValueError(
            f"{lake_dir}: fetch_16dir.bin length {fetch.size} != {n_dirs * n}"
        )
    depth = depth.reshape(nrows, ncols)
    fetch = fetch.reshape(n_dirs, nrows, ncols)
    fetch_max, depth_at = fetch_dir_max_stats(depth, fetch, nodata=nodata)
    stats = meta.setdefault("stats", {})
    stats["fetchMaxByDirM"] = fetch_max
    stats["depthAtFetchMaxByDirM"] = depth_at
    grid_path.write_text(json.dumps(meta, indent=2) + "\n")
    return True
