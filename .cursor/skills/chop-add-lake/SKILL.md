---
name: chop-add-lake
description: >-
  Adds an inland lake to Chop: spot profile, shoreline/depth/fetch assets,
  index.json registration, and a picker/outline smoke check. Use when the user
  asks to add a lake, onboard a new spot, or enable a waterbody in the map
  picker.
---

# Add a lake to Chop

Do not invent bathymetry when an AGS 2008 DEM exists. Do not edit MapLibre layers for outlines — they load from the index. `apps/web/public/lakes` is a **symlink** to `data/lakes`; write only under `data/lakes/`.

Copy this checklist:

```
- [ ] Id, source, and pipeline chosen
- [ ] spot-profile.json written
- [ ] Assets built (shoreline, depth, fetch, contours, grid, README)
- [ ] Registered in data/lakes/index.json (enabled: true)
- [ ] Picker + outline smoke check
```

## 1. Identify

`spotId` is lowercase kebab: `ca-ab-{name}` (`ca-ab-pine-lake`, `ca-ab-st-mary-reservoir`).

Abort if `data/lakes/{spotId}/` or that `id` already exists in [data/lakes/index.json](data/lakes/index.json).

**Pick one pipeline:**

| Source | Use when | Builder |
| --- | --- | --- |
| **AGS** | Alberta lake in the 2008 bathymetry series (DEM + shoreline + contours) | [scripts/rebuild-ags-lakes.py](scripts/rebuild-ags-lakes.py) |
| **OSM** | Reservoir, no AGS coverage, or AGS names a *different* waterbody | [scripts/build-osm-lake-assets.py](scripts/build-osm-lake-assets.py) |
| **Local GIS** | Existing AGS shapefile + ASC layout on disk (Pigeon) | [scripts/build-lake-assets.py](scripts/build-lake-assets.py) `--gis` |

Name collisions: AGS “Ghost Lake” is not Ghost Reservoir (Cochrane). If unsure, prefer OSM and note why.

Need DIG ids: search AGS `DIG 2008` for `{lake} bathymetry` / shoreline. Typical trio: DEM `*_dem_tm.asc`, boundary `*_bdy_py_tm.shp`, contours `*_bcon_ln_tm.shp`.

Need OSM id: OpenStreetMap relation (usual) or way for the waterbody. Confirm it is the recreational lake, not a nearby pond.

## 2. Spot profile

Create `data/lakes/{spotId}/spot-profile.json` **before** the builder (builders read `--spot`).

Copy a **slim** lake ([data/lakes/ca-ab-driedmeat-lake/spot-profile.json](data/lakes/ca-ab-driedmeat-lake/spot-profile.json)), not Pigeon’s full forecast schema.

Runtime needs ([apps/web/src/lib/lakeAssets.ts](apps/web/src/lib/lakeAssets.ts)):

- `spotId` matching the folder and index `id`
- `identity.name`, `latitude`, `longitude`, `timezone` (`America/Edmonton` for AB)
- `proxyPoints` with `id: "open_lake_center"` at mid-lake (wind/wave sample)

Also set `identity.summary`, `ridePoints` if a public launch is known. Do not pad unused MasViento-style blocks.

## 3. Build assets

Ensure `.venv` exists: `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`

### AGS

Add an entry to `LAKES` in [scripts/rebuild-ags-lakes.py](scripts/rebuild-ags-lakes.py), then:

```bash
.venv/bin/python scripts/rebuild-ags-lakes.py --only ca-ab-{name}
```

Downloads go to `data/ags-cache/` (gitignored).

### OSM

Dump geometry, then build. Default `--max-depth` from a published figure or a nearby analog; say so in the lake README.

```bash
curl -sS -A "chop-lake-builder" -o /tmp/{spotId}.osm.json \
  --data-urlencode 'data=[out:json][timeout:90];rel(OSM_ID); >; out geom;' \
  https://overpass-api.de/api/interpreter

.venv/bin/python scripts/build-osm-lake-assets.py \
  --osm /tmp/{spotId}.osm.json \
  --osm-id OSM_ID --osm-type relation \
  --spot data/lakes/{spotId}/spot-profile.json \
  --out data/lakes/{spotId} \
  --cell-m 75 --max-depth DEPTH_M
```

Use `--osm-type way` if the waterbody is a way. `--cell-m 50` for small lakes, `75`–`100` for large ones (Lesser Slave–scale).

### Local GIS (Pigeon layout)

```bash
.venv/bin/python scripts/build-lake-assets.py \
  --gis PATH/TO/gis \
  --spot data/lakes/{spotId}/spot-profile.json \
  --out data/lakes/{spotId} \
  --water-surface ELEV_M
```

Builders write `shoreline.geojson`, `depth.bin`, `fetch_16dir.bin`, `grid.json`, `depth-contours.geojson`, `README.md`. Commit the binaries.

## 4. Register

Append to the `lakes` array in [data/lakes/index.json](data/lakes/index.json) only (symlink serves `/lakes/...`):

```json
{
  "id": "ca-ab-{name}",
  "name": "Display Name",
  "region": "Alberta, Canada",
  "enabled": true,
  "path": "/lakes/ca-ab-{name}"
}
```

`enabled: false` keeps assets on disk but hides the picker. The UI filters `enabled`.

No MapView / outline-code changes. Title-case names in the index (`Pigeon Lake`, not `PIGEON LAKE`).

## 5. Smoke check

With `npm run dev` (Vite `:5173`):

1. Reload; lake appears in the picker.
2. Select it: map recenters; bottom readout name matches.
3. Topo + Wind: title-case outline + name on `.lake-outlines`.
4. Waves: color on **this lake’s water only**.

If those four pass, stop unless the user asked for a full map QA — then follow [chop-map-qa](../chop-map-qa/SKILL.md).

## Failures

| Symptom | Likely cause |
| --- | --- |
| Missing from picker | Not in `index.json`, or `enabled: false` |
| Fetch 404 for grids | Wrote under `apps/web/public/lakes` instead of `data/lakes`, or skipped the build |
| Empty / wrong outline | OSM id is a different waterbody; or AGS name collision |
| Waves everywhere / nowhere | Shoreline not a polygon, or `spotId` ≠ index `id` |
| `Unknown lake ids` | AGS rebuild `--only` id not in `LAKES` |
