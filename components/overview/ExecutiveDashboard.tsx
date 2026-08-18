"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronRight,
  FileClock, Gauge, LandPlot, MapPin, PackageCheck, Sprout,
  Target, Tractor, TrendingUp, Wheat, X,
} from "lucide-react";
import { aggregateProduction, recordsForScope } from "@/lib/production-data";
import {
  aggregateRegion,
  compactYieldNote,
  getRegionById,
  getRegionByName,
  getSeasonById,
  millingYield,
  regions,
  yieldNote,
} from "@/lib/data-foundation";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";
import { compareActualAtEquivalentStage, compareProjectedFinalToCompletedSeason, getChartDataPoints } from "@/lib/chart-data";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { MonitoringLineChart } from "@/components/ui/MonitoringLineChart";
import { fitToBounds } from "@/lib/visualization";
import { createBigMapRequestController, createBigMapViewCallbacks, reduceBigMapViewState, type BigMapRequestController, type BigMapViewState } from "@/lib/big-map-request-controller";
import { displayedExecutiveRegionId } from "@/lib/executive-map-interaction";
import { formatMapRegionLabel } from "@/lib/map-region-search";
import { formatYearOverYearComparison, selectExecutiveYearOverYearComparisons, type YearOverYearIndicatorId } from "@/lib/year-over-year-comparison";

type PageName = "Peta Lahan" | "Musim Tanam" | "Produksi";

const format = (value: number, digits = 0) =>
  value.toLocaleString("id-ID", { maximumFractionDigits: digits });

type GeoFeature = {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
};

const bigDistrictService =
  "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer";

function featureRings(feature: GeoFeature): number[][][] {
  return feature.geometry.type === "Polygon"
    ? feature.geometry.coordinates as number[][][]
    : (feature.geometry.coordinates as number[][][][]).flat();
}

function districtName(feature: GeoFeature) {
  const p = feature.properties;
  return String(p.wadmkc ?? p.namobj ?? p.WADMKC ?? p.NAMOBJ ?? "Distrik");
}

