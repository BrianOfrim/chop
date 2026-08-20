# chop

Inland lake **wave height** map (with wind as a secondary overlay), starting with **Pigeon Lake**, Alberta.

Wave height is the hero layer: significant wave height (`Hs`) from a Young–Verhagen finite-depth model, cosine-squared effective fetch, and an optional duration cap from HRDPS wind history, driven by Environment Canada **HRDPS** wind via Open-Meteo. Wind arrows and a mid-lake readout sit on top.

## Quick start

```bash
cd ~/Projects/chop
npm install
cp .env.example .env.local   # then fill Strava client id/secret
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). That starts the web UI and a localhost Strava API (`:8787`, proxied at `/api`).

Strava: create an API app at https://www.strava.com/settings/api with Authorization Callback Domain `localhost`. Connect from the top bar, then pick a session to replay.

## Workspace layout

| Path | Role |
|------|------|
| `apps/web/` | MapLibre + React UI |
| `apps/api/` | Localhost Strava OAuth + activity proxy |
| `packages/wave-engine/` | Young–Verhagen `Hs` + duration + depth-cap (TypeScript) |
| `data/lakes/{spotId}/` | Per-lake shoreline, depth, fetch grids, spot profile |
| `scripts/build-lake-assets.py` | Build web assets from GIS (AGS DEM + shoreline) |

## Rebuild Pigeon Lake assets

Needs Python deps (geopandas, numpy, pyproj). From the repo root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/build-lake-assets.py \
  --gis ~/Downloads/windsport-spots/pigeon-lake/gis \
  --spot data/lakes/ca-ab-pigeon-lake/spot-profile.json \
  --out data/lakes/ca-ab-pigeon-lake \
  --water-surface 847.6
```

Source bathymetry/shoreline: **AGS DIG 2008-0490** and **DIG 2008-0828** under the [Open Government Licence – Alberta](https://open.alberta.ca/licence).

## How waves are computed

1. Precompute water depth and **16-direction fetch** on a ~50 m grid.
2. At runtime, take HRDPS 10 m wind speed & meteorological FROM direction, plus how long that wind event has lasted in the hourly series.
3. For each water cell: effective fetch = cosine-squared blend of bins within ±45°, then `Hs = Young–Verhagen(U, min(fetch, duration-fetch), depth)`, then `Hs = min(Hs, 0.4 × depth)`.

This is a shallow-lake engineering estimate, not WW3. Good for relative “where’s the chop?” maps. Simulator mode stays fetch-limited (steady wind).

## Add another lake

1. Create `data/lakes/{spotId}/` with a `spot-profile.json` (see Pigeon’s).
2. Produce shoreline polygon + depth grid (DEM or synthetic).
3. Extend or fork `scripts/build-lake-assets.py` for that lake’s CRS/inputs.
4. Register the lake in [`data/lakes/index.json`](data/lakes/index.json) with `"enabled": true`.
5. Reload the app — the lake picker reads the index.

Abraham Lake can follow the same contract (OSM shoreline + synthetic depth). Gull, Sylvan, and Keho use AGS DEMs via `scripts/rebuild-ags-lakes.py`.

## Scripts

```bash
npm run dev          # web UI
npm run test         # wave-engine unit tests
npm run build        # production web build
```

## Licence notes

- App code: yours (add a licence when you care).
- Lake GIS (Pigeon, Gull, Sylvan, Keho): Open Government Licence – Alberta (see each `data/lakes/*/README.md`).
- Basemap: OpenFreeMap / OpenStreetMap contributors.
- Wind: Open-Meteo (GEM HRDPS).
