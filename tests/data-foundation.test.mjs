import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const regionsDocument = await readJson("data/master/regions.json");
const reference = await readJson("data/master/data-foundation.json");
const land = await readJson("data/monitoring/land-monitoring.json");
const season = await readJson("data/monitoring/season-monitoring.json");
const production = await readJson("data/monitoring/production-monitoring.json");

const regions = regionsDocument.regions;
const regionById = new Map(regions.map((region) => [region.id, region]));
const seasons = new Set(reference.seasons.map((item) => item.season_id));
const commodities = new Set(reference.commodities.map((item) => item.id));
const recordsById = (records) => new Map(records.map((record) => [record.id, record]));
const landById = recordsById(land.records);
const seasonById = recordsById(season.records);
const productionById = recordsById(production.records);
const villageTypes = new Set(["kampung", "kelurahan"]);

function approved(records, seasonId) {
  return records.filter(
    (record) => record.season_id === seasonId && record.validation_status === "approved",
  );
}

function sum(records, field) {
  return records.reduce((total, record) => total + record[field], 0);
}

function totals(seasonId) {
  const lands = approved(land.records, seasonId);
  const plantings = approved(season.records, seasonId);
  const productions = approved(production.records, seasonId);
  return {
    mapped_land_ha: sum(lands, "mapped_land_ha"),
    active_land_ha: sum(lands, "active_land_ha"),
    planting_target_ha: sum(plantings, "planting_target_ha"),
    planting_realization_ha: sum(plantings, "planting_realization_ha"),
    harvested_area_ha: sum(productions, "harvested_area_ha"),
    gkg_production_ton: sum(productions, "gkg_production_ton"),
    gkg_production_target_ton: sum(productions, "gkg_production_target_ton"),
  };
}

test("official Merauke hierarchy contains 1 regency, 22 districts, 179 kampung and 11 kelurahan", () => {
  assert.equal(regions.filter((region) => region.administrative_type === "province").length, 1);
  assert.equal(regions.filter((region) => region.administrative_type === "regency").length, 1);
  assert.equal(regions.filter((region) => region.administrative_type === "district").length, 22);
  assert.equal(regions.filter((region) => region.administrative_type === "kampung").length, 179);
  assert.equal(regions.filter((region) => region.administrative_type === "kelurahan").length, 11);
  assert.equal(regions.filter((region) => villageTypes.has(region.administrative_type)).length, 190);
  assert.equal(regions.length, 214);
});

test("region IDs are unique and every parent relationship is valid", () => {
  assert.equal(new Set(regions.map((region) => region.id)).size, regions.length);
  for (const region of regions) {
    assert.ok(["province", "regency", "district", "kampung", "kelurahan"].includes(region.administrative_type));
    if (region.administrative_type === "province") assert.equal(region.parent_id, null);
    else assert.ok(regionById.has(region.parent_id));
    if (region.administrative_type === "district") assert.equal(region.parent_id, "93.01");
    if (villageTypes.has(region.administrative_type)) {
      const parent = regionById.get(region.parent_id);
      assert.equal(parent?.administrative_type, "district");
    }
  }
});