export default function ExecutiveDashboard({ onNavigate }: { onNavigate: (page: PageName) => void }) {
  const { filters, setSeason, setDistrict, setCommodity } = useDashboardFilters();
  const { seasonId, districtId } = filters;
  const currentSeason = getSeasonById(seasonId);
  const [productionDetailOpen, setProductionDetailOpen] = useState(false);

  const productionRows = useMemo(() => recordsForScope("Semua Distrik", "Semua Kampung", seasonId), [seasonId]);
  const regencyProduction = useMemo(() => aggregateProduction(productionRows), [productionRows]);
  const selectedDistrict = districtId ? regions.find(item => item.id === districtId) ?? null : null;
  const districtOptions = regions.filter(item => item.administrative_type === "district" && item.parent_id === "93.01");
  const scope = aggregateRegion(selectedDistrict?.id ?? "93.01", seasonId);
  const production = selectedDistrict
    ? aggregateProduction(recordsForScope(selectedDistrict.name, "Semua Kampung/Kelurahan", seasonId))
    : regencyProduction;
  const planted = Math.round(scope.planting_realization_ha);
  const harvested = Math.round(production.harvested);
  const gkg = Math.round(production.gkg);
  const rice = Math.round(production.rice);
  const target = Math.round(production.target);
  const achievement = target ? gkg / target * 100 : 0;
  const chartScale = regencyProduction.gkg ? production.gkg / regencyProduction.gkg : 0;
  const chartData = getChartDataPoints(seasonId, "gkg_production_ton", regencyProduction.target, chartScale);
  const plantingStage4 = compareActualAtEquivalentStage("MT1-2026", "MT2-2026", 4, "planting_realization_ha");
  const productionStage4 = compareActualAtEquivalentStage("MT1-2026", "MT2-2026", 4, "gkg_production_ton");
  const finalComparison = compareProjectedFinalToCompletedSeason();
  const percentChange = (left: number, right: number) => left ? (right - left) / left * 100 : 0;
  const selectedRow = productionRows.find(row => row.id === districtId);
  const comparisonModels = selectExecutiveYearOverYearComparisons({ seasonId, regionId:selectedDistrict?.id??"93.01", period:currentSeason?.reporting_cutoff??null, monitored:!selectedDistrict||selectedDistrict.monitoring_status==="active", values:{planting_area:planted,harvested_area:harvested,gkg_production:gkg,productivity:production.yieldRate} });
  const comparisons = new Map(comparisonModels.map(model=>[model.indicator_id,model]));

  const kpis = [
    { Icon: Sprout, label: "Luas Tanam", value: format(planted), unit: "ha", indicatorId:"planting_area" as YearOverYearIndicatorId },
    { Icon: LandPlot, label: "Luas Panen", value: format(harvested), unit: "ha", indicatorId:"harvested_area" as YearOverYearIndicatorId },
    { Icon: Wheat, label: "Produksi GKG", value: format(gkg), unit: "ton", indicatorId:"gkg_production" as YearOverYearIndicatorId },
    { Icon: Gauge, label: "Produktivitas", value: format(production.yieldRate, 2), unit: "ton/ha", indicatorId:"productivity" as YearOverYearIndicatorId },
    { Icon: PackageCheck, label: "Estimasi Beras", value: format(rice), unit: "ton", indicatorId:null },
  ];

  return (
    <div className="executive-dashboard page-enter">
      <section className="executive-heading">
        <div>
          <h1>Dashboard Pemantauan Padi dan Ketahanan Pangan</h1>
          <p>Papua Selatan</p>
          <span className="prototype-scope">Cakupan prototipe: Kabupaten Merauke</span>
        </div>
        <button className="report-unavailable" disabled aria-disabled="true" aria-label="Laporan belum tersedia"><FileClock size={17} aria-hidden="true"/> Laporan belum tersedia</button>
      </section>

      <section className="card executive-filters" aria-label="Filter global dashboard">
        <label><span>PERIODE</span><div><CalendarDays size={16}/><select value={seasonId} onChange={e => setSeason(e.target.value)}><option value="MT2-2026">MT II 2026 (Berjalan)</option><option value="MT1-2026">MT I 2026 (Selesai)</option></select></div></label>
        <label><span>WILAYAH</span><div><MapPin size={16}/><select value={districtId ?? ""} onChange={e => setDistrict(e.target.value || null)}><option value="">Kabupaten Merauke</option>{districtOptions.map(row => <option key={row.id} value={row.id}>Distrik {row.name}{row.monitoring_status !== "active" ? " — Belum dipantau" : ""}</option>)}</select></div></label>
        <label><span>KOMODITAS</span><div><Wheat size={16}/><select value={filters.commodityId} onChange={e => setCommodity(e.target.value)}><option value="PADI">Padi</option></select></div></label>
        <div className="executive-season"><span>STATUS MUSIM TANAM</span><strong><i/> {currentSeason?.display_name}</strong></div>
      </section>

      <section className="executive-kpis">
        {kpis.map(({Icon,...item})=>{const comparison=item.indicatorId?comparisons.get(item.indicatorId):null,comparisonText=comparison?formatYearOverYearComparison(comparison):compactYieldNote;return <article className="card" key={item.label}><i><Icon size={26}/></i><div><span>{item.label}</span><strong>{item.value} <small>{item.unit}</small></strong><em className={comparison?.direction==="unavailable"?"comparison-unavailable":undefined} aria-label={comparison?`${item.label}: ${comparisonText}`:undefined}>{comparisonText}</em></div></article>})}
      </section>

      <section className="executive-primary">
        <article className="card executive-map">
          <ExecutiveTitle title="PETA SEBARAN LAHAN" action={() => onNavigate("Peta Lahan")}/>
          <ExecutiveBigMap selectedRegionId={selectedDistrict?.id ?? null} selectedLabel={selectedDistrict ? `Distrik ${selectedDistrict.name}` : "Kabupaten Merauke"} hint={selectedDistrict?.monitoring_status === "not_monitored" ? "Belum dipantau" : selectedRow ? `${format(selectedRow.gkg)} ton GKG · wilayah terpantau` : "Pilih distrik untuk melihat data"} onSelect={setDistrict}/>
        </article>

        <article className="card executive-chart">
          <ExecutiveTitle title={`TARGET VS REALISASI PRODUKSI GKG — ${currentSeason?.name ?? ""}`} action={() => setProductionDetailOpen(true)}/>
          <MonitoringLineChart data={chartData} unit="ton" selectedId={filters.snapshotId ?? undefined} ariaLabel="Grafik target dan realisasi produksi GKG" showSummaryStrip summaryStatus={currentSeason?.status} showPersistentValueLabels={false} />
        </article>
      </section>

      <section className="executive-secondary">
        <div className="executive-secondary-left">
          <article className="card current-season"><ExecutiveTitle title="MUSIM TANAM TERPILIH"/><div><strong>{currentSeason?.display_name} <b>{currentSeason?.status === "completed" ? "Selesai" : "Berjalan"}</b></strong><span>Cakupan</span><em>{selectedDistrict ? `Distrik ${selectedDistrict.name}` : "Kabupaten Merauke"}</em><i><b style={{width:`${Math.min(100, achievement)}%`}}/></i><span>Cut-off</span><strong>{currentSeason?.reporting_cutoff}</strong><span>Status Data</span><b className="normal">Terpantau</b></div></article>
          <article className="card production-recap"><ExecutiveTitle title="RINGKASAN PRODUKSI"/><div><p>Produksi GKG <b>{format(gkg)} ton</b></p><p>Estimasi Beras <b>{format(rice)} ton</b></p><p>Produktivitas <b>{format(production.yieldRate,2)} ton/ha</b></p><p>Target Produksi <b>{format(target)} ton</b></p><strong>Capaian Target <b>{format(achievement,1)}%</b></strong></div></article>
        </div>
        <article className="card top-regions"><ExecutiveTitle title="WILAYAH KONTRIBUTOR TERBESAR" action={() => onNavigate("Produksi")}/><div>{productionRows.slice().sort((a,b)=>b.gkg-a.gkg).slice(0,5).map(row=><p key={row.id}><span>{row.name}</span><i><b style={{width:`${row.gkg/Math.max(...productionRows.map(item=>item.gkg))*100}%`}}/></i><strong>{format(row.gkg)}</strong><em>{format(row.gkg/production.gkg*100,1)}%</em></p>)}</div></article>
        <article className="card system-summary"><ExecutiveTitle title="RINGKASAN SISTEM"/><div>{[
          `Luas tanam mencapai ${format(planted)} ha. Pembanding 2025 belum tersedia.`,
          `Fase dominan mengikuti data monitoring ${currentSeason?.name ?? "musim terpilih"}.`,
          `Produksi GKG mencapai ${format(gkg)} ton atau ${format(achievement,1)}% dari target.`,
          `Estimasi beras mencapai ${format(rice)} ton. ${yieldNote}`,
          `Validasi data mencapai ${format(scope.validation_rate)}%.`,
          seasonId === "MT2-2026" && plantingStage4
            ? `Realisasi tanam MT II pada tahap ke-4 meningkat ${format(percentChange(plantingStage4.left, plantingStage4.right), 1)}% dibandingkan tahap ke-4 MT I.`
            : "MT I merupakan musim selesai dan menjadi baseline pembanding untuk MT II.",
          seasonId === "MT2-2026" && productionStage4
            ? `Produksi GKG MT II pada tahap ke-4 meningkat ${format(percentChange(productionStage4.left, productionStage4.right), 1)}% dibandingkan tahap ke-4 MT I.`
            : "Capaian MT I menggunakan realisasi akhir musim.",
          seasonId === "MT2-2026"
            ? "Perbandingan tahap setara: Januari MT I dan Juli MT II."
            : "Perbandingan tahap setara ditampilkan ketika MT II dipilih.",
          seasonId === "MT2-2026" && finalComparison
            ? `Proyeksi akhir MT II ${format(finalComparison.projection)} ton dibandingkan realisasi akhir MT I ${format(finalComparison.actual)} ton.`
            : seasonId === "MT2-2026" ? "Proyeksi akhir belum tersedia." : "MT I merupakan realisasi musim selesai.",
        ].map(text=><p key={text}><CheckCircle2 size={13}/>{text}</p>)}<button onClick={()=>onNavigate("Produksi")}>Lihat Semua Insight <ChevronRight size={15}/></button></div></article>
      </section>

      <section className="card executive-alerts"><ExecutiveTitle title="ALERT & INFORMASI PENTING"/><div><AlertItem Icon={CalendarDays} title={currentSeason?.display_name ?? "Musim terpilih"} text={`Cut-off ${currentSeason?.reporting_cutoff ?? "-"}`}/><AlertItem Icon={Target} title={`Capaian produksi ${format(achievement, 1)}%`} text="Berdasarkan target dan realisasi terpilih" warn={achievement < 95}/><AlertItem Icon={TrendingUp} title="Rendemen standar Papua" text={`${format(millingYield.rate, 2)}% · SKGB BPS 2018`}/><AlertItem Icon={Tractor} title={`Validasi data ${format(scope.validation_rate)}%`} text="Sumber: Dinas Pertanian & BPS" warn/></div></section>
      {productionDetailOpen && <ExecutiveProductionModal
        production={gkg}
        target={target}
        rice={rice}
        harvested={harvested}
        yieldRate={production.yieldRate}
        achievement={achievement}
        seasonName={currentSeason?.display_name ?? ""}
        cutoff={currentSeason?.reporting_cutoff ?? ""}
        scopeName={selectedDistrict ? `Distrik ${selectedDistrict.name}` : "Kabupaten Merauke"}
        onClose={() => setProductionDetailOpen(false)}
        onOpenProduction={() => { setProductionDetailOpen(false); onNavigate("Produksi"); }}
      />}
    </div>
  );
}

