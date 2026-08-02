import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTsModule(path) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/^import .*;$/gm, "");
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);
}

const selectors = await loadTsModule("lib/presentation-selectors.ts");

const phases = [
  { id: "preparation", label: "Persiapan", area: 10, color: "#111", monitoringStatus: "active" },
  { id: "vegetative", label: "Vegetatif", area: 73.3, color: "#222", monitoringStatus: "active" },
  { id: "generative", label: "Generatif", area: 16.7, color: "#333", monitoringStatus: "active" },
];

test("fase dominan selalu berasal dari luas komposisi terbesar dan berada dalam daftar aktif", () => {
  const dominant = selectors.getDominantPhase(phases);
  assert.equal(dominant.label, "Vegetatif");
  assert.equal(dominant.areaHa, 73.3);
  assert.equal(dominant.percentage, 73.3);
  assert.ok(phases.some(item => item.id === dominant.phaseId));
  assert.ok(Math.abs(phases.reduce((sum, item) => sum + item.area, 0) - 100) < 0.01);
});

test("risiko dominan mengikuti luas terdampak dan berubah bersama komposisi", () => {
  const lowDominant = selectors.getDominantRisk([
    { id: "low", label: "Rendah", area: 54, color: "green", monitoringStatus: "active" },
    { id: "critical", label: "Tinggi/Kritis", area: 17, color: "red", monitoringStatus: "active" },
  ], 6);
  const criticalDominant = selectors.getDominantRisk([
    { id: "low", label: "Rendah", area: 12, color: "green", monitoringStatus: "active" },
    { id: "critical", label: "Tinggi/Kritis", area: 38, color: "red", monitoringStatus: "active" },
  ], 4);
  assert.equal(lowDominant.label, "Rendah");
  assert.equal(criticalDominant.label, "Tinggi/Kritis");
  assert.equal(lowDominant.monitoredLocationCount, 6);
});

test("perubahan bulanan memakai kategori sama dalam poin persentase tanpa fallback nol", () => {
  const change = selectors.getPhaseMonthlyChange({ label: "Vegetatif", value: 73.3 }, { label: "Vegetatif", value: 66.9 }, "Juni 2026");
  assert.equal(change.deltaPoints, 6.4);
  assert.match(change.text, /naik 6,4 poin persentase dibanding Juni 2026/);
  const unavailable = selectors.getPhaseMonthlyChange({ label: "Vegetatif", value: 73.3 }, null);
  assert.equal(unavailable.deltaPoints, null);
  assert.equal(unavailable.text, "Data pembanding bulan sebelumnya belum tersedia");
});

test("validasi hanya menghitung record terpantau dan tidak memakai placeholder nol", () => {
  const summary = selectors.getValidationSummary([
    { monitoringStatus: "active", validation: 91 },
    { monitoringStatus: "active", validation: 87 },
    { monitoringStatus: "not_monitored", validation: 0, placeholder: true },
    { monitoringStatus: "active", validation: null },
  ]);
  assert.equal(summary.averageValidation, 89);
  assert.equal(summary.includedRecordCount, 2);
  assert.equal(summary.excludedRecordCount, 2);
  assert.equal(summary.calculationScope, "Rata-rata dari 2 wilayah terpantau");
});

test("formatter membedakan nol terverifikasi, belum tersedia, dan belum dipantau", () => {
  assert.equal(selectors.formatPresentationValue(0, "ha", "verified_zero"), "0 ha");
  assert.equal(selectors.formatPresentationValue(null, "hari", "not_available"), "Belum tersedia");
  assert.equal(selectors.formatPresentationValue(null, "ha", "not_monitored"), "Belum dipantau");
  assert.doesNotMatch(selectors.formatPresentationValue(null, "hari"), /^\s*hari$/);
});

test("kontrak indikator luas mempunyai label dan field sumber yang tidak ambigu", () => {
  const mapped = selectors.defineLandMetric("mapped_land", 2403);
  const realized = selectors.defineLandMetric("realized_planted_area", 2100);
  assert.equal(mapped.label, "Luas lahan terpetakan");
  assert.equal(mapped.sourceField, "mapped_land_ha");
  assert.equal(realized.label, "Realisasi luas tanam");
  assert.notEqual(mapped.sourceField, realized.sourceField);
});

test("transisi provinsi ke kabupaten selalu memakai distrik kanonis bukan nama kabupaten dari BIG", () => {
  const districts = ["Animha", "Elikobel", "Semangga"];
  assert.deepEqual(selectors.resolveTableRegionNames("district", "", districts, []), districts);
  assert.deepEqual(selectors.resolveTableRegionNames("district", "Semangga", districts, ["Kuper", "Muram Sari"]), ["Kuper", "Muram Sari"]);
  assert.deepEqual(selectors.resolveTableRegionNames("province", "", districts, []), ["Merauke"]);
});

test("presentation source tidak memakai validasi sebagai skor risiko atau membuat ancaman", async () => {
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /score: null/);
  assert.match(page, /Informasi ancaman khusus belum tersedia pada data prototipe/);
  assert.doesNotMatch(page, /score:\s*Math\.round\(aggregate\.validation_rate\)|score:\s*100/);
  assert.doesNotMatch(page, /Umur tanaman<\/span><strong>\{selectedPhase\.age\}<\/strong><small>hari/);
  assert.doesNotMatch(page, /verified\s*>=|100\s*-\s*verified/);
  assert.match(page, /KOMPOSISI RISIKO/);
});

test("panel fase menyatakan kontrak data terbaru tanpa tren bulanan sintetis", async () => {
  const chart = await readFile("components/season/PhaseCompositionChart.tsx", "utf8");
  const page = await readFile("components/season/SeasonPage.tsx", "utf8");
  assert.match(chart, /Data pembanding komposisi bulan sebelumnya belum tersedia pada data prototipe\./);
  assert.match(chart, /Komposisi yang tampil merupakan data terbaru musim aktif\./);
  assert.doesNotMatch(chart, /getPhaseMonthlyChange|directionIcon|previousValues/);
  assert.match(page, /DATA TERBARU.*selectedSeason\.name/);
});