test("Merauke uses canonical code and all official regions carry traceable source metadata", () => {
  const merauke = regionById.get("93.01");
  assert.equal(merauke.code, "93.01");
  assert.equal(merauke.legacy_code, "91.01");
  for (const region of regions) {
    assert.ok(region.source.institution);
    assert.ok(region.source.document);
    assert.ok(region.source.reference_year);
    assert.match(region.source.url, /^https:\/\//);
    assert.match(region.source.verification_url, /^https:\/\//);
    assert.equal(region.source.verification_status, "verified");
  }
});

test("regional roots and monitoring counts match the canonical scopes", () => {
  const roots = regions.filter((region) => region.parent_id === null);
  assert.deepEqual(roots.map((region) => region.id), ["93"]);
  assert.equal(regionById.get("93.01").parent_id, "93");
  const active = regions.filter((region) => region.monitoring_status === "active");
  assert.equal(active.filter((region) => region.administrative_type === "district").length, 6);
  assert.equal(active.filter((region) => villageTypes.has(region.administrative_type)).length, 74);
});

test("generator emits official source URLs and is manual-only", async () => {
  const generator = await readFile("scripts/generate-data-foundation.mjs", "utf8");
  const packageDocument = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(generator, /source:\s*dataSource\(\)/);
  assert.match(generator, /url:/);
  assert.doesNotMatch(packageDocument.scripts.build, /generate-data-foundation/);
  assert.doesNotMatch(packageDocument.scripts.start, /generate-data-foundation/);
  assert.equal(packageDocument.scripts.prepare, undefined);
  assert.equal(packageDocument.scripts.postinstall, undefined);
});

test("no village or kelurahan code occurs in two districts", () => {
  const settlements = regions.filter((region) => villageTypes.has(region.administrative_type));
  assert.equal(new Set(settlements.map((region) => region.code)).size, settlements.length);
  assert.equal(new Set(settlements.map((region) => `${region.parent_id}:${region.code}`)).size, settlements.length);
});

test("Kurik and spelling variants use verified parent relations", () => {
  const kurik = regions.find((region) => region.name === "Kurik" && region.administrative_type === "district");
  const forbidden = new Set(["Amunkay", "Hidup Baru", "Isano Mbias", "Yaba Maru", "Wasur", "Nasem", "Rawa Biru", "Urumb"]);
  const kurikNames = new Set(regions.filter((region) => region.parent_id === kurik.id).map((region) => region.name));
  forbidden.forEach((name) => assert.equal(kurikNames.has(name), false, `${name} must not be in Kurik`));
  const wananggab = regions.find((region) => region.aliases?.includes("Waniggap Kai"));
  assert.equal(wananggab?.canonical_name, "Waninggap Kai");
  assert.equal(regionById.get(wananggab?.parent_id)?.name, "Semangga");
});

test("all agricultural records reference valid region, season and commodity IDs", () => {
  for (const records of [land.records, season.records, production.records]) {
    for (const record of records) {
      assert.ok(regionById.has(record.region_id));
      assert.ok(seasons.has(record.season_id));
      assert.ok(commodities.has(record.commodity_id));
      assert.ok(villageTypes.has(regionById.get(record.region_id).administrative_type));
      assert.equal(record.monitoring_status, "active");
    }
  }
});

test("land, planting and production records align one-to-one per season and region", () => {
  assert.deepEqual([...landById.keys()].sort(), [...seasonById.keys()].sort());
  assert.deepEqual([...landById.keys()].sort(), [...productionById.keys()].sort());
  for (const [id, landRecord] of landById) {
    const planting = seasonById.get(id);
    const result = productionById.get(id);
    assert.equal(landRecord.season_id, planting.season_id);
    assert.equal(landRecord.season_id, result.season_id);
    assert.ok(result.harvested_area_ha <= planting.planting_realization_ha);
    assert.ok(planting.planting_realization_ha <= planting.planting_target_ha);
    assert.ok(planting.planting_target_ha <= landRecord.active_land_ha);
    assert.ok(landRecord.active_land_ha <= landRecord.mapped_land_ha);
  }
});

test("village totals aggregate exactly to canonical district and regency totals", () => {
  for (const seasonId of seasons) {
    const actual = totals(seasonId);
    const expected = { ...reference.canonical_totals[seasonId] };
    delete expected.loss_rate;
    assert.deepEqual(actual, expected);
    const districts = regions.filter((region) => region.administrative_type === "district");
    for (const district of districts) {
      const childIds = new Set(regions.filter((region) => region.parent_id === district.id).map((region) => region.id));
      for (const [records, field] of [
        [land.records, "mapped_land_ha"],
        [season.records, "planting_realization_ha"],
        [production.records, "gkg_production_ton"],
      ]) {
        const districtTotal = approved(records, seasonId)
          .filter((record) => childIds.has(record.region_id))
          .reduce((total, record) => total + record[field], 0);
        assert.ok(districtTotal >= 0);
      }
    }
  }
});

test("season snapshots are cumulative and their final actual equals canonical totals", () => {
  for (const seasonId of seasons) {
    const rows = season.snapshots.filter((row) => row.season_id === seasonId && row.kind === "actual");
    assert.ok(rows.length > 0);
    for (let index = 1; index < rows.length; index++) {
      assert.ok(rows[index].planting_realization_ha >= rows[index - 1].planting_realization_ha);
      assert.ok(rows[index].harvested_area_ha >= rows[index - 1].harvested_area_ha);
      assert.ok(rows[index].gkg_production_ton >= rows[index - 1].gkg_production_ton);
    }
    const last = rows.at(-1);
    const expected = reference.canonical_totals[seasonId];
    assert.equal(last.planting_realization_ha, expected.planting_realization_ha);
    assert.equal(last.harvested_area_ha, expected.harvested_area_ha);
    assert.equal(last.gkg_production_ton, expected.gkg_production_ton);
  }
});

test("default snapshot selector contract resolves MT I to March and MT II to July", async () => {
  for (const [seasonId, expectedPeriod] of [["MT1-2026", "2026-03"], ["MT2-2026", "2026-07"]]) {
    const seasonMeta = reference.seasons.find((item) => item.season_id === seasonId);
    const actuals = season.snapshots
      .filter((row) => row.season_id === seasonId && row.kind === "actual" && row.period <= seasonMeta.reporting_cutoff.slice(0, 7))
      .sort((a, b) => a.period_end.localeCompare(b.period_end));
    assert.equal(actuals.at(-1).period, expectedPeriod);
  }
  const selectorSource = await readFile("lib/data-foundation.ts", "utf8");
  assert.match(selectorSource, /getDefaultSeasonSnapshot/);
  assert.match(selectorSource, /snapshot\.period <= cutoffPeriod/);
  assert.match(selectorSource, /snapshot\.kind === "actual"/);
});

test("MT II actuals stop at cutoff and later entries are target or projection", () => {
  const cutoff = reference.seasons.find((item) => item.season_id === "MT2-2026").reporting_cutoff.slice(0, 7);
  const actuals = season.snapshots.filter((row) => row.season_id === "MT2-2026" && row.kind === "actual");
  assert.equal(actuals.at(-1).period, cutoff);
  assert.ok(season.future_targets_and_projections.every((row) => row.kind === "target" || row.kind === "projection"));
  assert.ok(season.future_targets_and_projections.every((row) => row.period > cutoff));
});

test("standard calculations produce the required canonical results", () => {
  const mt1 = totals("MT1-2026");
  const mt2 = totals("MT2-2026");
  const rate = reference.milling_yield.rate / 100;
  assert.equal(Number((mt1.planting_realization_ha / mt1.planting_target_ha * 100).toFixed(1)), 96.2);
  assert.equal(Number((mt2.planting_realization_ha / mt2.planting_target_ha * 100).toFixed(1)), 89.5);
  assert.equal(Number((mt1.gkg_production_ton / mt1.harvested_area_ha).toFixed(2)), 5.48);
  assert.equal(Number((mt2.gkg_production_ton / mt2.harvested_area_ha).toFixed(2)), 5.48);
  assert.equal(Number((mt1.gkg_production_ton / mt1.gkg_production_target_ton * 100).toFixed(1)), 99.1);
  assert.equal(Number((mt2.gkg_production_ton / mt2.gkg_production_target_ton * 100).toFixed(1)), 88.5);
  assert.equal(Math.round(mt1.gkg_production_ton * rate), 116270);
  assert.equal(Math.round(mt2.gkg_production_ton * rate), 110664);
  assert.equal(Math.round(mt1.gkg_production_ton * 0.045), 8254);
  assert.equal(Math.round(mt2.gkg_production_ton * 0.045), 7856);
});

test("phase and risk compositions cover exactly 100 percent of approved planting area", () => {
  const records = approved(season.records, "MT2-2026");
  for (const field of ["phase", "risk"]) {
    const total = sum(records, "planting_realization_ha");
    const grouped = Map.groupBy(records, (record) => record[field]);
    const percentage = [...grouped.values()]
      .map((rows) => sum(rows, "planting_realization_ha") / total * 100)
      .reduce((value, item) => value + item, 0);
    assert.ok(Math.abs(percentage - 100) <= 0.1);
  }
});

test("only approved records form executive KPI totals", () => {
  const withDraft = [...production.records, {
    ...production.records[0],
    id: "draft-control",
    validation_status: "draft",
    gkg_production_ton: 999999,
  }];
  assert.equal(
    sum(approved(withDraft, "MT1-2026"), "gkg_production_ton"),
    reference.canonical_totals["MT1-2026"].gkg_production_ton,
  );
});

test("deprecated conflict values are absent from active source and main components use shared selectors", async () => {
  const paths = [];
  for await (const path of glob(["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "data/**/*.json"])) {
    paths.push(path);
  }
  const source = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b35240\b|35\.240|198750|198\.750|109111|109\.111|62[,.]5%|156820|156\.820/);
  assert.doesNotMatch(source, /×\s*(?:3\.05|4\.95)|61[,.]6%|78 kampung/);
  for (const path of [
    "components/overview/ExecutiveDashboard.tsx",
    "components/season/SeasonPage.tsx",
    "components/production/ProductionPage.tsx",
    "app/page.tsx",
  ]) {
    const component = await readFile(path, "utf8");
    assert.match(component, /data-foundation|production-data|season-aggregations/);
  }
});