function ExecutiveTitle({ title, action }: { title: string; action?: () => void }) {
  return <div className="executive-title"><strong>{title}</strong>{action && <button onClick={action}>Lihat Detail <ChevronRight size={14}/></button>}</div>;
}

function AlertItem({ Icon, title, text, warn, blue }: { Icon: typeof Target; title: string; text: string; warn?: boolean; blue?: boolean }) {
  return <article className={warn ? "warn" : blue ? "blue" : ""}><Icon size={25}/><div><strong>{title}</strong><span>{text}</span></div></article>;
}

function ExecutiveBigMap({ selectedRegionId, selectedLabel, hint, onSelect }: { selectedRegionId: string | null; selectedLabel: string; hint: string; onSelect: (regionId: string) => void }) {
  // Executive preview contract: district click/keyboard selection only. Full zoom,
  // pan, reset and drag interactions remain on the dedicated Peta Lahan page.
  const [mapState, dispatchMapState] = useReducer(
    reduceBigMapViewState<GeoFeature>,
    { features: [], sourceMode: "big", status: "loading", context: null } satisfies BigMapViewState<GeoFeature>,
  );
  const requestControllerRef = useRef<BigMapRequestController<GeoFeature> | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [focusedRegionId, setFocusedRegionId] = useState<string | null>(null);

  useEffect(() => {
    const controller = createBigMapRequestController<GeoFeature>({
      loadRemote: async (_context, signal) => {
        const query = new URLSearchParams({
          where: "wadmkk='Merauke'",
          outFields: "namobj,wadmkc,wadmkk,wadmpr",
          returnGeometry: "true",
          outSR: "4326",
          geometryPrecision: "4",
          maxAllowableOffset: "0.001",
          f: "geojson",
        });
        const response = await fetch(`${bigDistrictService}/0/query?${query}`, { signal });
        if (!response.ok) throw new Error("BIG unavailable");
        const data = await response.json();
        return Array.isArray(data.features) ? data.features : [];
      },
      loadFallback: async (_context, signal) => {
        const response = await fetch("/data/merauke-districts.geojson", { signal });
        if (!response.ok) throw new Error("Fallback BIG unavailable");
        const data = await response.json();
        return Array.isArray(data.features) ? data.features : [];
      },
    }, createBigMapViewCallbacks<GeoFeature>(dispatchMapState));
    requestControllerRef.current = controller;
    void controller.load({ requestKey: "executive-merauke-districts", regionId: "93.01", regionLevel: "district" });
    return () => { controller.dispose(); requestControllerRef.current = null; };
  }, []);

  const features = mapState.features;

  const model = useMemo(() => {
    const points = features.flatMap(feature => featureRings(feature).flat());
    if (!points.length) return [];
    const width = 900, height = 480, pad = 12;
    const camera = fitToBounds(points as [number, number][], width, height, pad);
    if (!camera.bounds) return [];
    const project = ([lon, lat]: number[]) => [camera.offsetX + (lon - camera.bounds!.minX) * camera.scale, height - camera.offsetY - (lat - camera.bounds!.minY) * camera.scale];
    return features.map(feature => {
      const projected = featureRings(feature).map(ring => ring.map(project));
      const path = projected.map(ring => ring.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ") + " Z").join(" ");
      const outer = projected[0] ?? [];
      const center: [number, number] = outer.length ? [
        outer.reduce((sum, point) => sum + point[0], 0) / outer.length,
        outer.reduce((sum, point) => sum + point[1], 0) / outer.length,
      ] : [0, 0];
      const region = getRegionByName(districtName(feature), "district");
      return region ? { regionId: region.id, name: region.name, path, center } : null;
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  }, [features]);

  const displayedRegionId = displayedExecutiveRegionId({ hoveredRegionId, focusedRegionId, selectedRegionId });
  const visibleName = displayedRegionId ? getRegionById(displayedRegionId)?.name ?? null : null;

  return <div className="executive-map-stage">
    <div className="executive-map-canvas">{model.length ? <svg viewBox="0 0 900 480" role="img" aria-label="Peta resmi distrik Kabupaten Merauke dari BIG">
      <g className="executive-big-layer">
        {model.map((item, index) => <g key={item.regionId} data-region-id={item.regionId} className={selectedRegionId === item.regionId ? "selected" : ""} onClick={() => onSelect(item.regionId)} role="button" tabIndex={0}
          onMouseEnter={() => setHoveredRegionId(item.regionId)} onMouseLeave={() => setHoveredRegionId(null)}
          onFocus={() => setFocusedRegionId(item.regionId)} onBlur={() => setFocusedRegionId(null)}
          onKeyDown={event => { if (event.key === "Escape") { setHoveredRegionId(null); setFocusedRegionId(null); } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item.regionId); } }}>
          <path d={item.path} className={`tone-${index % 3}`} vectorEffect="non-scaling-stroke"/>
          <title>{item.name}</title>
        </g>)}
      </g>
    </svg> : mapState.status === "error" ? <div className="executive-map-error" role="status"><strong>Peta pratinjau belum tersedia.</strong><span>Buka Peta Lahan melalui Lihat Detail untuk pemantauan lengkap.</span></div> : <div className="executive-map-loading" role="status">Memuat peta BIG…</div>}</div>
    {model.length > 0 && visibleName && <div className="executive-map-region-tooltip" role="status">{formatMapRegionLabel(visibleName, "Distrik")}</div>}
    <div className="executive-map-footer">
      <div className="executive-map-source"><span>◉</span> Badan Informasi Geospasial · WGS 84 · {mapState.sourceMode === "fallback" ? "cadangan BIG" : "BIG"}</div>
      <div className="map-selection"><MapPin size={19}/><span><b>{selectedLabel}</b><small>{hint}</small></span></div>
    </div>
  </div>;
}

function ExecutiveProductionModal({
  production, target, rice, harvested, yieldRate, achievement, seasonName, cutoff, scopeName, onClose, onOpenProduction,
}: {
  production: number; target: number; rice: number; harvested: number; yieldRate: number; achievement: number;
  seasonName: string; cutoff: string; scopeName: string;
  onClose: () => void; onOpenProduction: () => void;
}) {
  useAccessibleModal(onClose);

  return createPortal(<div className="executive-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="executive-production-modal" role="dialog" aria-modal="true" aria-labelledby="executive-production-title">
      <header>
        <div><span>DETAIL PRODUKSI WILAYAH</span><h2 id="executive-production-title">Target vs Realisasi Produksi GKG</h2><p>{seasonName} · Cut-off {cutoff} · {scopeName}</p></div>
        <button onClick={onClose} aria-label="Tutup modal"><X size={20}/></button>
      </header>
      <div className="executive-modal-body">
        <div className="executive-modal-kpis">
          <article><span>Target Produksi</span><strong>{format(target)} <small>ton</small></strong></article>
          <article><span>Realisasi GKG</span><strong>{format(production)} <small>ton</small></strong></article>
          <article><span>Capaian Target</span><strong>{format(achievement, 1)}%</strong></article>
          <article><span>Estimasi Beras</span><strong>{format(rice)} <small>ton</small></strong></article>
          <article><span>Luas Panen</span><strong>{format(harvested)} <small>ha</small></strong></article>
          <article><span>Produktivitas</span><strong>{format(yieldRate, 2)} <small>ton/ha</small></strong></article>
        </div>
        <article className="executive-modal-analysis">
          <h3>Perkembangan Realisasi</h3>
          <div className="executive-progress"><i><b style={{ width: `${Math.min(100, achievement)}%` }}/></i><span>{format(achievement, 1)}%</span></div>
          <p>Realisasi produksi telah mencapai {format(production)} ton GKG. Dengan produktivitas rata-rata {format(yieldRate, 2)} ton/ha, capaian berada dalam kategori terpantau untuk {seasonName}.</p>
        </article>
        <article className="executive-modal-insight">
          <h3>Insight Pimpinan</h3>
          <p><CheckCircle2 size={16}/> Produksi kumulatif bergerak mendekati target akhir musim.</p>
          <p><TrendingUp size={16}/> Proyeksi tetap positif apabila luas panen dan produktivitas dapat dipertahankan.</p>
          <p><AlertTriangle size={16}/> Validasi lapangan perlu dilanjutkan pada wilayah dengan status waspada.</p>
        </article>
      </div>
      <footer><span>Data demonstrasi · sumber Dinas Pertanian, PPL, dan simulasi sistem</span><div><button onClick={onClose}>Tutup</button><button className="primary" onClick={onOpenProduction}>Buka Dashboard Produksi <ChevronRight size={16}/></button></div></footer>
    </section>
  </div>, document.body);
}
