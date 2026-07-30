import type { Region } from "@/lib/data-foundation";

export function RegionFilters({ districts, villages, districtId, villageId, onDistrict, onVillage }: {
  districts: Region[]; villages: Region[]; districtId: string | null; villageId: string | null;
  onDistrict: (value: string | null) => void; onVillage: (value: string | null) => void;
}) {
  return <div className="season-filter-group region"><div className="season-filter-title">WILAYAH</div><div className="season-filter-pair three">
    <label><span>Kabupaten</span><select value="93.01" aria-label="Kabupaten" disabled><option value="93.01">Merauke</option></select></label>
    <label><span>Distrik</span><select aria-label="Distrik" value={districtId ?? ""} onChange={e => onDistrict(e.target.value || null)}><option value="">Semua Distrik</option>{districts.map(item => <option key={item.id} value={item.id}>{item.name}{item.monitoring_status !== "active" ? " — Belum dipantau" : ""}</option>)}</select></label>
    <label><span>Kampung/Kelurahan</span><select aria-label="Kampung/Kelurahan" disabled={!districtId} value={villageId ?? ""} onChange={e => onVillage(e.target.value || null)}><option value="">Semua Kampung/Kelurahan</option>{villages.map(item => <option key={item.id} value={item.id}>{item.name}{item.monitoring_status !== "active" ? " — Belum dipantau" : ""}</option>)}</select></label>
  </div></div>;
}
