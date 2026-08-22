# Elkwater Lake assets

Precomputed grids for **chop**.

| File | Description |
|------|-------------|
| `spot-profile.json` | Spot metadata, proxy points, ride beaches |
| `shoreline.geojson` | Lake boundary (WGS84) |
| `depth.bin` | Float32 depth (m), row-major north-first; land = `-1` |
| `fetch_16dir.bin` | Float32 fetch (m), shape `(16, nrows, ncols)` |
| `depth-contours.geojson` | Depth isolines from the raster |
| `grid.json` | Bounds, size, directions, licence metadata |

## Data sources

- Shoreline: AGS DIG 2008-0751
- Bathymetry DEM: AGS DIG 2008-0413 (50 m Arc ASCII)
- Water surface elevation used for depth: **1226.2 m asl**
- Licence: [Open Government Licence – Alberta](https://open.alberta.ca/licence)
