import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const food = JSON.parse(await readFile("data/monitoring/food-security-monitoring.json", "utf8"));
const master = JSON.parse(await readFile("data/master/data-foundation.json", "utf8"));
const regionData = JSON.parse(await readFile("data/master/regions.json", "utf8"));
const production = JSON.parse(await readFile("data/monitoring/production-monitoring.json", "utf8"));
const source = await readFile("lib/food-security-data.ts", "utf8");
const preamble = `
const foodSecurityJson=${JSON.stringify(food)};
const regions=${JSON.stringify(regionData.regions)};
const millingYield=${JSON.stringify(master.milling_yield)};
const seasons=${JSON.stringify(master.seasons)};
const productionRecords=${JSON.stringify(production.records)};
const getSeasonById=id=>seasons.find(row=>row.season_id===id)||null;
const descendants=id=>{const direct=regions.filter(row=>row.parent_id===id);return [...direct,...direct.flatMap(row=>descendants(row.id))]};
const aggregateRegion=(id,seasonId)=>{const ids=new Set([id,...descendants(id).map(row=>row.id)]);return productionRecords.filter(row=>row.season_id===seasonId&&ids.has(row.region_id)&&row.validation_status==='approved').reduce((a,row)=>({gkg_production_ton:a.gkg_production_ton+row.gkg_production_ton}),{gkg_production_ton:0})};
`;
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import .*;$/gm, "");
const selector = await import(`data:text/javascript;base64,${Buffer.from(preableSafe(preamble) + output).toString("base64")}`);

function preableSafe(value) { return value; }

test("food security records use canonical IDs, local simulation metadata, and non-negative inputs", () => {
  const seasonIds = new Set(master.seasons.map(row => row.season_id));
  const regionIds = new Set(regionData.regions.map(row => row.id));
  assert.equal(food.metadata.data_type, "simulation");
  assert.equal(food.records.length, 12);
  for (const record of food.records) {
    assert.ok(seasonIds.has(record.season_id));
    assert.ok(regionIds.has(record.region_id));
    assert.equal(record.region_level, "district");
    assert.equal(record.commodity_id, "PADI");
    assert.equal(record.data_type, "simulation");
    assert.equal(record.source_type, "prototype");
    for (const field of ["population","annual_consumption_kg_per_capita","bulog_stock_ton","government_reserve_ton","local_warehouse_stock_ton","inbound_supply_ton","outbound_supply_ton","operational_loss_ton"]) assert.ok(record[field] >= 0);
  }
});

test("production selector calculates stock, need, balance, resilience, and canonical milling yield", () => {
  const record = selector.foodSecurityRecords.find(row => row.id === "FS-MT2-0105");
  const result = selector.calculateFoodSecurity(record);
  assert.equal(result.physicalStockTon, record.bulog_stock_ton + record.government_reserve_ton + record.local_warehouse_stock_ton);
  assert.equal(result.annualNeedTon, record.population * record.annual_consumption_kg_per_capita / 1000);
  assert.equal(result.balanceAvailabilityTon, result.physicalStockTon + result.estimatedRiceProductionTon + record.inbound_supply_ton - record.outbound_supply_ton - record.operational_loss_ton);
  assert.equal(result.surplusDeficitTon, result.balanceAvailabilityTon - result.seasonNeedTon);
  assert.equal(result.stockResilienceDays, result.physicalStockTon / (result.annualNeedTon / 365));
  assert.equal(master.milling_yield.rate, 63.39);
  assert.equal(result.estimatedRiceProductionTon, production.records.filter(row => row.season_id === record.season_id && regionData.regions.find(region => region.id === row.region_id)?.parent_id === record.region_id && row.validation_status === "approved").reduce((sum, row) => sum + row.gkg_production_ton, 0) * 0.6339);
});

test("district aggregation, zero/null/not-monitored states, and simulation disclaimer remain distinct", () => {
  const all = selector.selectFoodSecurity("MT2-2026", "93.01");
  const one = selector.selectFoodSecurity("MT2-2026", "93.01.05");
  assert.equal(all.items.length, 6);
  assert.equal(one.items.length, 1);
  assert.equal(selector.selectFoodSecurity("MT2-2026", "93.01.02").monitored, false);
  const invalid = { ...selector.foodSecurityRecords[0], monitoring_status: "not_monitored" };
  assert.equal(selector.calculateFoodSecurity(invalid), null);
  assert.equal(selector.formatFoodValue(0), "0 ton");
  assert.equal(selector.formatFoodValue(null), "Belum tersedia");
  assert.match(selector.resilienceDisclaimer, /bukan IKP resmi Badan Pangan Nasional/);
});

test("food security page keeps global filters and accessible modal contract", async () => {
  const [page, shell] = await Promise.all([readFile("components/food-security/FoodSecurityPage.tsx", "utf8"), readFile("app/page.tsx", "utf8")]);
  assert.match(page, /useDashboardFilters/);
  assert.match(page, /useAccessibleModal/);
  assert.match(page, /role="dialog" aria-modal="true"/);
  assert.match(page, /resilienceDisclaimer/);
  assert.match(shell, /Buka halaman \$\{label\}/);
  assert.match(shell, /Ketahanan Pangan/);
});
