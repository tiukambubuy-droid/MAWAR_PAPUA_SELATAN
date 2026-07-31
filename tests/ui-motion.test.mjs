import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("app/ui-motion.css", "utf8");
const loading = await readFile("components/ui/DashboardLoading.tsx", "utf8");
const provider = await readFile("components/DashboardFilterProvider.tsx", "utf8");
const productionTable = await readFile("components/production/ProductionTable.tsx", "utf8");
const chartData = await readFile("lib/chart-data.ts", "utf8");
const modalHook = await readFile("components/ui/useAccessibleModal.ts", "utf8");
const appPage = await readFile("app/page.tsx", "utf8");
const seasonTable = await readFile("components/season/SeasonMonitoringTable.tsx", "utf8");
const productionDetail = await readFile("components/production/ProductionDetailModal.tsx", "utf8");

test("motion system uses central tokens without changing displayed data", () => {
  for (const token of ["--motion-fast", "--motion-normal", "--motion-slow", "--motion-ease"]) {
    assert.match(css, new RegExp(token));
  }
  assert.doesNotMatch(css, /63[,.]39|183420|174577/);
});

test("reduced motion disables primary animation and transition", () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation-duration:\s*\.01ms!important/);
  assert.match(css, /transition-duration:\s*\.01ms!important/);
});

test("initial loading has live busy semantics and no dummy KPI values", () => {
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /aria-live="polite"/);
  assert.match(loading, /Menyiapkan MAWAR Papua Selatan/);
  assert.match(loading, /Memuat data wilayah, musim tanam, dan produksi/);
  assert.doesNotMatch(loading, /NaN|undefined|\d{2,}[.,]\d{3}/);
  assert.match(provider, /setHydrated\(true\).*300/s);
});

test("modal overlays use fixed centered viewport layout", () => {
  assert.match(css, /position:fixed!important/);
  assert.match(css, /inset:0!important/);
  assert.match(css, /display:grid!important/);
  assert.match(css, /place-items:center!important/);
  assert.match(css, /max-height:90dvh!important/);
});

test("modal accessibility restores focus and locks body scrolling", () => {
  assert.match(modalHook, /document\.activeElement/);
  assert.match(modalHook, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modalHook, /trigger\?\.focus/);
  assert.match(modalHook, /event\.key === "Escape"/);
});

test("desktop production table is fluid and has no Trend column", () => {
  assert.match(css, /\.production-table-card table\s*\{[^}]*width:100%[^}]*min-width:0/s);
  assert.doesNotMatch(productionTable, /<th>Tren<\/th>/);
  for (const column of ["Wilayah", "Luas Panen", "Produktivitas", "Produksi GKG", "Estimasi Beras", "Target GKG", "Capaian", "Aksi"]) {
    assert.match(productionTable, new RegExp(column));
  }
});

test("responsive rules prevent page overflow and allow controlled mobile tables", () => {
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:hidden/);
  assert.match(css, /@media \(max-width:620px\)/);
  assert.match(css, /\.production-table-card \.table-scroll[^}]*overflow-x:auto/s);
});

test("chart motion preserves cutoff and separate projection contract", () => {
  assert.match(chartData, /!afterCutoff && actualRow/);
  assert.match(chartData, /afterCutoff && projectionRow/);
  assert.match(chartData, /isCutoff:\s*period === cutoff/);
  assert.match(css, /\.projection-line/);
  assert.match(css, /lineDraw/);
});

test("rendemen standard remains visible and unchanged", async () => {
  const sources = await Promise.all([
    "components/overview/ExecutiveDashboard.tsx",
    "components/production/ProductionComposition.tsx",
    "components/season/SeasonSummaryCards.tsx",
  ].map(path => readFile(path, "utf8")));
  assert.ok(sources.some(source => /63,39|compactYieldNote|millingYield/.test(source)));
});

test("responsive navigation retains meaningful accessible names and current page state", () => {
  assert.match(appPage, /aria-label=\{`Buka halaman \$\{label\}`\}/);
  assert.match(appPage, /aria-current=\{activeNav === label \? "page" : undefined\}/);
  assert.match(appPage, /<span aria-hidden="true">\{icon\}<\/span>/);
  for (const label of ["Ringkasan", "Peta Lahan", "Musim Tanam", "Produksi", "Stok Beras", "Risiko", "Laporan"]) {
    assert.match(appPage, new RegExp(label));
  }
});

test("all dashboard pagination controls expose action, current and disabled semantics", () => {
  for (const source of [appPage, seasonTable, productionTable]) {
    assert.match(source, /aria-label="Halaman sebelumnya"/);
    assert.match(source, /aria-label="Halaman berikutnya"/);
    assert.match(source, /disabled=\{/);
    assert.match(source, /aria-disabled=\{/);
  }
  for (const source of [seasonTable, productionTable]) {
    assert.match(source, /aria-label=\{`Buka halaman \$\{/);
    assert.match(source, /aria-current=\{/);
  }
});

test("icon-only and contextual actions never rely on a symbol as their name", () => {
  for (const label of [
    "Perbesar peta",
    "Perkecil peta",
    "Kembalikan ukuran peta",
    "Coba muat ulang peta BIG",
    "Tutup detail",
  ]) {
    assert.match(appPage, new RegExp(`aria-label=["{\`][^\\n]*${label}`));
  }
  assert.match(appPage, /aria-label=\{`Buka detail \$\{row\.cells\[0\]\}`\}/);
  assert.match(seasonTable, /aria-label=\{`Lihat detail \$\{row\.name\}`\}/);
  assert.match(productionTable, /aria-label=\{`Lihat detail \$\{row\.name\}`\}/);
  assert.match(seasonTable, /className="season-spark"[^>]*aria-hidden="true"/);
});

test("modal close, print and export actions have explicit accessible names", () => {
  for (const label of ["Tutup detail produksi", "Cetak detail produksi", "Export detail produksi ke PDF"]) {
    assert.match(productionDetail, new RegExp(`aria-label="${label}"`));
  }
  assert.match(seasonTable, /aria-label=\{`Lihat detail \$\{row\.name\}`\}/);
  assert.match(modalHook, /trigger\?\.focus/);
  assert.match(modalHook, /event\.key === "Escape"/);
});

test("modal metadata typography is never below twelve pixels in the UI override", () => {
  const metadataRules = [
    ".detail-modal>header span",
    ".manage-season-modal header span",
    ".production-detail-identity>small",
    ".production-detail-footer>span",
    ".executive-production-modal header span",
  ];
  for (const selector of metadataRules) assert.ok(css.includes(selector), `${selector} must be overridden`);
  const modalSection = css.slice(css.indexOf("/* Modal standard */"), css.indexOf("@media (max-width:1250px)"));
  assert.match(modalSection, /font-size:12px/g);
  assert.doesNotMatch(modalSection, /font-size:(?:[0-9]|1[01])px/);
});
