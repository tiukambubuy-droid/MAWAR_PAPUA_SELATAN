import type { RegionNode } from "@/types/planting-season";

export function RegionFilters({ districts, villages, district, village, onDistrict, onVillage }: {
  districts: RegionNode[]; villages: RegionNode[]; district: string; village: string;
  onDistrict: (value: string) => void; onVillage: (value: string) => void;
}) {
  return <div className="season-filter-group region"><div className="season-filter-title">WILAYAH</div><div className="season-filter-pair three">
    <label><span>Kabupaten</span><select value="Merauke" aria-label="Kabupaten" disabled><option>Merauke</option></select></label>
    <label><span>Distrik</span><select aria-label="Distrik" value={district} onChange={e => onDistrict(e.target.value)}><option value="all">Semua Distrik</option>{districts.map(item => <option key={item.id}>{item.name}</option>)}</select></label>
    <label><span>Kampung/Kelurahan</span><select aria-label="Kampung/Kelurahan" disabled={district === "all"} value={village} onChange={e => onVillage(e.target.value)}><option value="all">Semua Kampung/Kelurahan</option>{villages.map(item => <option key={item.id}>{item.name}</option>)}</select></label>
  </div></div>;
}
