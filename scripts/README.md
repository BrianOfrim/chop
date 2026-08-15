# Lake asset builder

```bash
# from repo root
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/build-lake-assets.py --help
```

Pigeon Lake expects AGS shapefile + ASC DEM layout under `--gis`:

- `boundary/pige_bdy_py_tm.shp`
- `bathy_dem/pige_dem_tm.asc`

Rebuild Gull / Sylvan / Keho from the AGS 2008 DEMs (downloads into `data/ags-cache/`, gitignored):

```bash
.venv/bin/python scripts/rebuild-ags-lakes.py
```

Depth contours (from `depth.bin`):

```bash
.venv/bin/python scripts/depth_contours.py
```

Abraham Lake has no AGS DEM (reservoir); it keeps the OSM shoreline + synthetic depth.
