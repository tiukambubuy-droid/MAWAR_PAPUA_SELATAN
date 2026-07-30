import type { PlantingSeason } from "@/types/planting-season";

export function SeasonFilters({ years, year, onYear, seasons, seasonId, onSeason }: {
  years: number[]; year: number; onYear: (value: number) => void;
  seasons: PlantingSeason[]; seasonId: string; onSeason: (value: string) => void;
}) {
  return <div className="season-filter-group"><div className="season-filter-title">PERIODE</div><div className="season-filter-pair">
    <label><span>Tahun</span><select aria-label="Tahun" value={year} onChange={e => onYear(Number(e.target.value))}>{years.map(item => <option key={item}>{item}</option>)}</select></label>
    <label className="wide"><span>Musim Tanam</span><select aria-label="Musim Tanam" value={seasonId} onChange={e => onSeason(e.target.value)}>{seasons.map(item => <option key={item.id} value={item.id}>{item.name} ({item.status})</option>)}</select></label>
  </div></div>;
}
