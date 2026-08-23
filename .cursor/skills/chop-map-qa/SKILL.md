---
name: chop-map-qa
description: >-
  Live QA pass of the Chop inland-lake map like a tester. Opens localhost:5173,
  checks controls, overlays, lake outlines, name labels, heatmaps, wind arrows,
  stations, the fetch-distance hover point, the pinned forecast spot, selected-lake
  zoom on load, and loading state with browser snapshot plus screenshot. Use when
  the user asks to QA the map, verify map UI, smoke-test Chop, or check that map
  components are visible and operational.
---

# Chop map QA

Run a live pass against the running app. Do not add Playwright, Vitest UI tests, or screenshot CI. Do not change product code unless the user asks.

Use [apps/web/src/components/MapView.tsx](apps/web/src/components/MapView.tsx) only as a hint for current button order. Assert what you **see**. If the UI changed, record the mismatch and still judge visibility.

## Preconditions

1. Dev server: `npm run dev` (API `:8787`, Vite `:5173`). Start it if it is not running.
2. Open **Chop** at `http://localhost:5173/` in the Cursor browser. Ignore unrelated tabs (e.g. Facebook).
3. Lock the Chop tab before interacting; unlock when the report is done.
4. Reset map prefs so defaults can be checked, then reload. Overlay, radar, and stations do **not** persist — refresh is always **Wind** with **Stations** off.

```js
localStorage.removeItem("chop.basemap");
localStorage.removeItem("chop.windGlyph");
localStorage.removeItem("chop.heatmapStyle");
localStorage.removeItem("chop.forecastPins");
localStorage.removeItem("chop.lakeId");
```

Then navigate to `http://localhost:5173/` again. Clean load means **no lake** until the picker is used.

## How to judge

- **Controls:** accessibility snapshot (`aria-pressed`, button order, missing groups).
- **Canvas (heatmap, outlines, labels):** screenshot. Ink on `canvas.lake-outlines` can corroborate outlines/labels; it is not enough alone.
- **Never** treat `map.queryRenderedFeatures` / `map.loaded()` as proof. The GeoJSON worker can stall; hidden Satellite/Topo tiles can leave `loaded()` false while the UI is fine.
- Wait on the loading chip **or** a painted heatmap, not `map.loaded()`.
- Chop lake names are **title case** (`Pigeon Lake`). Carto Map tiles show ALL-CAPS OSM names — those are not Chop labels. Prove labels on **Topo**.
- Outlines, names, and the pinned forecast spot are drawn on the DOM canvas `.lake-outlines` above the MapLibre heatmap. A MapLibre `forecast-point` circle under the raster is **not** a pass.
- Wind **Arrows** and **Particles** are drawn on `.wind-particles` above the heatmap. MapLibre `wind-arrows` lines under the raster are **not** a pass.
- Weather **Stations** (including the Pigeon Lake buoy) are drawn on `.wx-stations-overlay` above the heatmap and particles. MapLibre `wx-stations-*` under the raster is **not** a pass.
- The lake-hover **fetch point** (dot + dashed upwind ray + shore tick) is drawn on `.fetch-ray-overlay` above the heatmap. A MapLibre `fetch-ray` circle under the raster is **not** a pass.
- **Selected-lake zoom on load** is a screenshot judgment. After reload with a saved lake, that lake must fill the view (centered, close-up). A provincial scatter of many named lakes (Lesser Slave, Cold Lake, …) is a fail. `.map` `data-map-view="lake"`, `data-fitted-lake`, and `data-map-zoom` can corroborate; they are not enough alone. `map.getZoom()` is not proof.

## Procedure

Copy and tick as you go:

```
- [ ] Defaults after clean load
- [ ] Overlay rules (Blend/Edges, Particles, legend)
- [ ] Wind heatmap or loading then heatmap
- [ ] Outlines + title-case names (Topo)
- [ ] Temp heatmap or loading then heatmap
- [ ] Waves heatmap on selected lake only
- [ ] Depth: no Blend/Edges; depth legend
- [ ] Wind arrows above heatmap
- [ ] Basemap cycle still readable
- [ ] Lake picker recenters
- [ ] Selected-lake zoom on load
- [ ] Zoom-out provincial outlines + names
- [ ] Pinned forecast spot above heatmap
- [ ] Per-lake pins survive lake switch
- [ ] Stations above heatmap
- [ ] Fetch-distance hover point above heatmap
```

### 1. Defaults (snapshot)

After reload:

- Header: lake picker set to **Choose a lake**, Wind/Waves/Temp units, tabs Forecast | History | Review | Sim
- Map is **provincial** (many lakes visible). Not zoomed in on one lake.
- Basemap group order **Topo, Map, Satellite**; **Topo** pressed
- Overlay group order **Wind, Waves, Temp, Depth**; **Wind** pressed; **Radar** and **Stations** released
- **Blend / Edges** visible; **Arrows / Particles** visible; **Particles** pressed
- Legend title starts with `Wind speed`

