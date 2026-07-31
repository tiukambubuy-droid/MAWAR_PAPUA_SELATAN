"use client";
import { useMemo, useState } from "react";
import { plantingSeasons as initialSeasons } from "@/data/planting-seasons";
import { monitoringRows, phaseComposition, seasonMonths } from "@/lib/season-aggregations";
import { aggregateRegion, getChildrenByRegionId, getRegionById, getSeasonKpis, regions } from "@/lib/data-foundation";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";
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
  const [manageOpen, setManageOpen] = useState(false);
  const [detail, setDetail] = useState<MonitoringRow | null>(null);
  const { filters, setSeason, setDistrict, setVillage, setSnapshot } = useDashboardFilters();
  const { seasonId, districtId, villageId, snapshotId } = filters;
  const years = useMemo(() => Array.from(new Set(seasons.map(item => item.year))).sort(), [seasons]);
  const yearSeasons = seasons.filter(item => item.year === year);
  const selectedSeason = seasons.find(item => item.id === seasonId) ?? yearSeasons[0];
  const districts = regions.filter(item => item.administrative_type === "district" && item.parent_id === "93.01");
  const selectedDistrict = getRegionById(districtId ?? "");
  const villages = districtId ? getChildrenByRegionId(districtId) : [];
  const selectedVillage = getRegionById(villageId ?? "");
  const scope = selectedVillage
    ? `${selectedVillage.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung"} ${selectedVillage.name}`
    : selectedDistrict ? `Distrik ${selectedDistrict.name}` : "Kabupaten Merauke";
  const scopeKey = selectedVillage?.id ?? selectedDistrict?.id ?? "93.01";
  const regencyTotal = selectedSeason ? aggregateRegion("93.01", selectedSeason.id).planting_realization_ha : 0;
  const scopeTotal = selectedSeason ? aggregateRegion(scopeKey, selectedSeason.id).planting_realization_ha : 0;
  const scale = regencyTotal ? scopeTotal / regencyTotal : 0;
  const months = selectedSeason ? seasonMonths(selectedSeason, scopeKey) : [];
  const snapshotPeriod = snapshotId?.split(":").at(-1);
  const requestedMonth = months.findIndex(item => item.key === snapshotPeriod);
  const safeMonth = requestedMonth >= 0 ? requestedMonth : Math.max(0, months.length - 1);
  const month = months[safeMonth];
  const scopeKpis = selectedSeason ? getSeasonKpis(selectedSeason.id, scopeKey) : null;
  const rowNodes = selectedVillage ? [selectedVillage] : selectedDistrict ? villages : districts;
  const rows = monitoringRows(rowNodes.map(item => item.name), scopeKey, selectedSeason?.id);
  const composition = phaseComposition(scopeKey, safeMonth, selectedSeason?.id);
  const previousComposition = phaseComposition(scopeKey, Math.max(0, safeMonth - 1), selectedSeason?.id);
  const insights = month ? buildSeasonInsights(rows, month, scope) : [];
  const tableTitle = selectedVillage
    ? `RINCIAN DATA — KAMPUNG/KELURAHAN ${selectedVillage.name.toUpperCase()}`
    : selectedDistrict
      ? `REALISASI TANAM PER KAMPUNG/KELURAHAN — DISTRIK ${selectedDistrict.name.toUpperCase()}`
      : "REALISASI TANAM PER DISTRIK — KABUPATEN MERAUKE";
  const entityLabel = selectedDistrict || selectedVillage ? "Kampung/Kelurahan" : "Distrik";
  const unavailable = (selectedDistrict && selectedDistrict.monitoring_status !== "active") ||
    (selectedVillage && selectedVillage.monitoring_status !== "active");

  const changeYear = (next: number) => {
    setYear(next);
    const first = seasons.find(item => item.year === next);
    if (first) setSeason(first.id);
  };
  const addSeason = (item: PlantingSeason) => { setSeasons(current => [...current, item]); setYear(item.year); };
  const selectRow = (name: string) => {
    if (selectedVillage) return;
    const region = rowNodes.find(item => item.name === name);
    if (!region) return;
    if (!selectedDistrict) setDistrict(region.id);
    else setVillage(region.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <div className="season-command page-enter">
    <section className="season-heading"><div><h1>MUSIM TANAM</h1><p>Pemantauan musim tanam padi Papua Selatan</p><span className="prototype-scope">Cakupan data aktif: Kabupaten Merauke</span></div><span className="demo-badge"><i className="pulse" /> Data simulasi aktif</span></section>
    <section className="card season-command-bar"><SeasonFilters years={years} year={year} onYear={changeYear} seasons={yearSeasons} seasonId={seasonId} onSeason={value => { setSeason(value); setDetail(null); }} /><RegionFilters districts={districts} villages={villages} districtId={districtId} villageId={villageId} onDistrict={value => { setDistrict(value); setDetail(null); }} onVillage={value => { setVillage(value); setDetail(null); }} /><div className="season-context"><span>♨</span><div><small>Komoditas</small><strong>Padi</strong></div></div><div className="season-context"><span>●</span><div><small>Wilayah Aktif</small><strong>{scope}</strong></div></div><button className="manage-season" onClick={() => setManageOpen(true)}>⚙ Kelola Musim⌄</button></section>
    <RegionBreadcrumb district={selectedDistrict?.name ?? "all"} village={selectedVillage?.name ?? "all"} />
    {unavailable ? <section className="card">Belum dipantau — belum tersedia data terverifikasi untuk wilayah ini.</section> : selectedSeason && month && <>
      <SeasonCalendar title={selectedSeason.name} months={months} active={safeMonth} onSelect={index => setSnapshot(`${seasonId}:${months[index].key}`)} />
      <section className="season-analytics-grid">
        <SeasonSummaryCards title={selectedSeason.name} month={month} scale={scale} scope={scope} production={scopeKpis?.aggregate.gkg_production_ton ?? 0} rice={scopeKpis?.estimated_rice_ton ?? 0} />
        <SeasonProgressChart months={months} active={safeMonth} title={selectedSeason.name} seasonId={seasonId} scale={scale} />
        <PhaseCompositionChart values={composition} previousValues={previousComposition} total={Math.round(month.realized * scale)} label={`${month.label} ${month.year} · ${scope}`} validation={month.validation} previousLabel={safeMonth > 0 ? `${months[safeMonth - 1].label} ${months[safeMonth - 1].year}` : undefined} />
      </section>
      <section className="season-bottom-grid">
        <SeasonMonitoringTable key={`${seasonId}:${scopeKey}`} title={tableTitle} rows={rows} entityLabel={entityLabel} onSelect={selectRow} onDetail={setDetail} />
        <SeasonInsights insights={insights} production={Math.round(scopeKpis?.aggregate.gkg_production_ton ?? 0)} rice={Math.round(scopeKpis?.estimated_rice_ton ?? 0)} />
      </section>
    </>}
    {manageOpen && <ManageSeasonModal onClose={() => setManageOpen(false)} onAdd={addSeason} />}
    {detail && <SeasonDetailModal row={detail} onClose={() => setDetail(null)} />}
  </div>;
}
