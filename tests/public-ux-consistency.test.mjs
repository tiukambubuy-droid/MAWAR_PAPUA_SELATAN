import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("public report controls disclose that reports are unavailable", () => {
  const overview = read("components/overview/ExecutiveDashboard.tsx");
  const shell = read("app/page.tsx");
  assert.match(overview, /report-unavailable[\s\S]*disabled[\s\S]*Laporan belum tersedia/);
  assert.doesNotMatch(overview, /Unduh Laporan|printWithMawarTitle|mawarReportSlug/);
  assert.match(shell, /`\$\{label\} belum tersedia`/);
  assert.match(shell, /Segera hadir/);
});

test("Sekretariat Daerah badge is presentation, not a dead button", () => {
  const shell = read("app/page.tsx");
  assert.match(shell, /<div className="profile" aria-label="Tampilan prototipe Sekretariat Daerah">/);
  assert.doesNotMatch(shell, /<button className="profile"/);
});

test("primary public actions use icon components instead of symbol-only labels", () => {
  const shell = read("app/page.tsx");
  const production = read("components/production/ProductionTable.tsx");
  const infrastructure = read("components/infrastructure/InfrastructurePage.tsx");
  assert.doesNotMatch(shell, />\s*[⌕×↺]\s*</u);
  for (const source of [production, infrastructure]) assert.doesNotMatch(source, />\s*[×↺‹›]\s*</u);
  assert.match(shell, /ArrowLeft|ArrowRight|RotateCcw|TrendingUp/);
  assert.match(production, /ChevronLeft|ChevronRight/);
  assert.match(infrastructure, /ArrowUpDown/);
});

test("active presentation uses Lucide for formerly raw decorative glyphs", () => {
  const files = [
    "app/page.tsx",
    "components/production/ProductionFilters.tsx",
    "components/production/ProductionSummaryCards.tsx",
    "components/production/ProductionTrendChart.tsx",
    "components/season/PhaseCompositionChart.tsx",
    "components/season/SeasonInsights.tsx",
    "components/season/SeasonMonitoringTable.tsx",
    "components/season/SeasonPage.tsx",
  ];
  const forbidden = /[⌕×↺‹◎♨♙♜◴↗⚙⌄⇩★ⓘ♧●⌁♢△☂]/u;
  for (const file of files) assert.doesNotMatch(read(file), forbidden, file);
  const combined = files.map(read).join("\n");
  assert.match(combined, /from "lucide-react"/);
  // Mojibake source dan bundle diverifikasi oleh audit produksi map-production-presentation.
});

test("all active UI source excludes raw decorative glyphs outside documented semantic exceptions", () => {
  const forbidden = /[\u2315\u21BA\u2039\u2191\u2193\u2195\u25CE\u2668\u2699\u2304\u21E9\u2659\u25F4\u2667\u24D8\u2605\u2301\u2662\u25B3\u2602]/u;
  const failures = [];
  for (const directory of ["app", "components"]) {
    const root = new URL(`../${directory}/`, import.meta.url);
    for (const relative of readdirSync(root, { recursive: true })) {
      if (!/\.(?:css|ts|tsx)$/.test(relative)) continue;
      const source = readFileSync(new URL(relative, root), "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        if (forbidden.test(line)) failures.push(`${directory}/${relative}:${index + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  // Dikecualikan secara semantik: › breadcrumb; → relasi; ×/÷ formula; — separator.
});

test("risk and collaboration sorting render Lucide state icons without changing sort semantics", () => {
  for (const file of ["components/risk/RiskClimatePage.tsx", "components/collaboration/CollaborationPage.tsx"]) {
    const source = read(file);
    assert.match(source, /ArrowUpDown/);
    assert.match(source, /ArrowUp/);
    assert.match(source, /ArrowDown/);
    assert.doesNotMatch(source, /[\u2191\u2193\u2195]/u);
    assert.match(source, /aria-sort=/);
    assert.match(source, /aria-hidden="true"/);
  }
});

test("browser contract covers eight headings, disabled keyboard paths and systematic inventory", () => {
  const browser = read("tests/browser/map-production-presentation.browser.mjs");
  for (const name of ["Ringkasan","Peta Lahan","Musim Tanam","Produksi","Ketahanan Pangan","Infrastruktur & Sarana","Risiko & Iklim","Kolaborasi OPD"]) assert.match(browser, new RegExp(JSON.stringify(name).slice(1,-1).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(browser, /for\(const action of\["click","Enter"," "\]\)/);
  assert.match(browser, /controlInventory/);
  assert.match(browser, /semua kontrol diklasifikasikan/);
  assert.match(browser, /report\.font>=11\.99/);
  assert.match(browser, /network node pointer/);
  assert.match(browser, /network node keyboard/);
});
