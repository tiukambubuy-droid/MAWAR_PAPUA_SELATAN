"use client";
import { getChildrenByRegionId, getRegionById, regions } from "@/lib/data-foundation";
import { mawarReportSlug, printWithMawarTitle } from "@/lib/report-branding";
import { ChevronDown, Download, Settings, Wheat } from "lucide-react";

export function ProductionFilters({ seasonId, districtId, villageId, onSeason, onDistrict, onVillage }: {
  seasonId: string; districtId: string | null; villageId: string | null;
  onSeason: (value: string) => void; onDistrict: (value: string | null) => void; onVillage: (value: string | null) => void;
}) {
  const districts = regions.filter(item => item.administrative_type === "district" && item.parent_id === "93.01");
  const villages = districtId ? getChildrenByRegionId(districtId) : [];
  const district = districtId ? getRegionById(districtId) : null;
  const village = villageId ? getRegionById(villageId) : null;
  return <section className="card production-filters" aria-label="Filter produksi">
    <div className="production-filter-group"><b>PERIODE</b><div><label>Tahun<select aria-label="Tahun produksi" value="2026" disabled><option>2026</option></select></label><label>Musim Tanam<select aria-label="Musim tanam" value={seasonId} onChange={event => onSeason(event.target.value)}><option value="MT2-2026">MT II 2026 (Berjalan)</option><option value="MT1-2026">MT I 2026 (Selesai)</option></select></label></div></div>
    <div className="production-filter-group region"><b>WILAYAH</b><div><label>Kabupaten<select aria-label="Kabupaten" disabled><option>Merauke</option></select></label><label>Distrik<select aria-label="Distrik" value={districtId ?? ""} onChange={event => onDistrict(event.target.value || null)}><option value="">Semua Distrik</option>{districts.map(item => <option key={item.id} value={item.id}>{item.name}{item.monitoring_status !== "active" ? " — Belum dipantau" : ""}</option>)}</select></label><label>Kampung/Kelurahan<select aria-label="Kampung/Kelurahan" value={villageId ?? ""} disabled={!districtId} onChange={event => onVillage(event.target.value || null)}><option value="">Semua Kampung/Kelurahan</option>{villages.map(item => <option key={item.id} value={item.id}>{item.name}{item.monitoring_status !== "active" ? " — Belum dipantau" : ""}</option>)}</select></label></div></div>
    <div className="production-filter-actions"><div><span><Wheat size={18} aria-hidden="true"/></span><small>Komoditas<strong>Padi</strong></small></div><button type="button"><Settings size={16} aria-hidden="true"/> Kelola Musim <ChevronDown size={15} aria-hidden="true"/></button></div>
    <div className="production-active"><i /> <small>Wilayah Aktif<strong>{village ? `${village.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung"} ${village.name}` : district ? `Distrik ${district.name}` : "Kabupaten Merauke"}</strong></small></div>
    <button className="production-download" onClick={() => printWithMawarTitle(mawarReportSlug("produksi", "Kabupaten Merauke", seasonId))}><Download size={16} aria-hidden="true"/> Ringkasan Produksi</button>
  </section>;
}
