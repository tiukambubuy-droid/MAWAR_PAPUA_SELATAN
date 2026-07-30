import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const reference = await readJson("data/master/data-foundation.json");
const regions = (await readJson("data/master/regions.json")).regions;
const seasons = await readJson("data/monitoring/season-monitoring.json");
const production = await readJson("data/monitoring/production-monitoring.json");
const byId = new Map(regions.map(region => [region.id, region]));

async function loadTsModule(path, preamble = "") {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/^import .*;$/gm, "");
  return import(`data:text/javascript;base64,${Buffer.from(`${preamble}\n${transpiled}`).toString("base64")}`);
}

const filterPreamble = `
const seasons=${JSON.stringify(reference.seasons)};
const regions=${JSON.stringify(regions)};
const snapshots=${JSON.stringify(seasons.snapshots)};
const getSeasonById=id=>seasons.find(row=>row.season_id===id)||null;
const getRegionById=id=>regions.find(row=>row.id===id)||null;
const seasonSnapshots=snapshots;
const getDefaultSeasonSnapshot=id=>snapshots.filter(row=>row.season_id===id&&row.kind==="actual").at(-1)||null;
`;
const filterModule = await loadTsModule("lib/dashboard-filters.ts", filterPreamble);

const chartPreamble = `
const seasonSnapshots=${JSON.stringify(seasons.snapshots)};
const futureTargetsAndProjections=${JSON.stringify(seasons.future_targets_and_projections)};
const seasonMeta=${JSON.stringify(reference.seasons)};
const getSeasonById=id=>seasonMeta.find(row=>row.season_id===id)||null;
`;
const chartModule = await loadTsModule("lib/chart-data.ts", chartPreamble);

const mapPreamble = `
const regions=${JSON.stringify(regions)};
const seasonRecords=${JSON.stringify(seasons.records)};
const getRegionById=id=>regions.find(row=>row.id===id)||null;
const getChildrenByRegionId=id=>regions.filter(row=>row.parent_id===id);
`;
const mapModule = await loadTsModule("lib/map-monitoring.ts", mapPreamble);
const insightModule = await loadTsModule("lib/system-insights.ts");

const totals = seasonId => production.records
  .filter(row => row.season_id === seasonId && row.validation_status === "approved")
  .reduce((sum, row) => sum + row.gkg_production_ton, 0);

test("global filter defaults and persistence contract are versioned", async () => {
  const source = await readFile("lib/dashboard-filters.ts", "utf8");
  assert.match(source, /seasonId:\s*"MT2-2026"/);
  assert.match(source, /provinceId:\s*"93"/);
  assert.match(source, /regencyId:\s*"93.01"/);
  assert.match(source, /districtId:\s*null/);
  assert.match(source, /mawar-dashboard-filters-v1/);
});

