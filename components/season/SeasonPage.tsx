"use client";
import { useMemo, useState } from "react";
import { plantingSeasons as initialSeasons } from "@/data/planting-seasons";
import { fieldsForVillage, regions } from "@/data/regions";
import { monitoringRows, phaseComposition, seasonMonths, stableSeed } from "@/lib/season-aggregations";
import { buildSeasonInsights } from "@/lib/season-insights";
import type { MonitoringRow, PlantingSeason } from "@/types/planting-season";
import { ManageSeasonModal } from "./ManageSeasonModal";
import { PhaseCompositionChart } from "./PhaseCompositionChart";
import { RegionBreadcrumb } from "./RegionBreadcrumb";
import { RegionFilters } from "./RegionFilters";
import { SeasonCalendar } from "./SeasonCalendar";
import { SeasonDetailModal } from "./SeasonDetailModal";
import { SeasonFilters } from "./SeasonFilters";
import { SeasonInsights } from "./SeasonInsights";
import { SeasonMonitoringTable } from "./SeasonMonitoringTable";
import { SeasonProgressChart } from "./SeasonProgressChart";
import { SeasonSummaryCards } from "./SeasonSummaryCards";

export default function SeasonPage() {
  const [seasons, setSeasons] = useState<PlantingSeason[]>(initialSeasons);
  const [year, setYear] = useState(2026);
  const [seasonId, setSeasonId] = useState("mt2-2026");
  const [district, setDistrict] = useState("Semangga");
  const [village, setVillage] = useState("all");
  const [activeMonth, setActiveMonth] = useState(3);
  const [manageOpen, setManageOpen] = useState(false);
  const [detail, setDetail] = useState<MonitoringRow | null>(null);
  const years = useMemo(() => Array.from(new Set(seasons.map(item => item.year))).sort(), [seasons]);
  const yearSeasons = seasons.filter(item => item.year === year);
  const selectedSeason = seasons.find(item => item.id === seasonId) ?? yearSeasons[0];
  const comparisonMode = seasonId === "all";
  const districts = regions.filter(item => item.type === "district" && item.parentId === "merauke");
  const selectedDistrict = districts.find(item => item.name === district);
  const villages = regions.filter(item => item.type === "village" && item.parentId === selectedDistrict?.id);
  const selectedVillage = villages.find(item => item.name === village);
  const scope = village !== "all" ? `Kampung ${village}` : district !== "all" ? `Distrik ${district}` : "Kabupaten Merauke";
  const scopeKey = selectedVillage?.id ?? selectedDistrict?.id ?? "merauke";
  const scale = village !== "all" ? .035 + stableSeed(scopeKey) % 20 / 1000 : district !== "all" ? .14 + stableSeed(scopeKey) % 12 / 100 : 1;
  const months = useMemo(() => selectedSeason ? seasonMonths(selectedSeason, scopeKey) : [], [selectedSeason, scopeKey]);
  const safeMonth = Math.min(activeMonth, Math.max(0, months.length - 1));
  const month = months[safeMonth];
  const rowNodes = village !== "all" && selectedVillage ? fieldsForVillage(selectedVillage.id) : district !== "all" ? villages : districts;
  const rows = useMemo(() => monitoringRows(rowNodes.map(item => item.name), scopeKey), [rowNodes, scopeKey]);
  const composition = phaseComposition(scopeKey, safeMonth);
  const previousComposition = phaseComposition(scopeKey, Math.max(0, safeMonth - 1));
  const insights = month ? buildSeasonInsights(rows, month, scope) : [];
  const tableTitle = village !== "all" ? `RINCIAN HAMPARAN/KELOMPOK TANI — KAMPUNG ${village.toUpperCase()}` : district !== "all" ? `REALISASI TANAM PER KAMPUNG — DISTRIK ${district.toUpperCase()}` : "REALISASI TANAM PER DISTRIK — KABUPATEN MERAUKE";
  const entityLabel = village !== "all" ? "Hamparan/Kelompok Tani" : district !== "all" ? "Kampung" : "Distrik";

  const changeYear = (next: number) => {
    setYear(next);
    const first = seasons.find(item => item.year === next);
    setSeasonId(first?.id ?? "all");
    setActiveMonth(0);
  };
  const changeSeason = (next: string) => { setSeasonId(next); setActiveMonth(0); };
  const changeDistrict = (next: string) => { setDistrict(next); setVillage("all"); };
  const addSeason = (item: PlantingSeason) => { setSeasons(current => [...current, item]); setYear(item.year); setSeasonId(item.id); setActiveMonth(0); };
  const selectRow = (name: string) => {
    if (village !== "all") return;
    if (district === "all") { setDistrict(name); setVillage("all"); }
    else setVillage(name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <div className="season-command page-enter">
    <section className="season-heading"><div><h1>MUSIM TANAM</h1><p>Pemantauan Musim Tanam Padi · Kabupaten Merauke</p></div><span className="demo-badge"><i className="pulse" /> Data simulasi aktif</span></section>
    <section className="card season-command-bar"><SeasonFilters years={years} year={year} onYear={changeYear} seasons={yearSeasons} seasonId={seasonId} onSeason={changeSeason} /><RegionFilters districts={districts} villages={villages} district={district} village={village} onDistrict={changeDistrict} onVillage={setVillage} /><div className="season-context"><span>♨</span><div><small>Komoditas</small><strong>Padi</strong></div></div><div className="season-context"><span>●</span><div><small>Wilayah Aktif</small><strong>{scope}</strong></div></div><button className="manage-season" onClick={() => setManageOpen(true)}>⚙ Kelola Musim⌄</button></section>
    <RegionBreadcrumb district={district} village={village} />

    {comparisonMode ? <AllSeasonComparison seasons={yearSeasons} /> : selectedSeason && month && <>
      <SeasonCalendar title={selectedSeason.name} months={months} active={safeMonth} onSelect={setActiveMonth} />
      <section className="season-analytics-grid">
        <SeasonSummaryCards title={selectedSeason.name} month={month} scale={scale} scope={scope} />
        <SeasonProgressChart months={months} active={safeMonth} title={selectedSeason.name} scale={scale} />
        <PhaseCompositionChart
          values={composition}
          previousValues={previousComposition}
          total={Math.round(month.realized * scale)}
          label={`${month.label} ${month.year} · ${scope}`}
          validation={month.validation}
          previousLabel={safeMonth > 0 ? `${months[safeMonth - 1].label} ${months[safeMonth - 1].year}` : undefined}
        />
      </section>
      <section className="season-bottom-grid">
        <SeasonMonitoringTable title={tableTitle} rows={rows} entityLabel={entityLabel} onSelect={selectRow} onDetail={setDetail} />
        <SeasonInsights insights={insights} production={Math.round(month.realized * scale * 4.95)} rice={Math.round(month.realized * scale * 3.05)} />
      </section>
    </>}
    {manageOpen && <ManageSeasonModal onClose={() => setManageOpen(false)} onAdd={addSeason} />}
    {detail && <SeasonDetailModal row={detail} onClose={() => setDetail(null)} />}
  </div>;
}

function AllSeasonComparison({ seasons }: { seasons: PlantingSeason[] }) {
  const max = Math.max(...seasons.map(item => item.target), 1);
  return <div className="season-comparison">
    <article className="card comparison-chart"><div className="season-section-title">PERBANDINGAN MUSIM TANAM 2026</div><div className="comparison-bars">{seasons.map(item => <div key={item.id}><span>{item.name}</span><div><i style={{ width: `${item.target / max * 100}%` }} /><em style={{ width: `${item.realized / max * 100}%` }} /></div><strong>{item.target ? Math.round(item.realized / item.target * 100) : 0}%</strong></div>)}</div><div className="comparison-legend"><span>■ Target</span><span>■ Realisasi</span></div></article>
    <article className="card data-table-card comparison-table"><div className="season-section-title">TABEL PERBANDINGAN ANTAR-MUSIM</div><div className="table-scroll"><table><thead><tr><th>Musim</th><th>Periode</th><th>Target</th><th>Realisasi</th><th>Capaian</th><th>Produksi</th><th>Status</th></tr></thead><tbody>{seasons.map(item => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{new Date(item.startDate).toLocaleDateString("id-ID",{month:"short",year:"numeric"})} – {new Date(item.endDate).toLocaleDateString("id-ID",{month:"short",year:"numeric"})}</td><td>{item.target.toLocaleString("id-ID")} ha</td><td>{item.realized.toLocaleString("id-ID")} ha</td><td>{item.target ? (item.realized / item.target * 100).toLocaleString("id-ID",{maximumFractionDigits:1}) : 0}%</td><td>{item.production.toLocaleString("id-ID")} ton</td><td><span className={`season-state ${item.status.toLowerCase()}`}>{item.status}</span></td></tr>)}</tbody></table></div></article>
  </div>;
}
