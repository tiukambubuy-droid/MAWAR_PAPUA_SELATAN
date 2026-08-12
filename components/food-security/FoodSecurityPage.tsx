"use client";

import { useMemo, useRef, useState } from "react";
import { Archive, ArrowDownUp, ShieldCheck, Warehouse, X } from "lucide-react";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { MonitoringLineChart } from "@/components/ui/MonitoringLineChart";
import { getRegionById, regions } from "@/lib/data-foundation";
import { buildFoodSecurityDetailModel, foodSecurityFormula, formatFoodValue, getFoodSecurityChartData, resilienceDisclaimer, resilienceWeights, selectFoodSecurity, type FoodSecurityDetailModel } from "@/lib/food-security-data";
import { resilienceFormulaMetadata, selectOperationalResilience } from "@/lib/resilience-data";
import { formatMonitoringDate, formatMonitoringStatus, formatMonitoringTimestamp } from "@/lib/monitoring-presentation";

const districts = regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district");

const validationLabel = (status: FoodSecurityDetailModel["validationStatus"]) => status === "mixed" ? "Sebagian menunggu validasi" : formatMonitoringStatus(status);

function FoodDetail({ item, onClose }: { item: FoodSecurityDetailModel; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useAccessibleModal(onClose, panel);
  return <div className="monitoring-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div ref={panel} className="monitoring-modal" role="dialog" aria-modal="true" aria-labelledby="food-detail-title" tabIndex={-1}>
      <header><div><span>Ketahanan Pangan · {item.seasonLabel}</span><h2 id="food-detail-title">Detail {item.regionName}</h2><p>{item.scopeType === "regency" ? "Cakupan Kabupaten" : "Cakupan Distrik"}</p></div><button onClick={onClose} aria-label={`Tutup detail ${item.regionName} ${item.seasonLabel}`}><X size={20} aria-hidden="true" /></button></header>
      <div className="monitoring-modal-body">
        <dl className="detail-metrics">
          <div><dt>Stok Bulog</dt><dd>{formatFoodValue(item.bulogStockTon)}</dd></div><div><dt>Cadangan pemerintah</dt><dd>{formatFoodValue(item.governmentReserveTon)}</dd></div><div><dt>Gudang lokal</dt><dd>{formatFoodValue(item.localWarehouseStockTon)}</dd></div><div><dt>Total stok fisik</dt><dd>{formatFoodValue(item.physicalStockTon)}</dd></div>
          <div><dt>Produksi GKG</dt><dd>{formatFoodValue(item.productionGkgTon)}</dd></div><div><dt>Estimasi beras</dt><dd>{formatFoodValue(item.estimatedRiceProductionTon)}</dd></div><div><dt>Pasokan masuk</dt><dd>{formatFoodValue(item.inboundSupplyTon)}</dd></div><div><dt>Pasokan keluar</dt><dd>{formatFoodValue(item.outboundSupplyTon)}</dd></div><div><dt>Susut operasional</dt><dd>{formatFoodValue(item.operationalLossTon)}</dd></div><div><dt>Arus pasokan bersih</dt><dd>{formatFoodValue(item.netSupplyTon)}</dd></div><div><dt>Total ketersediaan</dt><dd>{formatFoodValue(item.balanceAvailabilityTon)}</dd></div>
          <div><dt>Kebutuhan periode</dt><dd>{formatFoodValue(item.seasonNeedTon)}</dd></div><div><dt>Surplus/Defisit</dt><dd>{formatFoodValue(item.surplusDeficitTon)}</dd></div><div><dt>Kebutuhan harian</dt><dd>{formatFoodValue(item.dailyNeedTon)}</dd></div><div><dt>Ketahanan stok</dt><dd>{formatFoodValue(item.stockResilienceDays, "hari")}</dd></div>
        </dl>
        <h3>Formula neraca</h3><p>{foodSecurityFormula.physicalStock}</p><p>Arus bersih = pasokan masuk − pasokan keluar − susut operasional.</p><p>{foodSecurityFormula.riceProduction}</p><p>{foodSecurityFormula.availability}</p><p>{foodSecurityFormula.requirement}</p><p>{foodSecurityFormula.surplus}</p><p>{foodSecurityFormula.stockResilience}</p><p>{foodSecurityFormula.rounding}</p>
        <h3>Periode, sumber, dan validasi</h3><dl className="detail-metrics"><div><dt>Musim</dt><dd>{item.seasonLabel}</dd></div><div><dt>Cut-off</dt><dd>{formatMonitoringDate(item.cutoff)}</dd></div><div><dt>Status monitoring</dt><dd>Dipantau</dd></div><div><dt>Status validasi</dt><dd>{validationLabel(item.validationStatus)}</dd></div><div><dt>Jenis sumber</dt><dd>{formatMonitoringStatus("prototype")}</dd></div><div><dt>Jenis data</dt><dd>{formatMonitoringStatus("simulation")}</dd></div><div><dt>Diperbarui</dt><dd>{formatMonitoringTimestamp(item.updatedAt)}</dd></div></dl><p>Sumber: {item.sourceReference}</p>
        <p className="simulation-disclaimer">{resilienceDisclaimer}</p>
      </div>
      <footer><button onClick={onClose}>Tutup</button></footer>
    </div>
  </div>;
}

export default function FoodSecurityPage() {
  const { filters, setSeason, setDistrict } = useDashboardFilters();
  const [validation, setValidation] = useState("all");
  const [detail, setDetail] = useState<FoodSecurityDetailModel | null>(null);
  const selected = useMemo(() => selectFoodSecurity(filters.seasonId, filters.districtId ?? "93.01", validation), [filters.seasonId, filters.districtId, validation]);
  const metrics = selected.aggregate;
  const activeDetail = useMemo(() => buildFoodSecurityDetailModel(filters.seasonId, filters.districtId ?? "93.01"), [filters.seasonId, filters.districtId]);
  const detailMatchesRegion = detail?.regionId === (filters.districtId ?? "93.01") || (!filters.districtId && detail?.scopeType === "district");
  const visibleDetail = detail?.seasonId === filters.seasonId && detailMatchesRegion ? detail : null;
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
  const balanceComponents = metrics ? [
    ["Stok fisik", metrics.physicalStockTon],
    ["Estimasi beras", metrics.estimatedRiceProductionTon],
    ["Pasokan masuk", metrics.inboundSupplyTon],
    ["Pasokan keluar", -metrics.outboundSupplyTon],
    ["Susut operasional", -metrics.operationalLossTon],
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
          <article className="monitoring-card stock-card"><h2>Komposisi Stok</h2><div className="stock-total"><Archive size={24} aria-hidden="true"/><span>Total stok fisik<strong>{formatFoodValue(metrics!.physicalStockTon)}</strong></span></div><dl>{stockComponents.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatFoodValue(value)}</dd></div>)}</dl>{!filters.districtId && activeDetail && <button onClick={() => setDetail(activeDetail)} aria-label={`Lihat rincian perhitungan Kabupaten Merauke ${seasonName}`}>Lihat rincian perhitungan</button>}</article>
          <article className="monitoring-card resilience-card"><h2>Resiliensi Pangan</h2><div className="resilience-total"><span>Skor simulasi</span><strong>{formatFoodValue(resilience.score,"%")}</strong></div><dl>{resilienceComponents.map(([label,score,weight])=><div key={label}><dt>{label}<small>Bobot {weight*100}%</small></dt><dd>{score===null?"Belum tersedia":`${score.toLocaleString("id-ID",{maximumFractionDigits:1})}%`}</dd></div>)}</dl><p>Kesiapan irigasi menggunakan tingkat fungsional jaringan.</p><p className="simulation-disclaimer">{resilienceDisclaimer}</p><details><summary>Metode perhitungan dan rekonsiliasi</summary><p>{foodSecurityFormula.availability}</p><dl>{balanceComponents.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatFoodValue(value)}</dd></div>)}<div><dt>Total ketersediaan</dt><dd>{formatFoodValue(metrics!.balanceAvailabilityTon)}</dd></div><div><dt>Kebutuhan periode</dt><dd>{formatFoodValue(metrics!.seasonNeedTon)}</dd></div><div><dt>Surplus/Defisit</dt><dd>{formatFoodValue(metrics!.surplusDeficitTon)}</dd></div></dl><p>{foodSecurityFormula.surplus}</p><p>{foodSecurityFormula.rounding}</p><p>{resilienceFormulaMetadata.availability}</p><p>{resilienceFormulaMetadata.production}</p><p>{resilienceFormulaMetadata.inputs}</p><p>{resilienceFormulaMetadata.validation} Filter Status data hanya mengubah presentasi pangan.</p></details></article>
        </div>
      </section>
      <section className="monitoring-card monitoring-table"><h2>Rekap per Distrik</h2><div className="table-scroll"><table><thead><tr><th>Wilayah</th><th>Stok</th><th>Produksi Beras</th><th>Kebutuhan</th><th>Surplus/Defisit</th><th>Ketahanan</th><th>Validasi</th><th>Detail</th></tr></thead><tbody>{selected.items.map(item => <tr key={item.record.id}><td>{getRegionById(item.record.region_id)?.name}</td><td>{formatFoodValue(item.physicalStockTon)}</td><td>{formatFoodValue(item.estimatedRiceProductionTon)}</td><td>{formatFoodValue(item.seasonNeedTon)}</td><td>{formatFoodValue(item.surplusDeficitTon)}</td><td>{formatFoodValue(item.stockResilienceDays,"hari")}</td><td>{item.record.validation_status === "approved" ? "Disetujui" : "Menunggu validasi"}</td><td><button onClick={() => setDetail(buildFoodSecurityDetailModel(item.record.season_id, item.record.region_id))} aria-label={`Buka detail ${getRegionById(item.record.region_id)?.name}`}>Detail</button></td></tr>)}</tbody></table></div></section>
      <section className="monitoring-card monitoring-insight"><h2>Insight berbasis aturan</h2><p>{metrics!.surplusDeficitTon >= 0 ? "Neraca simulasi menunjukkan surplus pada cakupan terpilih." : "Neraca simulasi menunjukkan defisit pada cakupan terpilih."}</p><small>Insight otomatis berbasis atribut tersedia, bukan AI generatif.</small></section>
    </>}
    {visibleDetail && <FoodDetail item={visibleDetail} onClose={() => setDetail(null)} />}
  </div>;
}