test("URL restoration is applied after session restoration and uses IDs", async () => {
  const provider = await readFile("components/DashboardFilterProvider.tsx", "utf8");
  assert.match(provider, /sessionStorage\.getItem[\s\S]*resolveInitialDashboardFilters\(params, restored\)/);
  assert.match(provider, /commitFilters\(.*"push"/s);
  assert.match(provider, /popstate/);
  assert.match(provider, /setDistrict:.*villageId:\s*null/s);
});

test("initial filter resolution executes URL/session/default priority", () => {
  const session = { ...filterModule.defaultDashboardFilters(), districtId: "93.01.05" };
  assert.equal(filterModule.resolveInitialDashboardFilters(new URLSearchParams(), session).districtId, "93.01.05");
  assert.equal(filterModule.resolveInitialDashboardFilters(new URLSearchParams("season=INVALID"), session).districtId, "93.01.05");
  assert.equal(filterModule.resolveInitialDashboardFilters(new URLSearchParams("season=MT1-2026&district=93.01.14"), session).districtId, "93.01.14");
  assert.equal(filterModule.resolveInitialDashboardFilters(new URLSearchParams(), { seasonId: "BROKEN" }).seasonId, "MT2-2026");
  assert.equal(filterModule.resolveInitialDashboardFilters(new URLSearchParams(), null).seasonId, "MT2-2026");
});

test("filter validation accepts valid hierarchy and rejects cross-parent village", () => {
  const valid = filterModule.validateDashboardFilters({ districtId: "93.01.14", villageId: "93.01.14.2001" });
  assert.equal(valid.villageId, "93.01.14.2001");
  const invalid = filterModule.validateDashboardFilters({ districtId: "93.01.14", villageId: "93.01.01.1002" });
  assert.equal(invalid.villageId, null);
});

test("history transition policy distinguishes user, normalization, and popstate", () => {
  assert.equal(filterModule.dashboardHistoryMethod("push"), "pushState");
  assert.equal(filterModule.dashboardHistoryMethod("replace"), "replaceState");
  assert.equal(filterModule.dashboardHistoryMethod("popstate"), null);
});

test("invalid hierarchy cannot place a village under another district", () => {
  for (const region of regions.filter(row => ["kampung", "kelurahan"].includes(row.administrative_type))) {
    assert.equal(byId.get(region.parent_id)?.administrative_type, "district");
  }
});

test("MT I and MT II produce different canonical production KPI", () => {
  assert.equal(totals("MT1-2026"), 183420);
  assert.equal(totals("MT2-2026"), 174577);
  assert.notEqual(totals("MT1-2026"), totals("MT2-2026"));
});

test("different monitored districts produce different aggregates", () => {
  const active = regions.filter(row => row.administrative_type === "district" && row.monitoring_status === "active");
  const districtTotal = district => {
    const children = new Set(regions.filter(row => row.parent_id === district.id).map(row => row.id));
    return production.records.filter(row => row.season_id === "MT2-2026" && children.has(row.region_id)).reduce((sum, row) => sum + row.gkg_production_ton, 0);
  };
  assert.notEqual(districtTotal(active[0]), districtTotal(active[1]));
});

test("not monitored regions are explicitly distinguished from verified zero", () => {
  assert.ok(regions.some(row => row.monitoring_status === "not_monitored"));
  assert.ok(regions.filter(row => row.monitoring_status === "not_monitored").every(row =>
    !production.records.some(record => record.region_id === row.id && record.validation_status === "approved"),
  ));
});

test("default snapshots are March for MT I and July for MT II and never projection", () => {
  for (const [seasonId, expected] of [["MT1-2026", "2026-03"], ["MT2-2026", "2026-07"]]) {
    const meta = reference.seasons.find(row => row.season_id === seasonId);
    const actuals = seasons.snapshots.filter(row => row.season_id === seasonId && row.kind === "actual" && row.period <= meta.reporting_cutoff.slice(0, 7));
    assert.equal(actuals.at(-1).period, expected);
    assert.equal(actuals.at(-1).kind, "actual");
  }
});

test("stage 4 comparison uses January MT I against July MT II", async () => {
  const source = await readFile("lib/chart-data.ts", "utf8");
  assert.match(source, /"2026-01".*"2026-02".*"2026-03"/s);
  assert.match(source, /"2026-04".*"2026-05".*"2026-06".*"2026-07"/s);
  assert.match(source, /compareActualAtEquivalentStage/);
  assert.match(source, /compareProjectedFinalToCompletedSeason/);
});

test("equivalent-stage selector executes canonical Stage 4 calculations", () => {
  const planting = chartModule.compareActualAtEquivalentStage("MT1-2026", "MT2-2026", 4, "planting_realization_ha");
  const gkg = chartModule.compareActualAtEquivalentStage("MT1-2026", "MT2-2026", 4, "gkg_production_ton");
  assert.equal(Number(((planting.right - planting.left) / planting.left * 100).toFixed(2)), 20.82);
  assert.equal(Number(((gkg.right - gkg.left) / gkg.left * 100).toFixed(2)), 224.49);
  const final = chartModule.compareProjectedFinalToCompletedSeason();
  assert.equal(final.actual, 183420);
  assert.ok(final.projection > 0);
});

test("chart contract keeps all series on one stageIndex and stops actual at cutoff", async () => {
  const source = await readFile("lib/chart-data.ts", "utf8");
  assert.match(source, /stageIndex:\s*index \+ 1/);
  assert.match(source, /!afterCutoff && actualRow/);
  assert.match(source, /afterCutoff && projectionRow/);
  assert.match(source, /isCutoff:\s*period === cutoff/);
});

test("chart builder executes actual/projection and tooltip labels per season", () => {
  const mt1 = chartModule.getChartDataPoints("MT1-2026", "gkg_production_ton", 185000);
  const mt2 = chartModule.getChartDataPoints("MT2-2026", "gkg_production_ton", 197220);
  assert.equal(mt1.at(-1).label, "Mar 2026");
  assert.equal(mt1.some(point => point.projection !== null), false);
  assert.equal(mt2.find(point => point.isCutoff).label, "Jul 2026");
  assert.equal(mt2.filter(point => point.actual !== null).at(-1).period, "2026-07");
  assert.ok(mt2.filter(point => point.period > "2026-07").every(point => point.actual === null));
  assert.ok(mt2.some(point => point.projection !== null));
});

test("phase and risk selectors execute season-scoped 100 percent composition", () => {
  for (const selector of [mapModule.selectPhaseMonitoring, mapModule.selectRiskMonitoring]) {
    const mt1 = selector("MT1-2026", "93.01.14", "MT1-2026:2026-03");
    const mt2 = selector("MT2-2026", "93.01.14", "MT2-2026:2026-07");
    assert.equal(mt1.seasonId, "MT1-2026");
    assert.equal(mt2.seasonId, "MT2-2026");
    assert.equal(Number(Object.values(mt1.composition).reduce((a, b) => a + b, 0).toFixed(8)), 100);
    assert.equal(Number(Object.values(mt2.composition).reduce((a, b) => a + b, 0).toFixed(8)), 100);
  }
});

test("breadcrumb reducer executes parent resets", () => {
  const current = { districtId: "93.01.14", villageId: "93.01.14.2001" };
  assert.deepEqual(mapModule.reduceMapBreadcrumb("regency", current), { districtId: null, villageId: null });
  assert.deepEqual(mapModule.reduceMapBreadcrumb("district", current), { districtId: "93.01.14", villageId: null });
});

test("all three dashboard charts consume shared ChartDataPoint builder", async () => {
  for (const path of [
    "components/overview/ExecutiveDashboard.tsx",
    "components/season/SeasonProgressChart.tsx",
    "components/production/ProductionTrendChart.tsx",
  ]) {
    assert.match(await readFile(path, "utf8"), /getChartDataPoints/);
  }
});

test("production conversion is a flow and loss stays separate", async () => {
  const source = await readFile("components/production/ProductionComposition.tsx", "utf8");
  assert.match(source, /ALUR KONVERSI PRODUKSI/);
  assert.match(source, /Input: Produksi GKG/);
  assert.match(source, /Output: Estimasi Beras/);
  assert.match(source, /Estimasi Susut \(indikator terpisah\)/);
  assert.doesNotMatch(source, /observed|gkgPct|ricePct|lossPct/);
});

test("rule engine implements all four thresholds and non-AI disclaimer", async () => {
  const source = await readFile("lib/system-insights.ts", "utf8");
  for (const threshold of ["value >= 95", "value >= 85", "value >= 70"]) assert.ok(source.includes(threshold));
  assert.match(source, /Perlu Intervensi/);
  assert.match(source, /bukan menggunakan AI generatif/);
});

test("insight threshold function executes exact boundaries", () => {
  for (const [value, severity] of [[95, "success"], [94.9, "info"], [85, "info"], [84.9, "warning"], [70, "warning"], [69.9, "danger"]]) {
    assert.equal(insightModule.achievementCategory(value).severity, severity);
  }
  assert.doesNotMatch(insightModule.buildAchievementInsight("production", 88.5).description, /banjir|hama|kekeringan|irigasi|pupuk/i);
});

test("empty-state implementations keep total zero and hide pagination", async () => {
  const sources = await Promise.all([
    "app/page.tsx", "components/season/SeasonMonitoringTable.tsx", "components/production/ProductionTable.tsx",
  ].map(path => readFile(path, "utf8")));
  for (const source of sources) assert.match(source, /Tidak ada data sesuai filter/);
  assert.match(sources[1], /filtered\.length > 0/);
  assert.match(sources[2], /filtered\.length > 0/);
});

test("active UI source has no invalid season label, raw NaN, or legacy composition", async () => {
  const paths = [
    "components/overview/ExecutiveDashboard.tsx", "components/season/SeasonPage.tsx",
    "components/production/ProductionPage.tsx", "components/production/ProductionComposition.tsx",
  ];
  const source = (await Promise.all(paths.map(path => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /Januari.{0,3}Juli 2026/);
  assert.doesNotMatch(source, /GKG \+ beras \+ susut/i);
  assert.doesNotMatch(source, />\s*(?:NaN|undefined)\s*</);
});
