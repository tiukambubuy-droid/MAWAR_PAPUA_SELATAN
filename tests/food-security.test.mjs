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

test("food availability chart uses seasonal selector results without invented projection", async () => {
  const mt1 = selector.getFoodSecurityChartData("MT1-2026", "93.01");
  const mt2 = selector.getFoodSecurityChartData("MT2-2026", "93.01");
  assert.deepEqual(mt1.map(point => point.label), ["Okt 2025","Nov 2025","Des 2025","Jan 2026","Feb 2026","Mar 2026"]);
  assert.deepEqual(mt2.map(point => point.label), ["Apr 2026","Mei 2026","Jun 2026","Jul 2026","Agu 2026","Sep 2026"]);
  assert.deepEqual(mt1.map(point => point.stageIndex),[1,2,3,4,5,6]);
  assert.ok(mt1.every(point => point.actual !== null && point.projection === null));
  assert.ok(mt2.slice(0,4).every(point => point.actual !== null));
  assert.ok(mt2.slice(4).every(point => point.actual === null && point.projection === null));
  assert.ok(Math.abs(mt1.at(-1).actual-selector.selectFoodSecurity("MT1-2026").aggregate.balanceAvailabilityTon)<1e-5);
  assert.ok(Math.abs(mt2[3].target-selector.selectFoodSecurity("MT2-2026").aggregate.seasonNeedTon)<1e-5);
  assert.ok(mt1.every(point => point.label !== "MT"));
  const page = await readFile("components/food-security/FoodSecurityPage.tsx", "utf8");
  assert.match(page, /MonitoringLineChart/);
  assert.match(page, /showSummaryStrip/);
  assert.doesNotMatch(page, /balance-bars/);
});

test("stock breakdown is canonical and never synthesized", () => {
  const metrics=selector.selectFoodSecurity("MT2-2026").aggregate;
  assert.equal(metrics.bulogStockTon+metrics.governmentReserveTon+metrics.localWarehouseStockTon,metrics.physicalStockTon);
  assert.equal(metrics.physicalStockTon,10240);
});

test("monthly snapshots cover county and every monitored district with reconciled deterministic stages", () => {
  const districtIds = ["93.01.01", "93.01.05", "93.01.06", "93.01.07", "93.01.11", "93.01.14"];
  const scopeIds = ["93.01", ...districtIds];
  const expectedPeriods = {
    "MT1-2026": ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"],
    "MT2-2026": ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  };
  const snapshots = selector.foodSecurityMonthlySnapshots;
  assert.equal(snapshots.length, 84);
  assert.equal(new Set(snapshots.map(row => row.id)).size, snapshots.length);
  for (const regionId of scopeIds) for (const seasonId of Object.keys(expectedPeriods)) {
    const rows = snapshots.filter(row => row.region_id === regionId && row.season_id === seasonId);
    assert.equal(rows.length, 6, `${regionId} ${seasonId}`);
    assert.deepEqual(rows.map(row => row.period), expectedPeriods[seasonId]);
    assert.deepEqual(rows.map(row => row.stage_index), [1, 2, 3, 4, 5, 6]);
    assert.ok(rows.flatMap(row => [row.availability_balance_ton, row.period_need_ton, row.physical_stock_ton, row.surplus_deficit_ton]).every(value => value === null || Number.isFinite(value)));
    const metrics = selector.selectFoodSecurity(seasonId, regionId).aggregate;
    const cutoff = rows.filter(row => row.status === "actual").at(-1);
    assert.ok(Math.abs(cutoff.physical_stock_ton - metrics.physicalStockTon) < 1e-8);
    assert.ok(Math.abs(cutoff.availability_balance_ton - metrics.balanceAvailabilityTon) < 1e-8);
    assert.ok(Math.abs(cutoff.period_need_ton - metrics.seasonNeedTon) < 1e-8);
    assert.ok(Math.abs(cutoff.surplus_deficit_ton - metrics.surplusDeficitTon) < 1e-8);
    assert.ok(rows.every(row => row.surplus_deficit_ton === null || Math.abs(row.surplus_deficit_ton - (row.availability_balance_ton - row.period_need_ton)) < 1e-8));
    if (seasonId === "MT2-2026") {
      assert.ok(rows.slice(0, 4).every(row => row.status === "actual"));
      assert.ok(rows.slice(4).every(row => row.status === "not_available" && row.availability_balance_ton === null && row.period_need_ton === null && row.physical_stock_ton === null));
    }
  }
  for (const seasonId of Object.keys(expectedPeriods)) for (let stage = 1; stage <= 6; stage++) {
    const county = snapshots.find(row => row.region_id === "93.01" && row.season_id === seasonId && row.stage_index === stage);
    const children = snapshots.filter(row => districtIds.includes(row.region_id) && row.season_id === seasonId && row.stage_index === stage);
    for (const field of ["physical_stock_ton", "availability_balance_ton", "period_need_ton", "surplus_deficit_ton"]) {
      if (county[field] === null) assert.ok(children.every(row => row[field] === null));
      else assert.ok(Math.abs(county[field] - children.reduce((sum, row) => sum + row[field], 0)) < 1e-8);
    }
  }
  assert.equal(selector.getFoodSecurityChartData("MT1-2026", "93.01.02").length, 0);
  assert.notDeepEqual(selector.getFoodSecurityChartData("MT2-2026", districtIds[0]), selector.getFoodSecurityChartData("MT2-2026", districtIds[1]));
  assert.doesNotMatch(source, /Math\.random|seededNumber/);
});
