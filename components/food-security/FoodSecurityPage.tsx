"use client";

import { useMemo, useRef, useState } from "react";
import { Archive, ArrowDownUp, ShieldCheck, Warehouse, X } from "lucide-react";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { MonitoringLineChart } from "@/components/ui/MonitoringLineChart";
import { getRegionById, regions } from "@/lib/data-foundation";
import { formatFoodValue, getFoodSecurityChartData, resilienceDisclaimer, resilienceWeights, selectFoodSecurity, type FoodSecurityMetrics } from "@/lib/food-security-data";
import { resilienceFormulaMetadata, selectOperationalResilience } from "@/lib/resilience-data";

const districts = regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district");

function FoodDetail({ item, onClose }: { item: FoodSecurityMetrics; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useAccessibleModal(onClose, panel);
  const region = getRegionById(item.record.region_id);
  return <div className="monitoring-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div ref={panel} className="monitoring-modal" role="dialog" aria-modal="true" aria-labelledby="food-detail-title" tabIndex={-1}>
      <header><div><span>Ketahanan Pangan</span><h2 id="food-detail-title">Detail {region?.name}</h2></div><button onClick={onClose} aria-label={`Tutup detail ${region?.name}`}><X size={20} aria-hidden="true" /></button></header>
      <div className="monitoring-modal-body">
        <dl className="detail-metrics"><div><dt>Stok fisik</dt><dd>{formatFoodValue(item.physicalStockTon)}</dd></div><div><dt>Produksi beras</dt><dd>{formatFoodValue(item.estimatedRiceProductionTon)}</dd></div><div><dt>Kebutuhan musim</dt><dd>{formatFoodValue(item.seasonNeedTon)}</dd></div><div><dt>Surplus/Defisit</dt><dd>{formatFoodValue(item.surplusDeficitTon)}</dd></div></dl>
        <h3>Sumber dan validasi</h3><p>{item.record.source_reference}</p><p>Status validasi: <b>{item.record.validation_status}</b> · Data simulasi prototipe tingkat distrik.</p>
        <h3>Formula</h3><p>Stok + produksi beras + pasokan masuk − pasokan keluar − susut operasional − kebutuhan periode.</p>
        <p className="simulation-disclaimer">{resilienceDisclaimer}</p>
      </div>
      <footer><button onClick={onClose}>Tutup</button></footer>
    </div>
  </div>;
}

export default function FoodSecurityPage() {
  const { filters, setSeason, setDistrict } = useDashboardFilters();
  const [validation, setValidation] = useState("all");
  const [detail, setDetail] = useState<FoodSecurityMetrics | null>(null);
  const selected = useMemo(() => selectFoodSecurity(filters.seasonId, filters.districtId ?? "93.01", validation), [filters.seasonId, filters.districtId, validation]);
  const metrics = selected.aggregate;
  const chartData = useMemo(() => getFoodSecurityChartData(filters.seasonId, filters.districtId ?? "93.01", validation), [filters.seasonId, filters.districtId, validation]);
  const resilience = useMemo(() => selectOperationalResilience(filters.seasonId, filters.districtId ?? "93.01"), [filters.seasonId, filters.districtId]);
  const resilienceComponents = [
    ["Ketersediaan", resilience.components.availability, resilienceWeights.availability],
    ["Capaian produksi", resilience.components.productionAchievement, resilienceWeights.productionAchievement],
    ["Kesiapan irigasi", resilience.components.irrigationReadiness, resilienceWeights.irrigationReadiness],
    ["Pemenuhan sarana", resilience.components.productionInputFulfillment, resilienceWeights.productionInputFulfillment],
    ["Validasi", resilience.components.validation, resilienceWeights.validation],
  ] as const;
  const stockComponents = metrics ? [
    ["Bulog", metrics.bulogStockTon],
    ["Cadangan pemerintah", metrics.governmentReserveTon],
    ["Gudang lokal", metrics.localWarehouseStockTon],
  ] as const : [];
  const seasonName = filters.seasonId === "MT1-2026" ? "MT I 2026" : "MT II 2026";
  const kpis = [
    ["Stok Fisik Tercatat", metrics?.physicalStockTon ?? null, "ton"],
    ["Ketersediaan Neraca", metrics?.balanceAvailabilityTon ?? null, "ton"],
    ["Kebutuhan Periode", metrics?.seasonNeedTon ?? null, "ton"],
    ["Surplus/Defisit", metrics?.surplusDeficitTon ?? null, "ton"],
    ["Ketahanan Stok", metrics?.stockResilienceDays ?? null, "hari"],
    ["Indikator Resiliensi", resilience.score, "%"],
  ] as const;
  return <div className="monitoring-page food-security-page">
    <header className="monitoring-heading"><div><span>SIMULASI PROTOTIPE · KABUPATEN MERAUKE</span><h1>KETAHANAN PANGAN</h1><p>Pemantauan Ketersediaan, Kebutuhan, dan Resiliensi Pangan</p></div><ShieldCheck size={34} aria-hidden="true" /></header>
    <section className="monitoring-filters" aria-label="Filter Ketahanan Pangan">
      <label>Musim<select value={filters.seasonId} onChange={event => setSeason(event.target.value)}><option value="MT2-2026">MT II 2026 (Berjalan)</option><option value="MT1-2026">MT I 2026 (Selesai)</option></select></label>
      <label>Kabupaten<select value="93.01" disabled><option>Kabupaten Merauke</option></select></label>
      <label>Distrik<select value={filters.districtId ?? ""} onChange={event => setDistrict(event.target.value || null)}><option value="">Semua distrik terpantau</option>{districts.map(region => <option value={region.id} key={region.id}>{region.name}{region.monitoring_status !== "active" ? " — Belum dipantau" : ""}</option>)}</select></label>
      <label>Status data<select value={validation} onChange={event => setValidation(event.target.value)}><option value="all">Semua</option><option value="approved">Disetujui</option><option value="pending">Menunggu validasi</option></select></label>
    </section>
    {!selected.monitored ? <div className="monitoring-empty" role="status">{filters.districtId && getRegionById(filters.districtId)?.monitoring_status !== "active" ? "Belum dipantau" : "Belum tersedia"}</div> : <>
      <section className="monitoring-kpis">{kpis.map(([label, value, unit], index) => <article key={label}><i>{index < 3 ? <Warehouse size={20}/> : <ArrowDownUp size={20}/>}</i><span>{label}</span><strong>{formatFoodValue(value, unit)}</strong>{index === 5 && <small>{resilience.complete ? "Lima komponen tersedia" : "Komponen wajib belum lengkap"}</small>}</article>)}</section>
      <section className="food-monitoring-layout">
        <article className="monitoring-card food-balance-chart"><h2>Ketersediaan vs Kebutuhan — {seasonName}</h2><p className="chart-subtitle">Perkembangan neraca ketersediaan dan kebutuhan pada musim aktif.</p><MonitoringLineChart key={`${filters.seasonId}:${filters.districtId??"93.01"}:${validation}`} data={chartData} unit="ton" ariaLabel={`Grafik ketersediaan dan kebutuhan pangan ${seasonName}`} showSummaryStrip tooltipVariant="food-security" seriesLabels={{actual:"Ketersediaan",target:"Kebutuhan"}} summaryItemsOverride={[{field:"actual",label:"Ketersediaan pada cut-off",value:metrics!.balanceAvailabilityTon},{field:"target",label:"Kebutuhan pada cut-off",value:metrics!.seasonNeedTon},{field:"balance",label:"Surplus/Defisit",value:metrics!.surplusDeficitTon}]} /></article>
        <div className="food-information-panel">
          <article className="monitoring-card stock-card"><h2>Komposisi Stok</h2><div className="stock-total"><Archive size={24} aria-hidden="true"/><span>Total stok fisik<strong>{formatFoodValue(metrics!.physicalStockTon)}</strong></span></div><dl>{stockComponents.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatFoodValue(value)}</dd></div>)}</dl></article>
          <article className="monitoring-card resilience-card"><h2>Resiliensi Pangan</h2><div className="resilience-total"><span>Skor simulasi</span><strong>{formatFoodValue(resilience.score,"%")}</strong></div><dl>{resilienceComponents.map(([label,score,weight])=><div key={label}><dt>{label}<small>Bobot {weight*100}%</small></dt><dd>{score===null?"Belum tersedia":`${score.toLocaleString("id-ID",{maximumFractionDigits:1})}%`}</dd></div>)}</dl><p>Kesiapan irigasi menggunakan tingkat fungsional jaringan.</p><p className="simulation-disclaimer">{resilienceDisclaimer}</p><details><summary>Metode perhitungan</summary><p>{resilienceFormulaMetadata.availability}</p><p>{resilienceFormulaMetadata.production}</p><p>{resilienceFormulaMetadata.inputs}</p><p>{resilienceFormulaMetadata.validation} Filter Status data hanya mengubah presentasi pangan.</p></details></article>
        </div>
      </section>
      <section className="monitoring-card monitoring-table"><h2>Rekap per Distrik</h2><div className="table-scroll"><table><thead><tr><th>Wilayah</th><th>Stok</th><th>Produksi Beras</th><th>Kebutuhan</th><th>Surplus/Defisit</th><th>Ketahanan</th><th>Validasi</th><th>Detail</th></tr></thead><tbody>{selected.items.map(item => <tr key={item.record.id}><td>{getRegionById(item.record.region_id)?.name}</td><td>{formatFoodValue(item.physicalStockTon)}</td><td>{formatFoodValue(item.estimatedRiceProductionTon)}</td><td>{formatFoodValue(item.seasonNeedTon)}</td><td>{formatFoodValue(item.surplusDeficitTon)}</td><td>{formatFoodValue(item.stockResilienceDays,"hari")}</td><td>{item.record.validation_status}</td><td><button onClick={() => setDetail(item)} aria-label={`Buka detail ${getRegionById(item.record.region_id)?.name}`}>Detail</button></td></tr>)}</tbody></table></div></section>
      <section className="monitoring-card monitoring-insight"><h2>Insight berbasis aturan</h2><p>{metrics!.surplusDeficitTon >= 0 ? "Neraca simulasi menunjukkan surplus pada cakupan terpilih." : "Neraca simulasi menunjukkan defisit pada cakupan terpilih."}</p><small>Insight otomatis berbasis atribut tersedia, bukan AI generatif.</small></section>
    </>}
    {detail && <FoodDetail item={detail} onClose={() => setDetail(null)} />}
  </div>;
}
