import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = read("app/page.tsx");
const layout = read("app/layout.tsx");
const loading = read("components/ui/DashboardLoading.tsx");
const overview = read("components/overview/ExecutiveDashboard.tsx");
const season = read("components/season/SeasonPage.tsx");
const production = read("components/production/ProductionPage.tsx");
const report = read("lib/report-branding.ts");
const styles = read("app/globals.css");

const pngDimensions = path => {
  const buffer = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
};

test("branding publik memakai identitas lengkap MAWAR dan aset logo lokal", () => {
  assert.match(shell, /MAWAR PAPUA SELATAN/);
  assert.match(shell, /Model Aksi Wadah Kolaborasi &amp; Resiliensi/);
  assert.match(shell, /\/branding\/logo-papua-selatan\.png/);
  assert.doesNotMatch(shell, /https?:\/\/[^"]+logo/i);
  assert.match(shell, /Lambang Pemerintah Provinsi Papua Selatan/);
  assert.doesNotMatch(shell, /SIPANGAN|Pusat Kendali Padi/i);
});

test("metadata dan loading publik memakai MAWAR Papua Selatan", () => {
  assert.match(layout, /MAWAR Papua Selatan \| Dashboard Pemantauan Padi/);
  assert.match(layout, /Dashboard pemantauan padi dan ketahanan pangan Provinsi Papua Selatan\./);
  assert.match(layout, /applicationName: "MAWAR Papua Selatan"/);
  assert.match(loading, /Menyiapkan MAWAR Papua Selatan/);
  assert.match(loading, /Model Aksi Wadah Kolaborasi &amp; Resiliensi/);
});

test("cakupan sistem dan cakupan prototipe dibedakan pada setiap halaman", () => {
  assert.match(overview, /Dashboard Pemantauan Padi dan Ketahanan Pangan/);
  assert.match(overview, /<p>Papua Selatan<\/p>/);
  assert.match(overview, /Cakupan prototipe: Kabupaten Merauke/);
  assert.match(shell, /Pemantauan lahan padi Papua Selatan/);
  assert.match(shell, /Cakupan data aktif: Kabupaten Merauke/);
  assert.match(season, /Pemantauan musim tanam padi Papua Selatan/);
  assert.match(production, /Pemantauan produksi padi Papua Selatan/);
});

test("footer dan nama dokumen laporan memakai identitas pemerintah dan MAWAR", () => {
  assert.match(shell, /© 2026 Pemerintah Provinsi Papua Selatan/);
  assert.match(shell, /Data pada prototipe bersifat simulasi/);
  assert.match(report, /mawar-papua-selatan-\$\{kind\}-\$\{suffix\}/);
  assert.match(report, /document\.title = slug/);
});

test("metadata icon memakai turunan lokal berukuran tepat dan tidak memakai logo sumber", () => {
  assert.doesNotMatch(layout, /icons:\s*\{[\s\S]*\/branding\/logo-papua-selatan\.png/);
  const icons = [
    ["public/branding/icons/favicon-32.png", 32, 20_000],
    ["public/branding/icons/favicon-48.png", 48, 30_000],
    ["public/branding/icons/apple-touch-icon-180.png", 180, 150_000],
    ["public/branding/icons/app-icon-192.png", 192, 180_000],
    ["public/branding/icons/app-icon-512.png", 512, 400_000],
  ];
  for (const [path, size, maxBytes] of icons) {
    assert.ok(statSync(new URL(`../${path}`, import.meta.url)).isFile());
    const metadata = pngDimensions(path);
    assert.deepEqual([metadata.width, metadata.height], [size, size]);
    assert.ok(metadata.bytes <= maxBytes, `${path} terlalu besar: ${metadata.bytes}`);
  }
  assert.match(layout, /apple-touch-icon-180\.png"[,\s]+sizes: "180x180"/);
  assert.match(layout, /app-icon-192\.png"[,\s]+sizes: "192x192"/);
  assert.match(layout, /app-icon-512\.png"[,\s]+sizes: "512x512"/);
});

test("identitas MAWAR adalah tombol beranda native tanpa mereset filter", () => {
  assert.match(shell, /<button type="button" className="brand-mark" aria-label="Buka beranda MAWAR Papua Selatan"/);
  assert.match(shell, /onClick=\{\(\) => setActiveNav\("Ringkasan"\)\}/);
  assert.doesNotMatch(shell.match(/<button type="button" className="brand-mark"[\s\S]*?<\/button>/)?.[0] ?? "", /setSeason|setDistrict|setVillage|sessionStorage|history\./);
});

test("header laporan cetak adalah struktur nyata dengan lambang dan hanya tampil saat print", () => {
  assert.match(shell, /<header className="print-brand-header">/);
  assert.match(shell, /app-icon-192\.png" alt="Lambang Pemerintah Provinsi Papua Selatan"/);
  assert.match(shell, /Wilayah aktif: \{printScope\}/);
  assert.match(shell, /Musim aktif: \{printSeason/);
  assert.match(styles, /\.print-brand-header,body::after\{display:none\}/);
  assert.match(styles, /@media print\{[\s\S]*\.print-brand-header\{display:grid/);
  assert.doesNotMatch(styles, /body::before/);
});
