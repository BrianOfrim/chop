---
name: chop-map-qa
description: >-
  Live QA pass of the Chop inland-lake map like a tester. Opens localhost:5173,
  checks controls, overlays, lake outlines, name labels, heatmaps, the pinned
  forecast spot, and loading state with browser snapshot plus screenshot. Use
  when the user asks to QA the map, verify map UI, smoke-test Chop, or check
  that map components are visible and operational.
---

# Chop map QA

Run a live pass against the running app. Do not add Playwright, Vitest UI tests, or screenshot CI. Do not change product code unless the user asks.

Use [apps/web/src/components/MapView.tsx](apps/web/src/components/MapView.tsx) only as a hint for current button order. Assert what you **see**. If the UI changed, record the mismatch and still judge visibility.

## Preconditions

1. Dev server: `npm run dev` (API `:8787`, Vite `:5173`). Start it if it is not running.
2. Open **Chop** at `http://localhost:5173/` in the Cursor browser. Ignore unrelated tabs (e.g. Facebook).
3. Lock the Chop tab before interacting; unlock when the report is done.
4. Reset map prefs so defaults can be checked, then reload:

```js
localStorage.removeItem("chop.basemap");
localStorage.removeItem("chop.mapOverlay");
localStorage.removeItem("chop.windGlyph");
localStorage.removeItem("chop.heatmapStyle");
```

Then navigate to `http://localhost:5173/` again.

## How to judge

- **Controls:** accessibility snapshot (`aria-pressed`, button order, missing groups).
- **Canvas (heatmap, outlines, labels):** screenshot. Ink on `canvas.lake-outlines` can corroborate outlines/labels; it is not enough alone.
- **Never** treat `map.queryRenderedFeatures` / `map.loaded()` as proof. The GeoJSON worker can stall; hidden Satellite/Topo tiles can leave `loaded()` false while the UI is fine.
- Wait on the loading chip **or** a painted heatmap, not `map.loaded()`.
- Chop lake names are **title case** (`Pigeon Lake`). Carto Map tiles show ALL-CAPS OSM names — those are not Chop labels. Prove labels on **Topo**.
- Outlines, names, and the pinned forecast spot are drawn on the DOM canvas `.lake-outlines` above the MapLibre heatmap. A MapLibre `forecast-point` circle under the raster is **not** a pass.

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
- [ ] Basemap cycle still readable
- [ ] Lake picker recenters
- [ ] Zoom-out provincial outlines + names
- [ ] Pinned forecast spot above heatmap
```

### 1. Defaults (snapshot)

After reload:

- Header: lake picker, Wind/Waves/Temp units, tabs Forecast | History | Review | Sim
- Basemap group order **Topo, Map, Satellite**; **Topo** pressed
- Overlay group order **Wind, Waves, Temp, Depth**; **Wind** pressed
- **Blend / Edges** visible; **Arrows / Particles** visible; **Particles** pressed
- Legend title starts with `Wind speed`

### 2. Overlay rules (click + snapshot)

- **Waves** then **Depth**: Blend/Edges gone. Legend is `Wave height Hs` then `Depth`.
- **Temp**: Blend/Edges back. Legend is `Temperature`.
- **Wind** again: Particles on. `canvas.wind-particles` has class `is-on` if Particles is selected.

### 3. Canvas visuals (screenshot each overlay)

If `.map-heatmap-loading` is present, wait until it disappears (or ~15s). Chip text is `Loading wind field…` or `Loading temperature field…`. Chip still up with an empty map after that = fail the heatmap, pass the chip.

| Overlay | Pass |
| --- | --- |
| Wind | Provincial color field (not empty beige/white). Chip gone once painted. |
| Topo + Wind | Dark shorelines with light halo on several selectable lakes, **above** the heatmap. Title-case names (Pigeon, Wabamun, Gull, …), not ALL-CAPS. |
| Temp | Provincial temperature field or chip then field. Outlines/names still readable. |
| Waves | Color on the **selected lake** water only — not a fake province-wide fill. |
| Depth | No Blend/Edges. Depth legend. Selected-lake contours acceptable. |

### 4. Operational

- Topo → Map → Satellite: basemap changes; outlines/labels still readable (Satellite may use light strokes).
- Pick another lake in the dropdown: map recenters; bottom readout name matches.
- Zoom out to provincial view: many outlines + names still visible.
- On **Wind** (heatmap on), click the **selected** lake’s water (not another lake — that changes the picker). A cream halo + teal dot must sit **above** the heatmap. Legend shows `Pinned spot · Clear`. Still visible after switching to Waves. No pin until you click water.

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
| Zoom-out labels+outlines | pass/fail | |
| Pinned forecast spot | pass/fail | Cream/teal pin above Wind heatmap; Clear on legend |

## Failures
- <check>: <what you saw> — screenshot if visual
```
