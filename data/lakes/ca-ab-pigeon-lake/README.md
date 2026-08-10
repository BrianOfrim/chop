# Pigeon Lake assets

Precomputed grids for **chop**.

| File | Description |
|------|-------------|
| `spot-profile.json` | Spot metadata, proxy points, ride beaches |
| `shoreline.geojson` | Lake boundary (WGS84) |
| `depth.bin` | Float32 depth (m), row-major north-first; land = `-1` |
| `fetch_16dir.bin` | Float32 fetch (m), shape `(16, nrows, ncols)` |
| `grid.json` | Bounds, size, directions, licence metadata |

## Data sources

- Shoreline: Alberta Geological Survey **DIG 2008-0828**
- Bathymetry DEM: **DIG 2008-0490** (50 m)
- Water surface elevation used for depth: **847.6 m asl**
- Licence: [Open Government Licence – Alberta](https://open.alberta.ca/licence)

Rebuild with `scripts/build-lake-assets.py` (see repo README).
