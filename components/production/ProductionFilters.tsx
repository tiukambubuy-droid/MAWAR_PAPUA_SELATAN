"use client";
import { productionDistricts, villagesForDistrict } from "@/lib/production-data";

export function ProductionFilters({ seasonId, district, village, onSeason, onDistrict, onVillage }: {
  seasonId: string; district: string; village: string; onSeason: (value: string) => void; onDistrict: (value: string) => void; onVillage: (value: string) => void;
}) {
  const villages = villagesForDistrict(district);
  return <section className="card production-filters" aria-label="Filter produksi">
    <div className="production-filter-group"><b>PERIODE</b><div><label>Tahun<select aria-label="Tahun produksi" value="2026" disabled><option>2026</option></select></label><label>Musim Tanam<select aria-label="Musim tanam" value={seasonId} onChange={event => onSeason(event.target.value)}><option value="MT2-2026">MT II 2026 (Berjalan)</option><option value="MT1-2026">MT I 2026 (Selesai)</option></select></label></div></div>
    <div className="production-filter-group region"><b>WILAYAH</b><div><label>Kabupaten<select aria-label="Kabupaten" disabled><option>Merauke</option></select></label><label>Distrik<select aria-label="Distrik" value={district} onChange={event => { onDistrict(event.target.value); onVillage("Semua Kampung"); }}><option>Semua Distrik</option>{productionDistricts.map(item => <option key={item.name}>{item.name}</option>)}</select></label><label>Kampung/Kelurahan<select aria-label="Kampung/Kelurahan" value={village} disabled={district === "Semua Distrik"} onChange={event => onVillage(event.target.value)}><option value="Semua Kampung">Semua Kampung/Kelurahan</option>{villages.map(item => <option key={item.name}>{item.name}</option>)}</select></label></div></div>
    <div className="production-filter-actions"><div><span>♨</span><small>Komoditas<strong>Padi</strong></small></div><button type="button">⚙ Kelola Musim⌄</button></div>
    <div className="production-active"><i /> <small>Wilayah Aktif<strong>{district === "Semua Distrik" ? "Kabupaten Merauke" : village === "Semua Kampung" ? `Distrik ${district}` : `Kampung/Kelurahan ${village}`}</strong></small></div>
    <button className="production-download" onClick={() => window.print()}>⇩ Ringkasan Produksi</button>
  </section>;
}
