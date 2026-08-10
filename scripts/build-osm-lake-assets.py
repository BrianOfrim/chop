#!/usr/bin/env python3
"""Build Chop lake assets from an OSM Overpass JSON dump (relation or way).

Uses a synthetic distance-from-shore depth model when no DEM is available.

Example:
  .venv/bin/python scripts/build-osm-lake-assets.py \\
    --osm /tmp/gull_osm.json --osm-id 1927760 --osm-type relation \\
    --spot data/lakes/ca-ab-gull-lake/spot-profile.json \\
    --out data/lakes/ca-ab-gull-lake --cell-m 75 --max-depth 20
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
    from shapely.geometry import LineString, MultiPolygon, Polygon, mapping, shape
    from shapely.ops import linemerge, polygonize, unary_union
except ImportError as e:
    raise SystemExit(f"Need geopandas/shapely/pyproj: {e}") from e

N_DIRS = 16
DIRECTIONS = [i * (360 / N_DIRS) for i in range(N_DIRS)]


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
    max_steps = int(80000 / step)
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
            ic = int(round((xx - x0g) / cell_m))
            jr = int(round((y0g - yy) / cell_m))
            if ic < 0 or ic >= ncols or jr < 0 or jr >= nrows or not mask[jr, ic]:
                dist -= step
                break
        fetch[j, i] = max(dist, step)
    return fetch


def polygon_from_osm(data: dict, osm_id: int, osm_type: str) -> Polygon:
    ways: dict[int, list[tuple[float, float]]] = {}
    nodes: dict[int, tuple[float, float]] = {}
    for e in data["elements"]:
        if e["type"] == "node":
            nodes[e["id"]] = (e["lon"], e["lat"])
    for e in data["elements"]:
        if e["type"] != "way":
            continue
        if "geometry" in e:
            ways[e["id"]] = [(p["lon"], p["lat"]) for p in e["geometry"]]
        elif "nodes" in e:
            coords = [nodes[n] for n in e["nodes"] if n in nodes]
            if len(coords) >= 2:
                ways[e["id"]] = coords

    if osm_type == "way":
        if osm_id not in ways:
            raise SystemExit(f"Way {osm_id} not found / incomplete")
        coords = ways[osm_id]
        if coords[0] != coords[-1]:
            coords = coords + [coords[0]]
        return Polygon(coords)

    rel = next(
        (e for e in data["elements"] if e["type"] == "relation" and e["id"] == osm_id),
        None,
    )
    if rel is None:
        raise SystemExit(f"Relation {osm_id} not found")

    outer, inner = [], []
    for m in rel["members"]:
        if m["type"] != "way" or m["ref"] not in ways:
            continue
        ls = LineString(ways[m["ref"]])
        if m.get("role") == "inner":
            inner.append(ls)
        else:
            outer.append(ls)

    merged = linemerge(unary_union(outer))
    polys = list(polygonize(merged))
    if not polys:
        # fallback: try closed rings from individual ways
        for wid, coords in ways.items():
            if len(coords) >= 4 and coords[0] == coords[-1]:
                polys.append(Polygon(coords))
    if not polys:
        raise SystemExit(f"Could not polygonize relation {osm_id}")
    lake = max(polys, key=lambda p: p.area)
    if inner:
        holes = []
        for ls in inner:
            ring = list(ls.coords)
            if ring[0] != ring[-1]:
                ring = ring + [ring[0]]
            if len(ring) >= 4:
                holes.append(ring)
        if holes:
            lake = Polygon(lake.exterior.coords, holes)
    return lake


def synthetic_depth(
    x: np.ndarray,
    y: np.ndarray,
    mask: np.ndarray,
    lake: Polygon,
    max_depth: float,
    scale_m: float,
) -> np.ndarray:
    depth = np.full(x.shape, np.nan, dtype=np.float32)
    boundary = np.asarray(lake.exterior.coords)
    for ring in lake.interiors:
        boundary = np.vstack([boundary, np.asarray(ring.coords)])
    jj, ii = np.where(mask)
    for j, i in zip(jj, ii):
        dx = boundary[:, 0] - x[j, i]
        dy = boundary[:, 1] - y[j, i]
        dist = math.sqrt(float(np.min(dx * dx + dy * dy)))
        depth[j, i] = max(max_depth * (1.0 - math.exp(-dist / scale_m)), 0.5)
    return depth


def utm_epsg(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return 32600 + zone if lat >= 0 else 32700 + zone


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--osm", type=Path, required=True, help="Overpass JSON file")
    p.add_argument("--osm-id", type=int, required=True)
    p.add_argument("--osm-type", choices=["relation", "way"], required=True)
    p.add_argument("--spot", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--cell-m", type=float, default=75.0)
    p.add_argument("--max-depth", type=float, default=15.0)
    p.add_argument("--depth-scale-m", type=float, default=300.0)
    p.add_argument("--simplify-m", type=float, default=30.0)
    p.add_argument("--source-note", type=str, default="OpenStreetMap (ODbL)")
    args = p.parse_args()

    data = json.loads(args.osm.read_text())
    poly_ll = polygon_from_osm(data, args.osm_id, args.osm_type)
    epsg = utm_epsg(poly_ll.centroid.x, poly_ll.centroid.y)
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    to_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    ext = [to_utm.transform(x, y) for x, y in poly_ll.exterior.coords]
    holes = [
        [to_utm.transform(x, y) for x, y in ring.coords] for ring in poly_ll.interiors
    ]
    lake = Polygon(ext, holes)

    minx, miny, maxx, maxy = lake.bounds
    pad = args.cell_m * 2
    minx -= pad
    miny -= pad
    maxx += pad
    maxy += pad
    cell = args.cell_m

    # North-first rows (match ASC / pigeon assets)
    xs = np.arange(minx + cell / 2, maxx, cell)
    ys_asc = np.arange(miny + cell / 2, maxy, cell)  # south→north
    ys = ys_asc[::-1]  # north-first
    x, y = np.meshgrid(xs, ys)
    mask = contains_xy(lake, x.ravel(), y.ravel()).reshape(x.shape)
    if not mask.any():
        raise SystemExit("Empty water mask")

    depth = synthetic_depth(x, y, mask, lake, args.max_depth, args.depth_scale_m)
    print(f"EPSG:{epsg} cells={int(mask.sum())}/{mask.size} cell={cell}m")
    print(
        f"Depth m: min={np.nanmin(depth[mask]):.2f} max={np.nanmax(depth[mask]):.2f} "
        f"mean={np.nanmean(depth[mask]):.2f}"
    )

    fetch_stack = []
    for deg in DIRECTIONS:
        print(f"Fetch FROM {deg:.1f}° …")
        fetch_stack.append(compute_fetch(deg, mask, x, y, xs, ys, cell))
    fetch = np.stack(fetch_stack, axis=0).astype(np.float32)

    west_x, south_y = float(xs[0] - cell / 2), float(ys[-1] - cell / 2)
    east_x, north_y = float(xs[-1] + cell / 2), float(ys[0] + cell / 2)
    lon_sw, lat_sw = to_ll.transform(west_x, south_y)
    lon_se, lat_se = to_ll.transform(east_x, south_y)
    lon_nw, lat_nw = to_ll.transform(west_x, north_y)
    lon_ne, lat_ne = to_ll.transform(east_x, north_y)
    west, east = min(lon_sw, lon_nw), max(lon_se, lon_ne)
    south, north = min(lat_sw, lat_se), max(lat_nw, lat_ne)

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    # Shoreline GeoJSON (simplified in projected metres)
    gdf = gpd.GeoDataFrame(geometry=[lake], crs=f"EPSG:{epsg}")
    gdf["geometry"] = gdf.geometry.simplify(args.simplify_m, preserve_topology=True)
    gdf.to_crs(4326).to_file(out / "shoreline.geojson", driver="GeoJSON")

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
        "ncols": int(len(xs)),
        "nrows": int(len(ys)),
        "west": west,
        "south": south,
        "east": east,
        "north": north,
        "cellSizeM": cell,
        "nodata": -1.0,
        "nDirs": N_DIRS,
        "directionsDeg": DIRECTIONS,
        "crs": "EPSG:4326",
        "projectedCrs": f"EPSG:{epsg}",
        "source": {
            "shoreline": args.source_note,
            "bathymetry": f"synthetic distance-from-shore (max={args.max_depth}m)",
            "licence": "ODbL for OSM shoreline; synthetic bathymetry for chop",
            "osmType": args.osm_type,
            "osmId": args.osm_id,
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
    (out / "README.md").write_text(
        f"# {spot.get('identity', {}).get('name', out.name)}\n\n"
        f"Shoreline: {args.source_note} (`{args.osm_type}/{args.osm_id}`).\n"
        f"Depth: synthetic (max {args.max_depth} m).\n"
    )
    print(f"Wrote {out}")
    print(f"Bounds WGS84: W={west:.5f} S={south:.5f} E={east:.5f} N={north:.5f}")
    print(f"fetchMaxM={meta['stats']['fetchMaxM']:.0f}")


if __name__ == "__main__":
    main()