### 2. Overlay rules (click + snapshot)

- Pick a lake if the picker is still **Choose a lake** (Pigeon is fine) before Waves/Depth.
- **Waves** then **Depth**: Blend/Edges gone. Legend is `Wave height` then `Depth`.
- **Temp**: Blend/Edges back. Legend is `Temperature`.
- **Wind** again: Particles on. `canvas.wind-particles` has class `is-on` if Particles is selected.
- **Arrows** (Wind overlay, heatmap on): directional shafts/chevrons visible **above** the color field across the province (not empty). `canvas.wind-particles` is `is-on`. Switch back to **Particles** afterwards.

### 3. Canvas visuals (screenshot each overlay)

If `.map-heatmap-loading` is present, wait until it disappears (or ~15s). Chip text is `Loading wind field…` or `Loading temperature field…`. Chip still up with an empty map after that = fail the heatmap, pass the chip.

| Overlay | Pass |
| --- | --- |
| Wind | Provincial color field (not empty beige/white). Chip gone once painted. |
| Topo + Wind | Dark shorelines with light halo on several selectable lakes, **above** the heatmap. Title-case names (Pigeon, Wabamun, Gull, …), not ALL-CAPS. |
| Temp | Provincial temperature field or chip then field. Outlines/names still readable. |
| Waves | Color on the **selected lake** water only — not a fake province-wide fill. Pick a lake first if needed. |
| Depth | No Blend/Edges. Depth legend. Selected-lake contours acceptable. |

### 4. Operational

- Topo → Map → Satellite: basemap changes; outlines/labels still readable (Satellite may use light strokes).
- Pick a lake in the dropdown (Pigeon is fine): map recenters; bottom readout name matches.
- **Selected-lake zoom on load:** with that lake still selected, reload `http://localhost:5173/`. After the map paints (or the loading chip clears), the **saved** lake must fill the view — one lake dominant and centered, not Alberta-wide. Picker and bottom readout still match. Then pick a **different** lake, reload again: the new lake is the close-up, not the previous one. Screenshot if it stays provincial.
- Zoom out to provincial view: many outlines + names still visible.
- On **Wind** (heatmap on), click the **selected** lake’s water (not another lake — that changes the picker). A cream halo + teal dot must sit **above** the heatmap. Legend shows `Pinned spot · Clear`. Still visible after switching to Waves. No pin until you click water.
- Pin is **per lake**: switch to another lake — that lake has no pin (unless you already pinned it). Switch back — the first lake’s pin is still there. Clear only removes the **selected** lake’s pin.
- Turn **Stations** on. On **Wind** (heatmap + Particles on), station dots/arrows/labels — including **Pigeon Lake Buoy** mid-lake — must sit **above** the color field and particles, not flicker underneath. `canvas.wx-stations-overlay` having ink can corroborate; it is not enough alone. Turn Stations off afterwards if it clutters later checks.
- On **Wind** (heatmap on), hover the **selected** lake’s water. A hover dot plus dashed fetch ray to shore must sit **above** the heatmap. The hover card may show `Fetch … km`. `canvas.fetch-ray-overlay` ink can corroborate; a point buried in the raster is a fail.

## Report

No product edits unless asked. One screenshot per **failed** visual (not every pass).

```markdown
# Chop map QA

**Build:** localhost:5173 | **When:** <ISO time>

| Check | Result | Notes |
| --- | --- | --- |
| Defaults (Topo / Wind / Particles) | pass/fail | |
| Blend/Edges only Wind+Temp | pass/fail | |
| Wind heatmap / loading chip | pass/fail | |
| Lake outlines | pass/fail | |
| Lake name labels (title case) | pass/fail | |
| Temp heatmap / loading chip | pass/fail | |
| Waves heatmap (lake only) | pass/fail | |
| Basemap cycle | pass/fail | |
| Lake picker recenter | pass/fail | |
| Selected-lake zoom on load | pass/fail | Reload with a saved lake frames that lake, not Alberta; second lake + reload follows the new choice |
| Zoom-out labels+outlines | pass/fail | |
| Pinned forecast spot | pass/fail | Cream/teal pin above Wind heatmap; Clear on legend; pin remembered per lake |
| Wind arrows | pass/fail | Arrows visible above Wind heatmap; not buried MapLibre lines |
| Stations above heatmap | pass/fail | Stations (incl. Pigeon Lake Buoy) above Wind heatmap and particles |
| Fetch hover point | pass/fail | Hover dot + fetch ray above Wind heatmap on selected-lake water |

## Failures
- <check>: <what you saw> — screenshot if visual
```
