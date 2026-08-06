import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadVisualization() {
  const source = await readFile("lib/visualization.ts", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function loadController() {
  const source = await readFile("lib/big-map-request-controller.ts", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function executiveControllerHarness(controllerModule, remoteLoads, fallbackLoads = []) {
  let state = { features: [], sourceMode: "big", status: "loading", context: null };
  const calls = { remote: [], fallback: [] };
  const callbacks = controllerModule.createBigMapViewCallbacks(event => {
    state = controllerModule.reduceBigMapViewState(state, event);
  });
  const controller = controllerModule.createBigMapRequestController({
    loadRemote: (context, signal) => { calls.remote.push({ context, signal }); return remoteLoads[calls.remote.length - 1].promise; },
    loadFallback: (context, signal) => { calls.fallback.push({ context, signal }); return fallbackLoads[calls.fallback.length - 1].promise; },
  }, callbacks);
  return { controller, calls, state: () => state };
}

const mapContext = requestKey => ({ requestKey, regionId: "93.01", regionLevel: "district" });

test("executive preview lifecycle applies remote success through the production controller", async () => {
  const controllerModule = await loadController();
  const remote = deferred();
  const harness = executiveControllerHarness(controllerModule, [remote]);
  const pending = harness.controller.load(mapContext("executive-remote"));
  assert.equal(harness.state().status, "loading");
  remote.resolve([{ properties: { namobj: "Semangga" } }]);
  await pending;
  assert.equal(harness.state().status, "ready");
  assert.equal(harness.state().sourceMode, "big");
  assert.equal(harness.state().features[0].properties.namobj, "Semangga");
});

test("executive preview lifecycle uses fallback and exposes compact error state after total failure", async () => {
  const controllerModule = await loadController();
  const remote = deferred(), fallback = deferred();
  const harness = executiveControllerHarness(controllerModule, [remote], [fallback]);
  const pending = harness.controller.load(mapContext("executive-fallback"));
  remote.reject(new Error("remote unavailable"));
  await Promise.resolve();
  fallback.resolve([{ properties: { namobj: "Kurik" } }]);
  await pending;
  assert.equal(harness.state().sourceMode, "fallback");
  assert.equal(harness.state().status, "ready");

  const remoteFailure = deferred(), fallbackFailure = deferred();
  const failed = executiveControllerHarness(controllerModule, [remoteFailure], [fallbackFailure]);
  const failedPending = failed.controller.load(mapContext("executive-error"));
  remoteFailure.reject(new Error("remote unavailable"));
  await Promise.resolve();
  fallbackFailure.reject(new Error("fallback unavailable"));
  await failedPending;
  assert.equal(failed.state().status, "error");
});

test("executive preview lifecycle aborts stale context and only renders the latest response", async () => {
  const controllerModule = await loadController();
  const stale = deferred(), latest = deferred();
  const harness = executiveControllerHarness(controllerModule, [stale, latest]);
  const oldPending = harness.controller.load(mapContext("executive-old"));
  const latestPending = harness.controller.load(mapContext("executive-latest"));
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  latest.resolve([{ id: "latest" }]);
  await latestPending;
  stale.resolve([{ id: "stale" }]);
  await oldPending;
  assert.deepEqual(harness.state().features, [{ id: "latest" }]);
  assert.equal(harness.state().context.requestKey, "executive-latest");
});

test("executive preview dispose aborts its request and prevents late state updates", async () => {
  const controllerModule = await loadController();
  const remote = deferred();
  const harness = executiveControllerHarness(controllerModule, [remote]);
  const pending = harness.controller.load(mapContext("executive-dispose"));
  harness.controller.dispose();
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  remote.resolve([{ id: "late" }]);
  await pending;
  assert.deepEqual(harness.state().features, []);
});

test("executive map uses production fit-to-bounds with greater occupancy and no crop", async () => {
  const visual = await loadVisualization();
  const geojson = JSON.parse(await readFile("public/data/merauke-districts.geojson", "utf8"));
  const points = geojson.features.flatMap(feature => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.flat(2);
  });
  const before = visual.fitToBounds(points, 900, 480, 24);
  const after = visual.fitToBounds(points, 900, 480, 12);
  assert.ok(after.scale > before.scale);
  assert.ok(after.bounds);
  const renderedWidth = (after.bounds.maxX - after.bounds.minX) * after.scale;
  const renderedHeight = (after.bounds.maxY - after.bounds.minY) * after.scale;
  assert.ok(renderedWidth <= 876 && renderedHeight <= 456);
  assert.ok(Math.max(renderedWidth / 900, renderedHeight / 480) >= 0.9);
});

test("executive map canvas and Lucide hint icon use separate sizing contracts", async () => {
  const css = await readFile("app/executive-dashboard.css", "utf8");
  assert.match(css, /\.executive-map-canvas>svg\{[^}]*width:100%[^}]*height:100%/s);
  assert.match(css, /\.map-selection>svg\{[^}]*width:19px[^}]*height:19px[^}]*flex:0 0 19px/s);
  assert.match(css, /\.executive-map-footer\{[^}]*display:flex/s);
  assert.match(css, /\.executive-map-source\{[^}]*position:static/s);
  assert.match(css, /\.map-selection\{[^}]*position:static/s);
});

test("executive chart opts out of persistent labels while shared default and accessible summary remain", async () => {
  const executive = await readFile("components/overview/ExecutiveDashboard.tsx", "utf8");
  const chart = await readFile("components/ui/MonitoringLineChart.tsx", "utf8");
  assert.match(executive, /showPersistentValueLabels=\{false\}/);
  assert.match(chart, /showPersistentValueLabels = true/);
  assert.match(chart, /showPersistentValueLabels \? positionChartValueLabels/);
  assert.match(chart, /importantValues\.map\(label => `\$\{label\.field/);
  assert.match(chart, /event\.key === "Escape"/);
});

test("executive map documents preview interactions and wires the production lifecycle once", async () => {
  const executive = await readFile("components/overview/ExecutiveDashboard.tsx", "utf8");
  assert.match(executive, /Executive preview contract/);
  assert.match(executive, /createBigMapRequestController<GeoFeature>/);
  assert.match(executive, /createBigMapViewCallbacks<GeoFeature>\(dispatchMapState\)/);
  assert.match(executive, /controller\.dispose\(\)/);
  assert.match(executive, /onClick=\{\(\) => onSelect\(item\.name\)\}/);
  assert.match(executive, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.doesNotMatch(executive, /mapZoom|mapPan|zoomIn|zoomOut|resetZoom|isMapDrag/);
});

test("operational cards keep semantic mobile order and content-driven heights", async () => {
  const executive = await readFile("components/overview/ExecutiveDashboard.tsx", "utf8");
  const css = await readFile("app/executive-dashboard.css", "utf8");
  const order = ["current-season", "production-recap", "top-regions", "system-summary"].map(name => executive.indexOf(name));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(css, /\.executive-secondary-left>\.card\{[^}]*height:auto[^}]*min-height:0[^}]*align-self:start/s);
  assert.match(css, /@media\(max-width:620px\)[\s\S]*\.executive-secondary\{grid-template-columns:1fr\}/);
});
