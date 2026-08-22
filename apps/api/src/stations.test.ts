import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collapseLatest,
  joinStations,
  kmhToMps,
  parseCatalogFeature,
  parseObsFeature,
  pickNum,
  stationKey,
  toBearing,
  type ObsRow,
} from "./stations.ts";

describe("SWOB parsers", () => {
  it("converts km/h to m/s and FROM wind to TO bearing", () => {
    assert.equal(kmhToMps(36), 10);
    assert.equal(toBearing(0), 180);
    assert.equal(toBearing(270), 90);
    assert.equal(toBearing(-90), 90);
  });

  it("picks the first finite numeric property", () => {
    assert.equal(pickNum({ a: null, b: 12.5 }, ["a", "b"]), 12.5);
    assert.equal(pickNum({ a: "8" }, ["a"]), 8);
    assert.equal(pickNum({ a: "x" }, ["a"]), null);
  });

  it("parses a catalog station", () => {
    const row = parseCatalogFeature({
      id: "3050519",
      geometry: { type: "Point", coordinates: [-115.552, 51.193] },
      properties: {
        name: "BANFF CS",
        msc_id: "3050519",
        dataset_network: "CA",
        data_provider: "MSC",
        auto_man: "AUTO",
        wmo_id: 71122,
      },
    });
    assert.ok(row);
    assert.equal(row.name, "BANFF CS");
    assert.equal(row.mscId, "3050519");
    assert.equal(row.network, "CA");
    assert.equal(row.wmo, "71122");
    assert.equal(row.lon, -115.552);
  });

  it("parses a realtime observation and converts wind units", () => {
    const row = parseObsFeature({
      properties: {
        "msc_id-value": "3050519",
        "stn_nam-value": "BANFF CS",
        "date_tm-value": "2026-08-22T18:03:00.000Z",
        air_temp: 12.9,
        rel_hum: 86,
        avg_wnd_spd_10m_pst10mts: 18,
        avg_wnd_dir_10m_pst10mts: 215,
        max_wnd_spd_10m_pst10mts: 36,
      },
    });
    assert.ok(row);
    assert.equal(row.key, "3050519");
    assert.equal(row.airTempC, 12.9);
    assert.equal(row.windSpeedMps, 5);
    assert.equal(row.windDirDeg, 215);
    assert.equal(row.windGustMps, 10);
  });

  it("prefers msc_id over station name as the join key", () => {
    assert.equal(
      stationKey({ "msc_id-value": "3050519", "stn_nam-value": "BANFF CS" }),
      "3050519",
    );
  });

  it("keeps the newest observation per station", () => {
    const rows: ObsRow[] = [
      {
        key: "A",
        observedAt: "2026-08-22T18:00:00.000Z",
        airTempC: 1,
        windSpeedMps: 1,
        windDirDeg: 10,
        windGustMps: null,
        relHum: null,
      },
      {
        key: "A",
        observedAt: "2026-08-22T18:10:00.000Z",
        airTempC: 2,
        windSpeedMps: 2,
        windDirDeg: 20,
        windGustMps: null,
        relHum: null,
      },
    ];
    const latest = collapseLatest(rows).get("A");
    assert.equal(latest?.airTempC, 2);
    assert.equal(latest?.observedAt, "2026-08-22T18:10:00.000Z");
  });

  it("joins catalog rows to observations and sets arrow bearing", () => {
    const features = joinStations(
      [
        {
          id: "3050519",
          name: "BANFF CS",
          network: "CA",
          provider: "MSC",
          autoMan: "AUTO",
          mscId: "3050519",
          icao: null,
          wmo: "71122",
          lon: -115.55,
          lat: 51.19,
        },
      ],
      new Map([
        [
          "3050519",
          {
            key: "3050519",
            observedAt: "2026-08-22T18:03:00.000Z",
            airTempC: 12.9,
            windSpeedMps: 5,
            windDirDeg: 0,
            windGustMps: null,
            relHum: 86,
          },
        ],
      ]),
    );
    assert.equal(features.length, 1);
    assert.equal(features[0]?.properties.hasObs, 1);
    assert.equal(features[0]?.properties.hasWind, 1);
    assert.equal(features[0]?.properties.bearing, 180);
    assert.equal(features[0]?.properties.windDirDeg, 0);
  });
});
