import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const regions = (await readJson("data/master/regions.json")).regions;
const reference = await readJson("data/master/data-foundation.json");
const seasonData = await readJson("data/monitoring/season-monitoring.json");

async function loadTsModule(path, preamble = "") {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import .*;$/gm, "");
  return import(`data:text/javascript;base64,${Buffer.from(`${preamble}\n${output}`).toString("base64")}`);
}

const interaction = await loadTsModule("lib/executive-map-interaction.ts");
const regionSearch = await loadTsModule("lib/map-region-search.ts");
const chart = await loadTsModule("lib/chart-data.ts", `
const seasonSnapshots=${JSON.stringify(seasonData.snapshots)};
const futureTargetsAndProjections=${JSON.stringify(seasonData.future_targets_and_projections)};
const seasonMeta=${JSON.stringify(reference.seasons)};
const getSeasonById=id=>seasonMeta.find(row=>row.season_id===id)||null;
`);
const visual = await loadTsModule("lib/visualization.ts");

test("executive label priority executes hover, focus, selected and idle states", () => {
  const state = (hoveredRegionId, focusedRegionId, selectedRegionId) => interaction.displayedExecutiveRegionId({ hoveredRegionId, focusedRegionId, selectedRegionId });
  assert.equal(state(null, null, null), null);
  assert.equal(state("93.01.02", null, null), "93.01.02");
  assert.equal(state(null, "93.01.03", "93.01.05"), "93.01.03");
  assert.equal(state("93.01.02", "93.01.03", "93.01.05"), "93.01.02");
  assert.equal(state(null, null, "93.01.05"), "93.01.05");
});

test("pointer leave and blur independently fall back through production priority", () => {
  const selectedRegionId = "93.01.05";
  assert.equal(interaction.displayedExecutiveRegionId({ hoveredRegionId: "93.01.02", focusedRegionId: "93.01.03", selectedRegionId }), "93.01.02");
  assert.equal(interaction.displayedExecutiveRegionId({ hoveredRegionId: null, focusedRegionId: "93.01.03", selectedRegionId }), "93.01.03");
  assert.equal(interaction.displayedExecutiveRegionId({ hoveredRegionId: null, focusedRegionId: null, selectedRegionId }), selectedRegionId);
});

test("map search production selector derives one regency and 22 official districts", () => {
  const options = regionSearch.createMapRegionOptions(regions);
  assert.equal(options.length, 23);
  assert.equal(new Set(options.map(option => option.id)).size, 23);
  assert.equal(options.filter(option => option.typeLabel === "Kabupaten").length, 1);
  assert.equal(options.filter(option => option.typeLabel === "Distrik").length, 22);
  assert.deepEqual(regionSearch.filterMapRegionOptions(options, "SeMaNgGa"), [{ id: "93.01.05", name: "Semangga", typeLabel: "Distrik" }]);
  assert.deepEqual(regionSearch.filterMapRegionOptions(options, "wilayah-tidak-ada"), []);
  assert.equal(regionSearch.districtIdForMapRegion(options.find(option => option.id === "93.01.05")), "93.01.05");
  assert.equal(regionSearch.districtIdForMapRegion(options.find(option => option.id === "93.01")), null);
});

test("actual chart builders keep MT I projection-free and MT II projected", () => {
  const mt1 = chart.getChartDataPoints("MT1-2026", "gkg_production_ton", 185000);
  const mt2 = chart.getChartDataPoints("MT2-2026", "gkg_production_ton", 197220);
  assert.equal(mt1.some(point => point.projection !== null), false);
  assert.equal(mt2.some(point => point.projection !== null), true);
  assert.ok(visual.chartValueLabels(mt1).length <= 3);
  assert.ok(visual.chartValueLabels(mt2).length <= 3);
  const labels = visual.positionChartValueLabels(visual.chartValueLabels(mt2).map((label, index) => ({ ...label, text: String(label.value), anchorX: 100 + index * 120, anchorY: 100 })), { left: 0, right: 760, top: 0, bottom: 330 });
  assert.equal(labels.some((label, index) => labels.some((other, otherIndex) => index !== otherIndex && label.x < other.x + other.width && label.x + label.width > other.x && label.y < other.y + other.height && label.y + label.height > other.y)), false);
});

test("source audit only verifies production helpers and presentation variant are wired", async () => {
  const [executive, page, chartComponent, seasonComponent] = await Promise.all([
    readFile("components/overview/ExecutiveDashboard.tsx", "utf8"),
    readFile("app/page.tsx", "utf8"),
    readFile("components/production/ProductionTrendChart.tsx", "utf8"),
    readFile("components/season/SeasonProgressChart.tsx", "utf8"),
  ]);
  assert.match(executive, /displayedExecutiveRegionId/);
  assert.match(page, /createMapRegionOptions|filterMapRegionOptions|districtIdForMapRegion/);
  assert.match(chartComponent, /presentation="production"/);
  assert.doesNotMatch(seasonComponent, /presentation="production"/);
});
