"use client";

import { useMemo, useRef, useState } from "react";
import { Archive, ArrowDownUp, ShieldCheck, Warehouse, X } from "lucide-react";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { getRegionById, regions } from "@/lib/data-foundation";
import { foodAvailabilityScore, formatFoodValue, resilienceDisclaimer, resilienceWeights, selectFoodSecurity, type FoodSecurityMetrics } from "@/lib/food-security-data";

const districts = regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district");

function FoodDetail({ item, onClose }: { item: FoodSecurityMetrics; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useAccessibleModal(onClose);
  const region = getRegionById(item.record.region_id);
  return <div className="monitoring-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div ref={panel} className="monitoring-modal" role="dialog" aria-modal="true" aria-labelledby="food-detail-title">
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
  const availability = foodAvailabilityScore(metrics);
  const production = metrics?.estimatedRiceProductionTon ?? null;
  const need = metrics?.seasonNeedTon ?? null;
  const productionAchievement = production !== null && need && need > 0 ? Math.min(100, production / need * 100) : null;
  const validationScore = metrics?.total ? metrics.approved / metrics.total * 100 : null;
  const resilienceComponents = [
    ["Ketersediaan", availability, resilienceWeights.availability],
    ["Capaian produksi", productionAchievement, resilienceWeights.productionAchievement],
    ["Kesiapan irigasi", null, resilienceWeights.irrigationReadiness],
    ["Pemenuhan sarana", null, resilienceWeights.productionInputFulfillment],
    ["Validasi", validationScore, resilienceWeights.validation],
  ] as const;
  const kpis = [
    ["Stok Fisik Tercatat", metrics?.physicalStockTon ?? null, "ton"],
    ["Ketersediaan Neraca", metrics?.balanceAvailabilityTon ?? null, "ton"],
    ["Kebutuhan Periode", metrics?.seasonNeedTon ?? null, "ton"],
    ["Surplus/Defisit", metrics?.surplusDeficitTon ?? null, "ton"],
    ["Ketahanan Stok", metrics?.stockResilienceDays ?? null, "hari"],
    ["Indikator Resiliensi", null, "%"],
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
      <section className="monitoring-kpis">{kpis.map(([label, value, unit], index) => <article key={label}><i>{index < 3 ? <Warehouse size={20}/> : <ArrowDownUp size={20}/>}</i><span>{label}</span><strong>{index === 5 ? "Sementara" : formatFoodValue(value, unit)}</strong>{index === 5 && <small>Menunggu integrasi irigasi dan sarana</small>}</article>)}</section>
      <section className="monitoring-grid two">
        <article className="monitoring-card"><h2>Ketersediaan vs Kebutuhan</h2><div className="balance-bars" role="img" aria-label="Perbandingan ketersediaan dan kebutuhan pangan"><span>Ketersediaan<b style={{width:`${Math.min(100, (metrics!.balanceAvailabilityTon / Math.max(metrics!.balanceAvailabilityTon, metrics!.seasonNeedTon)) * 100)}%`}}/></span><strong>{formatFoodValue(metrics!.balanceAvailabilityTon)}</strong><span>Kebutuhan<b className="need" style={{width:`${Math.min(100, (metrics!.seasonNeedTon / Math.max(metrics!.balanceAvailabilityTon, metrics!.seasonNeedTon)) * 100)}%`}}/></span><strong>{formatFoodValue(metrics!.seasonNeedTon)}</strong></div></article>
        <article className="monitoring-card"><h2>Komposisi Stok</h2><div className="stock-composition"><Archive size={34}/><strong>{formatFoodValue(metrics!.physicalStockTon)}</strong><p>Bulog, cadangan pemerintah, dan gudang lokal.</p></div></article>
      </section>
      <section className="monitoring-card resilience-card"><h2>Resiliensi Pangan</h2><p className="simulation-disclaimer">{resilienceDisclaimer}</p><div>{resilienceComponents.map(([label, score, weight]) => <span key={label}><b>{label}</b><i>{score === null ? "Belum tersedia" : `${score.toLocaleString("id-ID", {maximumFractionDigits:1})}%`}</i><small>Bobot {weight * 100}%</small></span>)}</div><p>IKP/FSVA resmi: <b>Belum tersedia</b>. Skor final belum dihitung sampai komponen wajib tersedia.</p></section>
      <section className="monitoring-card monitoring-table"><h2>Rekap per Distrik</h2><div className="table-scroll"><table><thead><tr><th>Wilayah</th><th>Stok</th><th>Produksi Beras</th><th>Kebutuhan</th><th>Surplus/Defisit</th><th>Ketahanan</th><th>Validasi</th><th>Detail</th></tr></thead><tbody>{selected.items.map(item => <tr key={item.record.id}><td>{getRegionById(item.record.region_id)?.name}</td><td>{formatFoodValue(item.physicalStockTon)}</td><td>{formatFoodValue(item.estimatedRiceProductionTon)}</td><td>{formatFoodValue(item.seasonNeedTon)}</td><td>{formatFoodValue(item.surplusDeficitTon)}</td><td>{formatFoodValue(item.stockResilienceDays,"hari")}</td><td>{item.record.validation_status}</td><td><button onClick={() => setDetail(item)} aria-label={`Buka detail ${getRegionById(item.record.region_id)?.name}`}>Detail</button></td></tr>)}</tbody></table></div></section>
      <section className="monitoring-card monitoring-insight"><h2>Insight berbasis aturan</h2><p>{metrics!.surplusDeficitTon >= 0 ? "Neraca simulasi menunjukkan surplus pada cakupan terpilih." : "Neraca simulasi menunjukkan defisit pada cakupan terpilih."}</p><small>Insight otomatis berbasis atribut tersedia, bukan AI generatif.</small></section>
    </>}
    {detail && <FoodDetail item={detail} onClose={() => setDetail(null)} />}
  </div>;
}
