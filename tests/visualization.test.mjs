import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadVisualization() {
  const source = await readFile("lib/visualization.ts", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const visual = await loadVisualization();
const points = [
  { id: "a", label: "Apr 2026", stageIndex: 1, target: 10, actual: 8, projection: null, status: "actual", isCutoff: false },
  { id: "b", label: "Mei 2026", stageIndex: 2, target: 20, actual: 18, projection: null, status: "actual", isCutoff: true },
  { id: "c", label: "Jun 2026", stageIndex: 3, target: 30, actual: null, projection: 27, status: "projection", isCutoff: false },
];

test("chart summary distinguishes completed and running seasons using finite production data", () => {
  const completed = visual.chartSummaryItems([
    { ...points[0], actual: 0, isCutoff: false },
    { ...points[1], actual: 18, isCutoff: false },
    { ...points[2], actual: 27, projection: null, isCutoff: true },
  ], "completed");
  assert.deepEqual(completed, [
    { field: "actual", label: "Realisasi akhir", value: 27 },
    { field: "target", label: "Target akhir", value: 30 },
  ]);

  const running = visual.chartSummaryItems(points, "in_progress");
  assert.deepEqual(running, [
    { field: "actual", label: "Realisasi cut-off", value: 18 },
    { field: "target", label: "Target akhir", value: 30 },
    { field: "projection", label: "Proyeksi akhir", value: 27 },
  ]);
});

test("chart summary rejects invalid values, retains verified zero, and exposes unavailable state", () => {
  const invalid = [
    { ...points[0], actual: 0, target: Number.NaN, projection: null, isCutoff: true },
    { ...points[1], actual: Number.POSITIVE_INFINITY, target: Number.NEGATIVE_INFINITY, projection: Number.NaN, isCutoff: false },
  ];
  assert.deepEqual(visual.chartSummaryItems(invalid, "in_progress"), [
    { field: "actual", label: "Realisasi cut-off", value: 0 },
    { field: "target", label: "Target akhir", value: null },
    { field: "projection", label: "Proyeksi akhir", value: null },
  ]);
  assert.deepEqual(visual.chartSummaryItems([], "completed"), [
    { field: "actual", label: "Realisasi akhir", value: null },
    { field: "target", label: "Target akhir", value: null },
  ]);
});

test("fit-to-bounds centers geometry within deterministic padded viewport", () => {
  const camera = visual.fitToBounds([[0, 0], [100, 50]], 900, 480, 30);
  assert.equal(camera.scale, 8.4);
  assert.equal(camera.offsetX, 30);
  assert.equal(camera.offsetY, 30);
});

test("fit-to-bounds ignores non-finite coordinates and keeps invalid inputs recoverable", () => {
  const camera = visual.fitToBounds([[Number.NaN, 4], [4, Number.POSITIVE_INFINITY], [10, 20]], Number.NaN, -20, 60);
  assert.deepEqual(camera.bounds, { minX: 10, maxX: 10, minY: 20, maxY: 20 });
  assert.ok(Number.isFinite(camera.scale) && camera.scale > 0);
  assert.ok(Number.isFinite(camera.offsetX));
  assert.ok(Number.isFinite(camera.offsetY));

  const empty = visual.fitToBounds([[Number.NEGATIVE_INFINITY, Number.NaN]], 100, 100, 60);
  assert.equal(empty.bounds, null);
  assert.deepEqual(empty, { scale: 1, offsetX: 50, offsetY: 50, bounds: null });

  const oversizedPadding = visual.fitToBounds([[0, 0], [10, 10]], 100, 100, 60);
  assert.ok(Number.isFinite(oversizedPadding.scale) && oversizedPadding.scale > 0);
});

test("fit-to-bounds preserves valid point order while excluding every non-finite coordinate", () => {
  const camera = visual.fitToBounds([[Number.NaN, 0], [10, 5], [Number.NEGATIVE_INFINITY, 2], [30, 15], [2, Number.POSITIVE_INFINITY]], 200, 100, 10);
  assert.deepEqual(camera.bounds, { minX: 10, maxX: 30, minY: 5, maxY: 15 });
  assert.deepEqual(camera, visual.fitToBounds([[Number.NaN, 0], [10, 5], [Number.NEGATIVE_INFINITY, 2], [30, 15], [2, Number.POSITIVE_INFINITY]], 200, 100, 10));
});

test("fit-to-bounds output invariants survive degenerate bounds, invalid viewport, and invalid padding", () => {
  const cases = [
    [[[4, 7]], 100, 80, 10],
    [[[4, 0], [4, 20]], 100, 80, 10],
    [[[0, 7], [20, 7]], 100, 80, 10],
    [[[0, 0], [20, 20]], 0, 80, 10],
    [[[0, 0], [20, 20]], 100, 0, 10],
    [[[0, 0], [20, 20]], Number.NaN, 80, 10],
    [[[0, 0], [20, 20]], Number.POSITIVE_INFINITY, 80, 10],
    [[[0, 0], [20, 20]], 100, 80, -4],
    [[[0, 0], [20, 20]], 100, 80, Number.NaN],
    [[[0, 0], [20, 20]], 100, 80, Number.POSITIVE_INFINITY],
    [[[0, 0], [20, 20]], 100, 100, 60],
  ];
  for (const [input, width, height, padding] of cases) {
    const camera = visual.fitToBounds(input, width, height, padding);
    assert.ok(Number.isFinite(camera.scale) && camera.scale > 0);
    assert.ok(Number.isFinite(camera.offsetX));
    assert.ok(Number.isFinite(camera.offsetY));
  }
});

test("map camera reset, zoom clamp and pan clamp keep geometry recoverable", () => {
  assert.deepEqual(visual.resetMapCamera(), { zoom: 1, pan: [0, 0] });
  assert.equal(visual.clampZoom(0), 1);
  assert.equal(visual.clampZoom(8), 3);
  assert.deepEqual(visual.clampPan([999, -999], 2), [250, -250]);
});

test("drag threshold distinguishes click from intentional pan", () => {
  assert.equal(visual.isMapDrag(2, 2), false);
  assert.equal(visual.isMapDrag(4, 3), true);
});

test("selected map label is always retained ahead of colliding labels", () => {
  const labels = visual.prioritizedMapLabels([
    { name: "Lain", center: [10, 10], active: true },
    { name: "Terpilih", center: [12, 12], selected: true, active: true },
  ], 20, 1);
  assert.deepEqual([...labels], ["Terpilih"]);
});

test("label placement is deterministic and never random", () => {
  const items = [{ name: "B", center: [100, 100] }, { name: "A", center: [0, 0] }];
  assert.deepEqual([...visual.prioritizedMapLabels(items)], [...visual.prioritizedMapLabels(items)]);
});

test("chart Y domain includes every valid series, starts at zero and never produces NaN", () => {
  const domain = visual.chartDomain([...points, { ...points[0], target: Number.NaN }]);
  assert.equal(domain.min, 0);
  assert.ok(domain.max >= 30);
  assert.equal(Number.isNaN(domain.max), false);
});

test("actual stops at cut-off while projection uses a distinct cut-off anchor", () => {
  assert.deepEqual(visual.chartSeries(points, "actual").map(point => point.id), ["a", "b"]);
  const projection = visual.chartSeries(points, "projection");
  assert.deepEqual(projection.map(point => point.id), ["b", "c"]);
  assert.equal(projection[0].projection, 18);
});

test("chart exposes at most three data-driven labels for cutoff actual and final values", () => {
  const labels = visual.chartValueLabels(points);
  assert.equal(labels.length, 3);
  assert.deepEqual(labels.map(label => [label.point.id, label.field, label.value]), [
    ["b", "actual", 18],
    ["c", "target", 30],
    ["c", "projection", 27],
  ]);
  assert.equal(visual.chartValueLabels([]).length, 0);
});

test("chart label selectors use last stage, reject invalid values, retain verified zero, and never duplicate a series", () => {
  const unordered = [
    { ...points[2], stageIndex: 9, target: Number.NaN, projection: 0 },
    { ...points[1], id: "early-cutoff", stageIndex: 1, actual: 12 },
    { ...points[1], id: "late-cutoff", stageIndex: 7, actual: 22 },
    { ...points[0], id: "last-target", stageIndex: 8, target: 44, actual: null },
  ];
  const labels = visual.chartValueLabels(unordered);
  assert.deepEqual(labels.map(label => [label.point.id, label.field, label.value]), [
    ["late-cutoff", "actual", 22],
    ["last-target", "target", 44],
    ["c", "projection", 0],
  ]);
  assert.equal(new Set(labels.map(label => label.field)).size, labels.length);
  assert.equal(visual.chartValueLabels(points.map(point => ({ ...point, projection: null }))).some(label => label.field === "projection"), false);
});

test("chart label placement clamps to plot bounds and resolves collisions deterministically", () => {
  const selected = visual.chartValueLabels(points);
  const input = selected.map(label => ({ ...label, text: `${label.field} ${visual.formatCompactId(label.value)} ton`, anchorX: 730, anchorY: 40 }));
  const bounds = { left: 72, right: 734, top: 28, bottom: 278 };
  const first = visual.positionChartValueLabels(input, bounds);
  const second = visual.positionChartValueLabels(input, bounds);
  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  for (const label of first) {
    assert.ok(label.x >= bounds.left && label.x + label.width <= bounds.right);
    assert.ok(label.y >= bounds.top && label.y + label.height <= bounds.bottom);
  }
  for (let left = 0; left < first.length; left++) for (let right = left + 1; right < first.length; right++) {
    assert.equal(first[left].x < first[right].x + first[right].width && first[left].x + first[left].width > first[right].x && first[left].y < first[right].y + first[right].height && first[left].y + first[left].height > first[right].y, false);
  }
});

test("tooltip exclusion moves actual, target, and projection labels without rectangle intersections", () => {
  const selected = visual.chartValueLabels(points);
  const input = selected.map(label => ({ ...label, text: `${label.field} ${label.value} ton`, anchorX: 640, anchorY: 120 }));
  const bounds = { left: 72, right: 734, top: 28, bottom: 278 };
  const tooltip = { x: 430, y: 65, width: 210, height: 100 };
  const labels = visual.positionChartValueLabels(input, bounds, [tooltip]);
  assert.equal(labels.length, 3);
  for (const label of labels) {
    assert.equal(label.x < tooltip.x + tooltip.width + 8 && label.x + label.width > tooltip.x - 8 && label.y < tooltip.y + tooltip.height + 8 && label.y + label.height > tooltip.y - 8, false);
  }
});

test("tooltip collision layout handles every edge and narrow mobile plot deterministically", () => {
  const selected = visual.chartValueLabels(points);
  const makeInput = anchorX => selected.map(label => ({ ...label, text: `${label.field} ${label.value} ton`, anchorX, anchorY: 80 }));
  const cases = [
    [{ left: 72, right: 734, top: 28, bottom: 278 }, { x: 72, y: 28, width: 180, height: 90 }, 100],
    [{ left: 72, right: 734, top: 28, bottom: 278 }, { x: 554, y: 160, width: 180, height: 90 }, 700],
    [{ left: 72, right: 360, top: 28, bottom: 278 }, { x: 150, y: 28, width: 190, height: 105 }, 330],
  ];
  for (const [bounds, tooltip, anchorX] of cases) {
    const first = visual.positionChartValueLabels(makeInput(anchorX), bounds, [tooltip]);
    const second = visual.positionChartValueLabels(makeInput(anchorX), bounds, [tooltip]);
    assert.deepEqual(first, second);
    for (const label of first) {
      assert.ok(label.x >= bounds.left && label.x + label.width <= bounds.right);
      assert.ok(label.y >= bounds.top && label.y + label.height <= bounds.bottom);
    }
  }
});

test("collision fallback removes projection then target, preserves actual, and ignores invalid exclusion bounds", () => {
  const selected = visual.chartValueLabels(points);
  const input = selected.map(label => ({ ...label, text: `${label.field} ${label.value}`, anchorX: 100, anchorY: 50 }));
  const narrow = { left: 0, right: 220, top: 0, bottom: 60 };
  const blocked = visual.positionChartValueLabels(input, narrow, [{ x: 130, y: 0, width: 90, height: 60 }]);
  assert.deepEqual(blocked.map(label => label.field), ["actual"]);
  const normal = visual.positionChartValueLabels(input, { left: 0, right: 600, top: 0, bottom: 300 });
  const invalid = visual.positionChartValueLabels(input, { left: 0, right: 600, top: 0, bottom: 300 }, [{ x: Number.NaN, y: 0, width: 10, height: 10 }]);
  assert.deepEqual(invalid, normal);
  assert.deepEqual(visual.positionChartValueLabels([], narrow, []), []);
});

test("empty chart data gets a finite zero-based domain", () => {
  const domain = visual.chartDomain([]);
  assert.equal(domain.min, 0);
  assert.ok(Number.isFinite(domain.max) && domain.max > 0);
});

test("Indonesian compact formatting and responsive label density are stable", () => {
  assert.match(visual.formatCompactId(125000), /125/);
  assert.equal(visual.responsiveLabelStep(390, 6), 2);
  assert.equal(visual.responsiveLabelStep(768, 6), 1);
});

test("shared chart renderer exposes distinct patterns, active tooltip data and reduced-motion support", async () => {
  const component = await readFile("components/ui/MonitoringLineChart.tsx", "utf8");
  const css = await readFile("app/globals.css", "utf8");
  assert.match(component, /active\.target/);
  assert.match(component, /active\.actual/);
  assert.match(component, /active\.projection/);
  assert.match(component, /chartValueLabels\(data\)/);
  assert.match(component, /chart-value-label/);
  assert.match(component, /data-series=\{field\}/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /Realisasi pada cut-off/);
  assert.match(component, /tooltipExclusion/);
  assert.match(component, /getBoundingClientRect/);
  assert.doesNotMatch(component, /Math\.random/);
  assert.doesNotMatch(component, /Juli/);
  assert.match(css, /chart-series\.target[^}]*stroke-dasharray/s);
  assert.match(css, /chart-series\.actual[^}]*stroke-width:4/s);
  assert.match(css, /chart-series\.projection[^}]*stroke-dasharray/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("map controls retain accessible names and lifecycle controller remains wired", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /aria-label="Perbesar peta"/);
  assert.match(page, /aria-label="Perkecil peta"/);
  assert.match(page, /aria-label="Kembalikan ukuran peta"/);
  assert.match(page, /createBigMapRequestController/);
  assert.match(page, /requestControllerRef\.current\?\.retry/);
});
