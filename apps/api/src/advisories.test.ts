import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AHS_LISTING_URL,
  buildAdvisories,
  compactName,
  decodeEntities,
  matchLakeId,
  parseAhsDate,
  parseAhsListing,
  waterbodyFromTitle,
} from "./advisories.ts";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/ahs-listing.html",
);
const fixtureHtml = readFileSync(fixturePath, "utf8");

const lakes = [
  { id: "ca-ab-pigeon-lake", name: "Pigeon Lake" },
  { id: "ca-ab-driedmeat-lake", name: "Driedmeat Lake" },
  { id: "ca-ab-eagle-lake", name: "Eagle Lake" },
  { id: "ca-ab-lac-ste-anne", name: "Lac Ste. Anne" },
  { id: "ca-ab-buffalo-lake", name: "Buffalo Lake" },
  { id: "ca-ab-wabamun-lake", name: "Wabamun Lake" },
];

describe("AHS listing parser", () => {
  it("extracts cyanobacteria items from the listing fixture", () => {
    const items = parseAhsListing(fixtureHtml);
    const names = items.map((i) => i.ahsName);
    assert.deepEqual(names, [
      "Reesor Lake",
      "Dried Meat Lake",
      "Eagle Lake",
      "Lac Ste. Anne",
      "Matchayaw (Devil's) Lake",
      "Pigeon Lake",
      "Buffalo Lake",
    ]);
    const pigeon = items.find((i) => i.ahsName === "Pigeon Lake");
    assert.ok(pigeon);
    assert.equal(pigeon.issued, "2026-07-20");
    assert.equal(
      pigeon.url,
      "https://www.albertahealthservices.ca/news/Page19818.aspx",
    );
  });

  it("decodes HTML entities in waterbody names", () => {
    assert.equal(decodeEntities("Devil&#39;s"), "Devil's");
    assert.equal(
      waterbodyFromTitle(
        "Cyanobacterial (blue-green algal) bloom advisory issued for Matchayaw (Devil&#39;s) Lake",
      ),
      "Matchayaw (Devil's) Lake",
    );
  });

  it("parses AHS listing dates to ISO", () => {
    assert.equal(parseAhsDate("Monday, July 20, 2026"), "2026-07-20");
    assert.equal(parseAhsDate("Wednesday, August 5, 2026"), "2026-08-05");
  });
});

describe("lake name matching", () => {
  it("matches Pigeon Lake by display name", () => {
    assert.equal(matchLakeId("Pigeon Lake", lakes), "ca-ab-pigeon-lake");
  });

  it("maps Dried Meat Lake to Driedmeat Lake via alias + compact form", () => {
    assert.equal(compactName("Dried Meat Lake"), compactName("Driedmeat Lake"));
    assert.equal(matchLakeId("Dried Meat Lake", lakes), "ca-ab-driedmeat-lake");
  });

  it("matches Lac Ste. Anne despite punctuation", () => {
    assert.equal(matchLakeId("Lac Ste. Anne", lakes), "ca-ab-lac-ste-anne");
    assert.equal(matchLakeId("Lac Ste Anne", lakes), "ca-ab-lac-ste-anne");
  });

  it("ignores AHS lakes that are not in Chop", () => {
    assert.equal(matchLakeId("Reesor Lake", lakes), undefined);
    assert.equal(matchLakeId("Matchayaw (Devil's) Lake", lakes), undefined);
  });
});

describe("buildAdvisories", () => {
  it("flags Chop lakes on the AHS list and leaves others clear", () => {
    const data = buildAdvisories(fixtureHtml, lakes, "2026-08-19T18:00:00.000Z");
    assert.equal(data.status, "ok");
    assert.equal(data.sourceUrl, AHS_LISTING_URL);
    assert.equal(data.lakes["ca-ab-pigeon-lake"]?.advisory, true);
    assert.equal(data.lakes["ca-ab-driedmeat-lake"]?.advisory, true);
    assert.equal(data.lakes["ca-ab-driedmeat-lake"]?.ahsName, "Dried Meat Lake");
    assert.equal(data.lakes["ca-ab-eagle-lake"]?.advisory, true);
    assert.equal(data.lakes["ca-ab-lac-ste-anne"]?.advisory, true);
    assert.equal(data.lakes["ca-ab-buffalo-lake"]?.advisory, true);
    assert.equal(data.lakes["ca-ab-wabamun-lake"]?.advisory, false);
  });

  it("treats a valid empty listing as all-clear, not unavailable", () => {
    const html = `<div id="page-listing12848"></div>`;
    const data = buildAdvisories(html, lakes);
    assert.equal(data.status, "ok");
    assert.equal(data.lakes["ca-ab-pigeon-lake"]?.advisory, false);
  });

  it("returns unavailable when AHS markup is missing", () => {
    const data = buildAdvisories("<html><body>no listing</body></html>", lakes);
    assert.equal(data.status, "unavailable");
    assert.equal(data.lakes["ca-ab-pigeon-lake"]?.advisory, false);
  });
});
