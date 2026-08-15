# Keho Lake assets

Precomputed grids for **chop**.

| File | Description |
|------|-------------|
| `spot-profile.json` | Spot metadata, proxy points, ride beaches |
| `shoreline.geojson` | Lake boundary (WGS84) |
| `depth.bin` | Float32 depth (m), row-major north-first; land = `-1` |
| `fetch_16dir.bin` | Float32 fetch (m), shape `(16, nrows, ncols)` |
| `depth-contours.geojson` | Depth isolines traced from `depth.bin` |
| `grid.json` | Bounds, size, directions, licence metadata |

## Data sources

- Shoreline: AGS DIG 2008-0788
- Bathymetry DEM: AGS DIG 2008-0450 (50 m Arc ASCII)
- Water surface elevation used for depth: **958.8 m asl**
- Licence: [Open Government Licence – Alberta](https://open.alberta.ca/licence)
