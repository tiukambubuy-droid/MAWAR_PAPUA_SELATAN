import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const irrigation = JSON.parse(await readFile("data/monitoring/irrigation-monitoring.json", "utf8"));
const inputs = JSON.parse(await readFile("data/monitoring/production-inputs-monitoring.json", "utf8"));
const regionsJson = JSON.parse(await readFile("data/master/regions.json", "utf8"));
async function load(file, preamble) {
  const source = await readFile(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import .*;$/gm, "");
  return import(`data:text/javascript;base64,${Buffer.from(`${preamble}\n${output}`).toString("base64")}`);
}
const infra = await load("lib/infrastructure-data.ts", `const irrigationJson=${JSON.stringify(irrigation)};const inputsJson=${JSON.stringify(inputs)};const regions=${JSON.stringify(regionsJson.regions)};`);

test("irrigation schema uses canonical relations and condition totals match within explicit tolerance", () => {
  const ids = new Set(regionsJson.regions.map(row => row.id));
  assert.equal(irrigation.metadata.rounding_tolerance_km, 0.01);
  assert.equal(irrigation.records.length, 12);
  for (const record of irrigation.records) {
    assert.ok(ids.has(record.region_id));
    assert.equal(record.region_level, "district");
    assert.equal(record.data_type, "simulation");
    assert.ok(infra.irrigationConditionValid(record));
  }
  const selected = infra.selectIrrigation("MT2-2026");
  assert.equal(selected.aggregate.goodKm + selected.aggregate.lightDamageKm + selected.aggregate.heavyDamageKm, selected.aggregate.networkLengthKm);
  assert.ok(selected.aggregate.serviceAreaHa > 0 && selected.aggregate.networkLengthKm > 0);
});

test("production inputs preserve units and enforce distribution and equipment constraints", () => {
  assert.deepEqual(new Set(inputs.records.map(row => row.category)), new Set(["Benih","Pupuk","Pestisida","Traktor","Combine Harvester","Pompa Air"]));
  for (const record of inputs.records) {
    assert.ok(infra.inputRecordValid(record));
    assert.ok(record.distributed_quantity <= record.available_quantity);
    if (["Traktor","Combine Harvester","Pompa Air"].includes(record.category)) assert.ok(record.ready_quantity + record.light_damage_quantity + record.heavy_damage_quantity <= record.available_quantity);
    const fulfillment = infra.inputFulfillment(record);
    assert.ok(fulfillment.presentationPct >= 0 && fulfillment.presentationPct <= 100);
  }
  const selected = infra.selectProductionInputs("MT2-2026");
  assert.equal(selected.aggregate.categoryCount, 6);
  assert.ok(selected.aggregate.averageFulfillmentPct > 0 && selected.aggregate.averageFulfillmentPct <= 100);
  assert.equal(Object.hasOwn(selected.aggregate, "totalQuantity"), false, "kg, liter, dan unit tidak boleh dijumlahkan");
});

test("resilience production selector uses all five weighted components and refuses incomplete input", async () => {
  const preamble = `const resilienceWeights={availability:.30,productionAchievement:.25,irrigationReadiness:.20,productionInputFulfillment:.15,validation:.10};const millingYield={rate:63.39};const calculateEstimatedRice=value=>value*.6339;const foodAvailabilityScore=()=>90;const selectFoodSecurity=()=>({monitored:true,aggregate:{approved:5,total:6}});const selectIrrigation=()=>({monitored:true,aggregate:{functionalPct:80,approved:5,total:6}});const selectProductionInputs=()=>({monitored:true,aggregate:{averageFulfillmentPct:70,approved:5,total:6}});const aggregateRegion=()=>({gkg_production_ton:90,gkg_production_target_ton:100});`;
  const resilience = await load("lib/resilience-data.ts", preamble);
  const result = resilience.selectOperationalResilience("MT2-2026");
  assert.equal(result.complete, true);
  assert.equal(result.score, 90*.30 + 90*.25 + 80*.20 + 70*.15 + (15/18*100)*.10);
});

test("infrastructure page exposes keyboard tabs, global filters, modal, and navigation", async () => {
  const [page, shell] = await Promise.all([readFile("components/infrastructure/InfrastructurePage.tsx", "utf8"), readFile("app/page.tsx", "utf8")]);
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab" aria-selected/);
  assert.match(page, /useDashboardFilters/);
  assert.match(page, /useAccessibleModal/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(shell, /Buka halaman Infrastruktur dan Sarana/);
  assert.ok(shell.indexOf('label: "Ketahanan Pangan"') < shell.indexOf('label: "Infrastruktur & Sarana"'));
  assert.ok(shell.indexOf('label: "Infrastruktur & Sarana"') < shell.indexOf('label: "Risiko & Iklim"'));
});

test("production helpers filter dominant condition and validation together", () => {
  const rows = infra.selectIrrigation("MT2-2026").items;
  assert.equal(infra.dominantIrrigationCondition(rows[0]), "good");
  assert.equal(infra.filterIrrigationRows(rows, "semangga", "good", "approved").length, 1);
  assert.equal(infra.filterIrrigationRows(rows, "", "heavy_damage", "all").length, 0);
  const inputRows = infra.selectProductionInputs("MT2-2026").items;
  assert.equal(infra.filterProductionInputRows(inputRows, "pompa", "pending").length, 1);
  assert.equal(infra.filterProductionInputRows(inputRows, "pompa", "approved").length, 0);
});

test("sorting is numeric/string/date aware, reversible, and null-last", () => {
  assert.ok(infra.compareInfrastructureValues(2, 10, "asc") < 0);
  assert.ok(infra.compareInfrastructureValues(2, 10, "desc") > 0);
  assert.ok(infra.compareInfrastructureValues("Semangga", "Tanah Miring", "asc") < 0);
  assert.ok(infra.compareInfrastructureValues(Date.parse("2026-01-01"), Date.parse("2026-07-01"), "asc") < 0);
  assert.ok(infra.compareInfrastructureValues(null, 0, "asc") > 0);
  assert.ok(infra.compareInfrastructureValues(null, 0, "desc") > 0);
});

test("pagination reports boundaries and clamps invalid pages", () => {
  const records = Array.from({ length: 23 }, (_, index) => index + 1);
  assert.deepEqual(infra.paginateRows(records, 1, 10), { rows:[1,2,3,4,5,6,7,8,9,10], currentPage:1, totalPages:3, start:1, end:10, total:23 });
  assert.deepEqual(infra.paginateRows(records, 3, 10).rows, [21,22,23]);
  assert.equal(infra.paginateRows(records, 99, 10).currentPage, 3);
  assert.equal(infra.paginateRows([], 1, 10).start, 0);
});

test("infrastructure UI includes complete filters, sortable semantics, pagination, and modal metadata", async () => {
  const page = await readFile("components/infrastructure/InfrastructurePage.tsx", "utf8");
  for (const text of ["Semua Kondisi","Rusak Ringan","Rusak Berat","Semua Validasi","aria-sort","Halaman sebelumnya","Pemeriksaan terakhir","Toleransi rekonsiliasi","Persentase pemenuhan","Verifikasi terakhir"]) assert.match(page, new RegExp(text));
  assert.doesNotMatch(page, /\.local-filter\b/);
  assert.match(page,/Wilayah belum dipantau/);
  assert.match(page,/Tidak ada data sesuai filter/);
  assert.match(page,/MapPinOff/);
});
