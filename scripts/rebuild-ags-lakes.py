#!/usr/bin/env python3
"""Download AGS DEMs for Chop lakes that have them and rebuild depth/fetch grids."""

from __future__ import annotations

import subprocess
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "ags-cache"
PY = ROOT / ".venv" / "bin" / "python"
BUILDER = ROOT / "scripts" / "build-lake-assets.py"
ZIP_URL = "https://static.ags.aer.ca/files/document/DIG/DIG_2008_{id}.zip"

# Abraham Lake is a reservoir and is not in the AGS 2008 series.
LAKES = [
    {
        "id": "ca-ab-gull-lake",
        "dem": "0434",
        "boundary": "0772",
        "contours": "0603",
        "shore": "AGS DIG 2008-0772",
        "dem_label": "AGS DIG 2008-0434 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-sylvan-lake",
        "dem": "0515",
        "boundary": "0853",
        "contours": "0684",
        "shore": "AGS DIG 2008-0853",
        "dem_label": "AGS DIG 2008-0515 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-keho-lake",
        "dem": "0450",
        "boundary": "0788",
        "contours": "0619",
        "shore": "AGS DIG 2008-0788",
        "dem_label": "AGS DIG 2008-0450 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-buffalo-lake",
        "dem": "0387",
        "boundary": "0725",
        "contours": "0556",
        "shore": "AGS DIG 2008-0725",
        "dem_label": "AGS DIG 2008-0387 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-wabamun-lake",
        "dem": "0525",
        "boundary": "0863",
        "contours": "0694",
        "shore": "AGS DIG 2008-0863",
        "dem_label": "AGS DIG 2008-0525 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-cooking-lake",
        "dem": "0404",
        "boundary": "0742",
        "contours": "0573",
        "shore": "AGS DIG 2008-0742",
        "dem_label": "AGS DIG 2008-0404 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-wizard-lake",
        "dem": "0533",
        "boundary": "0871",
        "contours": "0702",
        "shore": "AGS DIG 2008-0871",
        "dem_label": "AGS DIG 2008-0533 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-coal-lake",
        "dem": "0402",
        "boundary": "0740",
        "contours": "0571",
        "shore": "AGS DIG 2008-0740",
        "dem_label": "AGS DIG 2008-0402 (50 m Arc ASCII)",
    },
    # Driedmeat Lake is not in the AGS 2008 series.
    # Build from OSM: scripts/build-osm-lake-assets.py --osm-id 1362845
    {
        "id": "ca-ab-lac-ste-anne",
        "dem": "0368",
        "boundary": "0706",
        "contours": "0537",
        "shore": "AGS DIG 2008-0706",
        "dem_label": "AGS DIG 2008-0368 (50 m Arc ASCII)",
    },
    # Ghost Reservoir (Cochrane) is not the AGS “Ghost Lake” pond (DIG 2008-0423).
    # Build from OSM: scripts/build-osm-lake-assets.py --osm-id 17639759
    {
        "id": "ca-ab-chestermere-lake",
        "dem": "0396",
        "boundary": "0734",
        "contours": "0565",
        "shore": "AGS DIG 2008-0734",
        "dem_label": "AGS DIG 2008-0396 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-chin-lakes",
        "dem": "0399",
        "boundary": "0737",
        "contours": "0568",
        "shore": "AGS DIG 2008-0737",
        "dem_label": "AGS DIG 2008-0399 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-lesser-slave-lake",
        "dem": "0455",
        "boundary": "0793",
        "contours": "0624",
        "shore": "AGS DIG 2008-0793",
        "dem_label": "AGS DIG 2008-0455 (50 m Arc ASCII)",
    },
    {
        "id": "ca-ab-upper-kananaskis-lake",
        "dem": "0520",
        "boundary": "0858",
        "contours": "0689",
        "shore": "AGS DIG 2008-0858",
        "dem_label": "AGS DIG 2008-0520 (50 m Arc ASCII)",
    },
]


def unzip_dig(dig_id: str) -> Path:
    dest = CACHE / f"DIG_2008_{dig_id}"
    zpath = CACHE / f"DIG_2008_{dig_id}.zip"
    CACHE.mkdir(parents=True, exist_ok=True)
    if not zpath.exists():
        url = ZIP_URL.format(id=dig_id)
        print(f"Download {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "chop-lake-builder"})
        with urllib.request.urlopen(req) as resp, zpath.open("wb") as out:
            out.write(resp.read())
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zpath) as zf:
        zf.extractall(dest)
    return dest


def first(folder: Path, pattern: str) -> Path:
    matches = sorted(folder.glob(pattern))
    if not matches:
        raise SystemExit(f"No {pattern} in {folder}")
    return matches[0]


def main() -> None:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", nargs="*", help="Spot ids to build (default: all)")
    args = p.parse_args()
    lakes = LAKES
    if args.only:
        want = set(args.only)
        lakes = [x for x in LAKES if x["id"] in want]
        missing = want - {x["id"] for x in lakes}
        if missing:
            raise SystemExit(f"Unknown lake ids: {sorted(missing)}")
    for lake in lakes:
        dem_dir = unzip_dig(lake["dem"])
        bdy_dir = unzip_dig(lake["boundary"])
        con_dir = unzip_dig(lake["contours"])
        out = ROOT / "data" / "lakes" / lake["id"]
        cmd = [
            str(PY),
            str(BUILDER),
            "--boundary",
            str(first(bdy_dir, "*_bdy_py_tm.shp")),
            "--dem",
            str(first(dem_dir, "*_dem_tm.asc")),
            "--contours",
            str(first(con_dir, "*_bcon_ln_tm.shp")),
            "--spot",
            str(out / "spot-profile.json"),
            "--out",
            str(out),
            "--source-shoreline",
            lake["shore"],
            "--source-dem",
            lake["dem_label"],
        ]
        print(" ".join(cmd))
        subprocess.check_call(cmd)


if __name__ == "__main__":
    main()
