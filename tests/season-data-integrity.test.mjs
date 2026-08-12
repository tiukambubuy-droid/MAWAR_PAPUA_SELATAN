import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTsModule(path) {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const integrity = await loadTsModule("lib/season-data-integrity.ts");
const seasonData = JSON.parse(await readFile("data/monitoring/season-monitoring.json", "utf8"));
const regions = JSON.parse(await readFile("data/master/regions.json", "utf8")).regions;
const source = await readFile("lib/season-aggregations.ts", "utf8");
const summarySource = await readFile("components/season/SeasonSummaryCards.tsx", "utf8");

test("active farmer percentage uses canonical numerator and denominator", () => {
  const mt1 = integrity.getSeasonFarmerParticipation("MT1-2026", "93.01");
  const mt2 = integrity.getSeasonFarmerParticipation("MT2-2026", "93.01");
  assert.equal(integrity.calculateActiveFarmerPercentage(mt1.activeFarmers, mt1.targetFarmers).toFixed(1), "89.8");
  assert.equal(integrity.calculateActiveFarmerPercentage(mt2.activeFarmers, mt2.targetFarmers).toFixed(1), "83.5");
});

test("active farmer percentage distinguishes unavailable, invalid denominator, and verified zero", () => {
  assert.equal(integrity.calculateActiveFarmerPercentage(null, 10), null);
  assert.equal(integrity.calculateActiveFarmerPercentage(5, null), null);
  assert.equal(integrity.calculateActiveFarmerPercentage(5, 0), null);
  assert.equal(integrity.calculateActiveFarmerPercentage(Number.NaN, 10), null, "active NaN");
  assert.equal(integrity.calculateActiveFarmerPercentage(Number.POSITIVE_INFINITY, 10), null, "active Infinity");
  assert.equal(integrity.calculateActiveFarmerPercentage(Number.NEGATIVE_INFINITY, 10), null, "active -Infinity");
  assert.equal(integrity.calculateActiveFarmerPercentage(5, Number.NaN), null, "target NaN");
  assert.equal(integrity.calculateActiveFarmerPercentage(5, Number.POSITIVE_INFINITY), null, "target Infinity");
  assert.equal(integrity.calculateActiveFarmerPercentage(5, Number.NEGATIVE_INFINITY), null, "target -Infinity");
  assert.equal(integrity.calculateActiveFarmerPercentage(0, 10), 0);
});

test("production monitoringRows selector returns the same six unique monitored districts for both seasons", () => {
  const districtNames = regions.filter(region => region.administrative_type === "district" && region.parent_id === "93.01").map(region => region.name);
  const expected = ["Merauke", "Semangga", "Tanah Miring", "Jagebob", "Kurik", "Malind"];
  const beforeRecords = JSON.stringify(seasonData.records);
  const aggregateRegion = regionId => ({ region_id: regionId, planting_target_ha: 0, planting_realization_ha: 0, validation_rate: 0 });
  for (const seasonId of ["MT1-2026", "MT2-2026"]) {
    const input = { names: districtNames, scopeKey: "93.01", seasonId, regions, records: seasonData.records, aggregateRegion };
    const first = integrity.monitoringRows(input);
    const second = integrity.monitoringRows(input);
    assert.equal(first.length, 6, `${seasonId}: tepat enam row`);
    assert.deepEqual(first.map(row => row.name), expected, `${seasonId}: urutan distrik deterministik`);
    assert.equal(new Set(first.map(row => row.id)).size, 6, `${seasonId}: ID unik`);
    assert.ok(first.every(row => row.seasonId === seasonId && row.monitoringStatus === "active"), `${seasonId}: konteks/status benar`);
    assert.ok(first.every(row => seasonData.records.some(record => record.season_id === seasonId && record.region_id.startsWith(`${row.id}.`) && record.phase === row.phase)), `${seasonId}: fase berasal dari record distrik`);
    assert.deepEqual(second, first, `${seasonId}: pemanggilan berulang identik`);
  }
  assert.equal(JSON.stringify(seasonData.records), beforeRecords, "selector tidak memutasi source");
});

test("only six monitored districts have season records and unmonitored districts receive no fallback", () => {
  const monitored = regions.filter(region => region.administrative_type === "district" && region.monitoring_status === "active");
  assert.deepEqual(monitored.map(region => region.name), ["Merauke", "Semangga", "Tanah Miring", "Jagebob", "Kurik", "Malind"]);
  for (const seasonId of ["MT1-2026", "MT2-2026"]) {
    for (const district of monitored) assert.ok(seasonData.records.some(record => record.season_id === seasonId && record.region_id.startsWith(`${district.id}.`)));
  }
  for (const name of ["Animha", "Elikobal", "Ilwayab", "Kaptel", "Muting"]) {
    const district = regions.find(region => region.name === name && region.administrative_type === "district");
    assert.equal(district.monitoring_status, "not_monitored");
    assert.equal(integrity.getSeasonFarmerParticipation("MT2-2026", district.id), null);
  }
});

test("phase totals reconcile to canonical planting realization without mutation", () => {
  const before = JSON.stringify(seasonData.records);
  for (const [seasonId, expected] of [["MT1-2026", 35120], ["MT2-2026", 38180]]) {
    const records = seasonData.records.filter(record => record.season_id === seasonId);
    assert.equal(integrity.sumMonitoredPhaseArea(records), expected);
  }
  assert.equal(JSON.stringify(seasonData.records), before);
});

test("active season UI has no synthetic farmer, group, phase, or obsolete percentage fallback", () => {
  assert.doesNotMatch(source, /Math\.max\(1|\?\?\s*"Vegetatif"|seededNumber|Math\.random/);
  assert.doesNotMatch(summarySource, /97[.,]2|90[.,]5|percent\s*\+\s*1/);
});
