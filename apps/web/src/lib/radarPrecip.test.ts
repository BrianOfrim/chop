import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RADAR_LEGEND_STOPS } from "./radar.ts";
import {
  formatRadarPrecipCopy,
  imageDataToRaster,
  maxOverShoreline,
  pointInShoreline,
  precipBarFill,
  radarBboxMapUrl,
  radarRateToT,
  reduceRadarPrecip,
  resetRadarPrecipCache,
  rgbToRadarRate,
  sampleNearest,
  sampleRadarPrecipSeries,
  shorelineBBox,
  type RadarPrecipRaster,
} from "./radarPrecip.ts";

function squareLake(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
      },
    ],
  };
}

function lakeWithHole(): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
            [
              [4, 4],
              [6, 4],
              [6, 6],
              [4, 6],
              [4, 4],
            ],
          ],
        },
      },
    ],
  };
}

function raster(values: number[][], bbox = { west: 0, south: 0, east: 10, north: 10 }): RadarPrecipRaster {
  const height = values.length;
  const width = values[0]!.length;
  const flat = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      flat[j * width + i] = values[j]![i]!;
    }
  }
  return { ...bbox, width, height, values: flat };
}

describe("shoreline geometry", () => {
  it("tests point-in-polygon with holes via evenodd", () => {
    const shore = lakeWithHole();
    assert.equal(pointInShoreline(1, 1, shore), true);
    assert.equal(pointInShoreline(5, 5, shore), false);
    assert.equal(pointInShoreline(20, 20, shore), false);
  });

  it("pads the shoreline bbox", () => {
    const box = shorelineBBox(squareLake());
    if (!box) throw new Error("expected bbox");
    assert.ok(box.west < 0 && box.south < 0);
    assert.ok(box.east > 10 && box.north > 10);
  });
});

describe("radar precip reduce", () => {
  it("takes the max over water and ignores land pixels", () => {
    const shore = squareLake();
    const rain = raster([
      [50, 0],
      [0, 4],
    ]);
    const snow = raster([
      [0, 0],
      [0, 0],
    ]);
    const landOnly = raster(
      [
        [80, 80],
        [80, 80],
      ],
      { west: 20, south: 20, east: 30, north: 30 },
    );
    assert.equal(maxOverShoreline(rain, shore), 50);
    assert.equal(maxOverShoreline(landOnly, shore), 0);
    const lake = reduceRadarPrecip(rain, snow, shore, null);
    assert.equal(lake.mode, "lake");
    assert.equal(lake.rainMmH, 50);
    assert.equal(lake.snowCmH, 0);
  });

  it("samples the nearest cell at a pin", () => {
    const shore = squareLake();
    const rain = raster([
      [1, 16],
      [2, 4],
    ]);
    const snow = raster([
      [0, 0],
      [8, 0],
    ]);
    const atPin = reduceRadarPrecip(rain, snow, shore, { lon: 7.5, lat: 7.5 });
    assert.equal(atPin.mode, "pin");
    assert.equal(atPin.rainMmH, 16);
    assert.equal(atPin.snowCmH, 0);
    assert.equal(sampleNearest(rain, 2.5, 2.5), 2);
    assert.equal(sampleNearest(snow, 2.5, 2.5), 8);
  });
});

describe("legend color lookup", () => {
  it("round-trips legend-stop RGB to the matching rate", () => {
    for (const stop of RADAR_LEGEND_STOPS) {
      const [r, g, b] = stop.rgb;
      assert.equal(rgbToRadarRate(r, g, b, 255), stop.rate);
    }
    assert.equal(rgbToRadarRate(0, 0, 0, 0), 0);
    assert.equal(rgbToRadarRate(128, 128, 128, 255), 0);
  });

  it("builds a raster from ImageData-like pixels", () => {
    const stop = RADAR_LEGEND_STOPS[3]!;
    const data = new Uint8ClampedArray([
      stop.rgb[0],
      stop.rgb[1],
      stop.rgb[2],
      255,
      0,
      0,
      0,
      0,
    ]);
    const ras = imageDataToRaster(
      { width: 2, height: 1, data },
      { west: 0, south: 0, east: 2, north: 1 },
    );
    assert.equal(ras.values[0], stop.rate);
    assert.equal(ras.values[1], 0);
  });

  it("maps rate onto the legend parameter used for bar color", () => {
    assert.equal(radarRateToT(0), 0);
    assert.equal(radarRateToT(0.1), 0);
    assert.equal(radarRateToT(200), 1);
    assert.ok(radarRateToT(16) > 0.4 && radarRateToT(16) < 0.6);
    assert.ok(precipBarFill(16, 0)?.startsWith("rgb("));
    assert.equal(precipBarFill(0, 0), null);
  });
});

describe("precip copy", () => {
  it("distinguishes lake max vs pin and rain vs snow", () => {
    assert.equal(formatRadarPrecipCopy(2.4, 0, "lake"), "Lake max 2.4 mm/h rain");
    assert.equal(formatRadarPrecipCopy(0, 1.2, "lake"), "Lake max 1.2 cm/h snow");
    assert.equal(formatRadarPrecipCopy(2.4, 0, "pin"), "2.4 mm/h rain at pin");
    assert.equal(formatRadarPrecipCopy(0, 0, "lake"), "dry");
    assert.equal(formatRadarPrecipCopy(0, 0, "pin"), "dry at pin");
  });
});

describe("precip series pending", () => {
  it("marks cache misses as pending until rasters arrive", () => {
    resetRadarPrecipCache();
    const times = ["2026-08-20T19:24:00Z", "2026-08-20T19:30:00Z"];
    const windows = {
      observed: {
        startMs: Date.parse(times[0]!),
        endMs: Date.parse(times[1]!),
        defaultIso: times[1]!,
        times,
      },
      nowcast: null,
    };
    const series = sampleRadarPrecipSeries(times, windows, squareLake(), null);
    assert.equal(series.length, 2);
    assert.equal(series[0]?.pending, true);
    assert.equal(series[1]?.pending, true);
    assert.equal(series[0]?.mode, "lake");
  });
});

describe("WMS bbox request", () => {
  it("requests a 4326 GetMap for the lake window", () => {
    const url = radarBboxMapUrl(
      "RADAR_1KM_RRAI",
      "2026-08-20T19:24:00Z",
      { west: -114.1, south: 52.45, east: -113.9, north: 52.63 },
      24,
      20,
    );
    assert.match(url, /REQUEST=GetMap/);
    assert.match(url, /CRS=EPSG:4326/);
    assert.match(url, /BBOX=52\.45,-114\.1,52\.63,-113\.9/);
    assert.match(url, /TIME=2026-08-20T19%3A24%3A00Z/);
    assert.match(url, /STYLES=Radar-Rain_14colors/);
  });
});
