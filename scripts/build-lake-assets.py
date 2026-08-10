#!/usr/bin/env python3
"""Build web-ready lake assets (shoreline, depth, 16-dir fetch) for Chop.

Example:
  python3 scripts/build-lake-assets.py \\
    --gis ~/Downloads/windsport-spots/pigeon-lake/gis \\
    --spot ~/Downloads/windsport-spots/pigeon-lake/spot-profile.json \\
    --out data/lakes/ca-ab-pigeon-lake \\
    --water-surface 847.6
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np

try:
    import geopandas as gpd
    from pyproj import Transformer
    from shapely import contains_xy
except ImportError as e:
    raise SystemExit(
        "Need geopandas and pyproj. Try:\n"
        "  python3 -m venv .venv && .venv/bin/pip install geopandas pyproj numpy\n"
        f"Missing: {e}"
    ) from e

G = 9.81
N_DIRS = 16
DIRECTIONS = [i * (360 / N_DIRS) for i in range(N_DIRS)]


def read_asc(path: Path) -> tuple[dict, np.ndarray]:
    header: dict[str, float] = {}
    with path.open() as f:
        for _ in range(6):
            key, val = f.readline().split()
            header[key.lower()] = float(val)
        data = np.loadtxt(f, dtype=np.float64)
    return header, data


def compute_fetch(
    wind_from_deg: float,
    mask: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
    cell_m: float,
) -> np.ndarray:
    rad = np.deg2rad(wind_from_deg)
    ux, uy = np.sin(rad), np.cos(rad)
    step = cell_m * 0.5
    max_steps = int(50000 / step)
    fetch = np.zeros_like(mask, dtype=np.float32)
    x0g, y0g = float(xs[0]), float(ys[0])
    ncols, nrows = len(xs), len(ys)

    for j, i in zip(*np.where(mask)):
        x0, y0 = float(x[j, i]), float(y[j, i])
        dist = 0.0
        for _ in range(max_steps):
            dist += step
            xx = x0 + ux * dist
            yy = y0 + uy * dist
            # Rows are north-first (ASC order): j increases as y decreases.
            ic = int(round((xx - x0g) / cell_m))
            jr = int(round((y0g - yy) / cell_m))
            if ic < 0 or ic >= ncols or jr < 0 or jr >= nrows or not mask[jr, ic]:
                dist -= step
                break
        fetch[j, i] = max(dist, step)
    return fetch


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--gis", type=Path, required=True, help="Pigeon GIS folder (boundary + bathy_dem)")
    p.add_argument("--spot", type=Path, required=True, help="spot-profile.json")
    p.add_argument("--out", type=Path, required=True, help="Output lake folder")
    p.add_argument("--water-surface", type=float, default=847.6, help="Water surface elev (m asl)")
    p.add_argument("--simplify-m", type=float, default=25.0, help="Shoreline simplify tolerance (m)")
    args = p.parse_args()

    gis: Path = args.gis
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    shp = gis / "boundary" / "pige_bdy_py_tm.shp"
    dem_path = gis / "bathy_dem" / "pige_dem_tm.asc"
    if not shp.exists() or not dem_path.exists():
        raise SystemExit(f"Expected {shp} and {dem_path}")

    header, bed = read_asc(dem_path)
    ncols = int(header["ncols"])
    nrows = int(header["nrows"])
    cell = float(header["cellsize"])
    xll = float(header["xllcorner"])
    yll = float(header["yllcorner"])
    nodata_dem = float(header["nodata_value"])

    # ASC: first row is north
    xs = xll + cell * (np.arange(ncols) + 0.5)
    ys = yll + cell * (np.arange(nrows)[::-1] + 0.5)
    x, y = np.meshgrid(xs, ys)

    lake = gpd.read_file(shp)
    if lake.crs is None:
        # AGS Pigeon products are typically 10TM AEP Forest (EPSG:3400)
        lake = lake.set_crs(3400)
    src_crs = lake.crs
    lake_geom = lake.union_all()
    mask = contains_xy(lake_geom, x.ravel(), y.ravel()).reshape(x.shape)

    depth = np.full(bed.shape, np.nan, dtype=np.float32)
    valid_bed = (bed != nodata_dem) & mask
    depth[valid_bed] = np.maximum(args.water_surface - bed[valid_bed], 0.2).astype(
        np.float32
    )
    # If DEM missing inside polygon, fall back to mean depth of valid cells
    if np.any(mask & ~valid_bed):
        fill = float(np.nanmean(depth[valid_bed])) if np.any(valid_bed) else 6.0
        depth[mask & ~valid_bed] = fill

    print(f"Water cells: {int(mask.sum())} / {mask.size}")
    print(
        f"Depth m: min={np.nanmin(depth[mask]):.2f} max={np.nanmax(depth[mask]):.2f} "
        f"mean={np.nanmean(depth[mask]):.2f}"
    )

    fetch_stack = []
    for deg in DIRECTIONS:
        print(f"Fetch FROM {deg:.1f}° …")
        fetch_stack.append(compute_fetch(deg, mask, x, y, xs, ys, cell))
    fetch = np.stack(fetch_stack, axis=0).astype(np.float32)  # (16, nrows, ncols)

    to_ll = Transformer.from_crs(src_crs, "EPSG:4326", always_xy=True)
    west_x, south_y = xll, yll
    east_x, north_y = xll + ncols * cell, yll + nrows * cell
    # corners to lon/lat
    lon_sw, lat_sw = to_ll.transform(west_x, south_y)
    lon_se, lat_se = to_ll.transform(east_x, south_y)
    lon_nw, lat_nw = to_ll.transform(west_x, north_y)
    lon_ne, lat_ne = to_ll.transform(east_x, north_y)
    west = min(lon_sw, lon_nw)
    east = max(lon_se, lon_ne)
    south = min(lat_sw, lat_se)
    north = max(lat_nw, lat_ne)

    # Shoreline in WGS84, simplified
    lake_ll = lake.to_crs(4326)
    lake_ll_simpl = lake_ll.copy()
    # simplify in projected meters then reproject
    lake_m = lake.to_crs(src_crs)
    lake_m["geometry"] = lake_m.geometry.simplify(args.simplify_m, preserve_topology=True)
    lake_ll_simpl = lake_m.to_crs(4326)
    shore_path = out / "shoreline.geojson"
    lake_ll_simpl.to_file(shore_path, driver="GeoJSON")

    # Ride points as geojson from spot profile
    spot = json.loads(Path(args.spot).read_text())
    spot_dst = out / "spot-profile.json"
    if Path(args.spot).resolve() != spot_dst.resolve():
        shutil.copy(args.spot, spot_dst)

    depth_out = depth.copy()
    depth_out[~mask] = np.float32(-1.0)
    depth_out.tofile(out / "depth.bin")
    fetch.tofile(out / "fetch_16dir.bin")

    meta = {
        "spotId": spot.get("spotId", out.name),
        "ncols": ncols,
        "nrows": nrows,
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "cellSizeM": cell,
        "nodata": -1.0,
        "nDirs": N_DIRS,
        "directionsDeg": DIRECTIONS,
        "waterSurfaceM": args.water_surface,
        "crs": "EPSG:4326",
        "projectedCrs": str(src_crs),
        "source": {
            "shoreline": "AGS DIG 2008-0828",
            "bathymetry_dem": "AGS DIG 2008-0490 (50 m Arc ASCII)",
            "licence": "Open Government Licence - Alberta",
        },
        "files": {
            "depth": "depth.bin",
            "fetch": "fetch_16dir.bin",
            "shoreline": "shoreline.geojson",
            "spot": "spot-profile.json",
        },
        "stats": {
            "waterCells": int(mask.sum()),
            "depthMinM": float(np.nanmin(depth[mask])),
            "depthMaxM": float(np.nanmax(depth[mask])),
            "depthMeanM": float(np.nanmean(depth[mask])),
            "fetchMaxM": float(fetch[:, mask].max()),
        },
    }
    (out / "grid.json").write_text(json.dumps(meta, indent=2) + "\n")

    # Lakes index stub fragment
    print(f"Wrote {out}")
    print(f"Bounds WGS84: W={west:.5f} S={south:.5f} E={east:.5f} N={north:.5f}")


if __name__ == "__main__":
    main()
