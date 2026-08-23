import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findSidebarParam,
  parseBuoyNumber,
  parseBuoyTimestamp,
  parsePigeonBuoySidebar,
  PLWA_BUOY_ID,
  PLWA_BUOY_LAT,
  PLWA_BUOY_LON,
  windToMps,
  type SidebarResponse,
} from "./pigeon-buoy.ts";

const SIDEBAR: SidebarResponse = {
  error: false,
  data: {
    "2026-08-22 13:10 (UTC -06:00)": [
      { id: 105918, name: "Water temperature", value: "20.15", unit: "C" },
      { id: 105928, name: "Air Temperature", value: "19.10", unit: "C" },
      { id: 105931, name: "Relative Humidity", value: "52", unit: "%" },
      { id: 105933, name: "Wind Speed", value: "3.1", unit: "m/s" },
      { id: 105934, name: "Wind Gust", value: "3.7", unit: "m/s" },
      { id: 105935, name: "Wind Direction", value: "139", unit: "Deg" },
    ],
  },
  latestTimestamp: "08-22-2026 13:10",
};

describe("PLWA Pigeon Lake buoy", () => {
  it("parses the portal timestamp with a UTC offset", () => {
    assert.equal(
      parseBuoyTimestamp("2026-08-22 13:10 (UTC -06:00)"),
      "2026-08-22T19:10:00.000Z",
    );
    assert.equal(parseBuoyTimestamp("not a date"), null);
  });

  it("treats blank and dashed values as missing", () => {
    assert.equal(parseBuoyNumber("19.10"), 19.1);
    assert.equal(parseBuoyNumber("--"), null);
    assert.equal(parseBuoyNumber(""), null);
    assert.equal(parseBuoyNumber(undefined), null);
  });

  it("finds parameters by exact name, case-insensitive", () => {
    const params = SIDEBAR.data!["2026-08-22 13:10 (UTC -06:00)"]!;
    assert.equal(findSidebarParam(params, "wind speed")?.value, "3.1");
    assert.equal(findSidebarParam(params, "Air Temperature")?.value, "19.10");
  });

  it("converts non-SI wind units to m/s", () => {
    assert.equal(windToMps(3.1, "m/s"), 3.1);
    assert.equal(windToMps(36, "km/h"), 10);
    assert.equal(windToMps(10, "kt"), 5.14444);
  });

  it("maps a sidebar payload onto the mid-lake buoy", () => {
    const obs = parsePigeonBuoySidebar(SIDEBAR);
    assert.ok(obs);
    assert.equal(obs.id, PLWA_BUOY_ID);
    assert.equal(obs.name, "Pigeon Lake Buoy");
    assert.equal(obs.lon, PLWA_BUOY_LON);
    assert.equal(obs.lat, PLWA_BUOY_LAT);
    assert.equal(obs.observedAt, "2026-08-22T19:10:00.000Z");
    assert.equal(obs.airTempC, 19.1);
    assert.equal(obs.relHum, 52);
    assert.equal(obs.windSpeedMps, 3.1);
    assert.equal(obs.windGustMps, 3.7);
    assert.equal(obs.windDirDeg, 139);
  });

  it("returns null when the portal reports an error or empty data", () => {
    assert.equal(parsePigeonBuoySidebar({ error: true }), null);
    assert.equal(parsePigeonBuoySidebar({ error: false, data: {} }), null);
  });

  it("keeps the newest sample when multiple timestamps are present", () => {
    const obs = parsePigeonBuoySidebar({
      error: false,
      data: {
        "2026-08-22 12:55 (UTC -06:00)": [
          { name: "Wind Speed", value: "1.0", unit: "m/s" },
        ],
        "2026-08-22 13:10 (UTC -06:00)": [
          { name: "Wind Speed", value: "5.0", unit: "m/s" },
        ],
      },
    });
    assert.equal(obs?.windSpeedMps, 5);
    assert.equal(obs?.observedAt, "2026-08-22T19:10:00.000Z");
  });
});
