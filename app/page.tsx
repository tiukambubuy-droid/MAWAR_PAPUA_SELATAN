"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { BarChart3, ChevronDown, CloudSun, FileText, LayoutDashboard, Map, Search, ShieldCheck, Sprout, X } from "lucide-react";
import SeasonCommandCenter from "@/components/season/SeasonPage";
import ProductionCommandCenter from "@/components/production/ProductionPage";
import ExecutiveDashboard from "@/components/overview/ExecutiveDashboard";
import FoodSecurityPage from "@/components/food-security/FoodSecurityPage";
import { DashboardFilterProvider, useDashboardFilters } from "@/components/DashboardFilterProvider";
import {
  aggregateRegion,
  getActiveMonitoringRegionCounts,
  getChildrenByRegionId,
  getRegionById,
  getRegionByName,
  getSeasonById,
  regions,
} from "@/lib/data-foundation";
import { createBigMapRequestController, createBigMapViewCallbacks, reduceBigMapViewState, type BigMapRequestController, type BigMapViewState } from "@/lib/big-map-request-controller";
import { phaseColors, reduceMapBreadcrumb, riskColors, selectPhaseMonitoring, selectRiskMonitoring } from "@/lib/map-monitoring";
import { defineLandMetric, formatPresentationValue, getValidationSummary, resolveTableRegionNames } from "@/lib/presentation-selectors";
import { clampPan, clampZoom, fitToBounds, isMapDrag, prioritizedMapLabels, resetMapCamera } from "@/lib/visualization";
import { createMapRegionOptions, districtIdForMapRegion, filterMapRegionOptions, formatMapRegionLabel, REGION_SEPARATOR } from "@/lib/map-region-search";

const activeRegionCounts = getActiveMonitoringRegionCounts();
const canonicalDistrictNames = regions
  .filter(region => region.administrative_type === "district" && region.parent_id === "93.01")
  .map(region => region.name)
  .sort((a, b) => a.localeCompare(b, "id"));
const mapRegionOptions = createMapRegionOptions(regions);

const nav = [
  { Icon: LayoutDashboard, label: "Ringkasan", enabled: true },
  { Icon: Map, label: "Peta Lahan", enabled: true },
  { Icon: Sprout, label: "Musim Tanam", enabled: true },
  { Icon: BarChart3, label: "Produksi", enabled: true },
  { Icon: ShieldCheck, label: "Ketahanan Pangan", enabled: true },
  { Icon: CloudSun, label: "Risiko & Iklim", enabled: false },
  { Icon: FileText, label: "Laporan", enabled: false },
];

type MapLevel = "province" | "district";
type LandLayer = "Luas Tanam" | "Fase Tanam" | "Tingkat Risiko";
type LandTableRow = { cells: string[]; statusIndex: number; validationIndex: number };

const regencyRows: LandTableRow[] = [
  { cells: ["Merauke", "22 distrik", "38.180 ha", "31.854 ha", "174.577 ton", "Aktif", "91%"], statusIndex: 5, validationIndex: 6 },
];

function districtVillageCount(name: string) {
  const district = getRegionByName(name, "district");
  return district ? getChildrenByRegionId(district.id).length : 0;
}

const plantingPhases = Object.keys(phaseColors);
const riskLevels = Object.keys(riskColors);

function profileRegionId(name: string) {
  return getRegionByName(name, "district")?.id ??
    getRegionByName(name, "kampung")?.id ??
    getRegionByName(name, "kelurahan")?.id ??
    "93.01";
}

function phaseProfile(name: string, seasonId: string, regionId = profileRegionId(name)) {
  const selected = selectPhaseMonitoring(seasonId, regionId);
  const dominant = selected.dominantDetail;
  const progress = dominant.percentage ?? null;
  return {
    phase: dominant.label,
    progress,
    age: null,
    planted: dominant.areaHa === null ? null : Math.round(dominant.areaHa),
    ready: Math.round(selected.total * ((selected.composition["Siap Panen"] ?? 0) / 100)),
    start: "Mengikuti periode musim",
    harvest: "Mengikuti data monitoring",
    monitored: selected.monitored,
    items: selected.items,
    total: selected.total,
  };
}

function riskProfile(name: string, seasonId: string, regionId = profileRegionId(name)) {
  const selected = selectRiskMonitoring(seasonId, regionId);
  const dominant = selected.dominantDetail;
  return {
    level: dominant.label,
    threat: "Informasi ancaman khusus belum tersedia pada data prototipe.",
    affected: dominant.affectedAreaHa === null ? null : Math.round(dominant.affectedAreaHa),
    score: null,
    percentage: dominant.percentage,
    villages: selected.monitoredLocationCount,
    recommendation: selected.monitored ? "Lanjutkan pemantauan berdasarkan tingkat risiko terukur." : "Belum dipantau",
    monitored: selected.monitored,
    items: selected.items,
    total: selected.total,
  };
}

function numericValue(value: string) {
  return Number(value.replace(/[^\d]/g, "")) || 0;
}

function layerColor(layer: LandLayer, name: string, seasonId: string) {
  if (layer === "Fase Tanam") return phaseColors[phaseProfile(name, seasonId).phase];
  if (layer === "Tingkat Risiko") return riskColors[riskProfile(name, seasonId).level];
  return "";
}

function makeDistrictSummary(name: string, seasonId = "MT2-2026") {
  const region = getRegionByName(name, "district");
  const aggregate = aggregateRegion(region?.id ?? "unknown", seasonId);
  const target = aggregate.gkg_production_target_ton
    ? aggregate.gkg_production_ton / aggregate.gkg_production_target_ton * 100
    : 0;
  return {
    district: name,
    harvest: Math.round(aggregate.harvested_area_ha).toLocaleString("id-ID"),
    gkg: Math.round(aggregate.gkg_production_ton).toLocaleString("id-ID"),
    yield: (aggregate.harvested_area_ha ? aggregate.gkg_production_ton / aggregate.harvested_area_ha : 0).toLocaleString("id-ID", { maximumFractionDigits: 2 }),
    rice: Math.round(aggregate.gkg_production_ton * 0.6339).toLocaleString("id-ID"),
    target: Math.round(target),
    land: Math.round(aggregate.mapped_land_ha).toLocaleString("id-ID"),
    planted: Math.round(aggregate.planting_realization_ha).toLocaleString("id-ID"),
    landMetric: defineLandMetric("mapped_land", aggregate.mapped_land_ha),
    plantedMetric: defineLandMetric("realized_planted_area", aggregate.planting_realization_ha),
    harvestedMetric: defineLandMetric("harvested_area", aggregate.harvested_area_ha),
    villages: districtVillageCount(name),
    condition: region?.monitoring_status !== "active" ? "Belum dipantau" : target >= 85 ? "Baik" : target >= 70 ? "Waspada" : "Perlu verifikasi",
    updated: seasonId === "MT2-2026" ? "24 Juli 2026" : "31 Maret 2026",
  };
}

function makeDistrictRows(names: string[], seasonId = "MT2-2026"): LandTableRow[] {
  return names.map(name => {
    const summary = makeDistrictSummary(name, seasonId);
    const region = getRegionByName(name, "district");
    const validation = region?.monitoring_status === "active" ? aggregateRegion(region.id, seasonId).validation_rate : null;
    return {
      cells: [
        name,
        `${summary.villages} kampung`,
        `${summary.planted} ha`,
        `${summary.harvest} ha`,
        `${summary.gkg} ton`,
        summary.condition,
        validation === null ? "Belum dipantau" : `${Math.round(validation)}%`,
      ],
      statusIndex: 5,
      validationIndex: 6,
    };
  });
}

function makeVillageRows(district: string, seasonId = "MT2-2026"): LandTableRow[] {
  const districtRegion = getRegionByName(district, "district");
  const children = districtRegion ? getChildrenByRegionId(districtRegion.id) : [];
  return children.map((region) => {
    const aggregate = aggregateRegion(region.id, seasonId);
    const validation = Math.round(aggregate.validation_rate);
    const status = validation >= 86 ? "Baik" : validation >= 74 ? "Waspada" : "Verifikasi";
    return {
      cells: [
        region.name,
        `${aggregate.mapped_land_ha.toLocaleString("id-ID")} ha`,
        `${aggregate.planting_realization_ha.toLocaleString("id-ID")} ha`,
        phaseProfile(region.name, seasonId).phase,
        `${aggregate.gkg_production_ton.toLocaleString("id-ID")} ton`,
        status,
        `${validation}%`,
      ],
      statusIndex: 5,
      validationIndex: 6,
    };
  });
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <section className="page-heading subpage-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      <div className="demo-badge"><span className="pulse" /> Data simulasi aktif</div>
    </section>
  );
}

type GeoFeature = {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
};

const bigService =
  "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_WILAYAH/MapServer";
const bigDistrictService =
  "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KECAMATAN_AR/MapServer";

function polygonRings(feature: GeoFeature): number[][][] {
  return feature.geometry.type === "Polygon"
    ? (feature.geometry.coordinates as number[][][])
    : (feature.geometry.coordinates as number[][][][]).flat();
}

function featureName(feature: GeoFeature, level: "province" | "district") {
  const p = feature.properties;
  return String(
    level === "province"
      ? p.wadmkk ?? p.namobj ?? p.WADMKK ?? p.NAMOBJ ?? "Wilayah"
      : p.wadmkc ?? p.namobj ?? p.WADMKC ?? p.NAMOBJ ?? "Distrik",
  ).replace(/^Kabupaten\s+/i, "");
}

function GeoAdministrativeMap({ layer, onContextChange }: { layer: LandLayer; onContextChange: (level: MapLevel, selectedName: string, districtNames: string[]) => void }) {
  const { filters, setDistrict } = useDashboardFilters();
  const globalDistrict = filters.districtId ? getRegionById(filters.districtId) : null;
  const [level, setLevel] = useState<MapLevel>(filters.districtId ? "district" : "province");
  const [mapRequestState, setMapRequestState] = useState<BigMapViewState<GeoFeature>>({ features: [], sourceMode: "big", status: "loading", context: null });
  const { features, sourceMode, status } = mapRequestState;
  const [selectedName, setSelectedName] = useState(globalDistrict?.name ?? "");
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef({ pointerId: -1, x: 0, y: 0, originX: 0, originY: 0, moved: false });
  const suppressClickRef = useRef(false);
  const requestControllerRef = useRef<BigMapRequestController<GeoFeature> | null>(null);
  const slowTimerRef = useRef(0);

  const zoomIn = () => setMapZoom(value => clampZoom(Number((value + 0.25).toFixed(2))));
  const zoomOut = () => setMapZoom(value => {
    const next = clampZoom(Number((value - 0.25).toFixed(2)));
    if (next === 1) setMapPan({ x: 0, y: 0 });
    return next;
  });
  const resetZoom = () => { const camera = resetMapCamera(); setMapZoom(camera.zoom); setMapPan({ x: camera.pan[0], y: camera.pan[1] }); };
  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mapZoom === 1) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: mapPan.x, originY: mapPan.y, moved: false };
  };
  const movePan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    if (!dragRef.current.moved && isMapDrag(dx, dy)) {
      dragRef.current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
    }
    if (!dragRef.current.moved) return;
    const scaleToViewBox = 900 / Math.max(event.currentTarget.getBoundingClientRect().width, 1);
    const [x, y] = clampPan([dragRef.current.originX + dx * scaleToViewBox, dragRef.current.originY + dy * scaleToViewBox], mapZoom);
    setMapPan({ x, y });
  };
  const endPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    const wasDragged = dragRef.current.moved;
    suppressClickRef.current = wasDragged;
    setIsPanning(false);
    dragRef.current.pointerId = -1;
    if (wasDragged) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };
  const panProps = {
    onPointerDown: startPan,
    onPointerMove: movePan,
    onPointerUp: endPan,
    onPointerCancel: endPan,
  };
  const mapTransform = `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`;
  const zoomControls = (
    <div className="map-zoom-controls" aria-label="Kontrol pembesaran peta">
      <button onClick={zoomIn} aria-label="Perbesar peta" title="Perbesar">+</button>
      <button onClick={zoomOut} disabled={mapZoom === 1} aria-label="Perkecil peta" title="Perkecil">−</button>
      <button className="zoom-reset" onClick={resetZoom} disabled={mapZoom === 1} aria-label="Kembalikan ukuran peta">{Math.round(mapZoom * 100)}%</button>
    </div>
  );

  useEffect(() => {
    const provinceQuery = new URLSearchParams({
      where: "wadmpr='Papua Selatan'",
      outFields: "namobj,wadmkk,wadmpr",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "4",
      maxAllowableOffset: "0.002",
      f: "geojson",
    });
    const districtQuery = new URLSearchParams({
      where: "wadmkk='Merauke'",
      outFields: "namobj,wadmkc,wadmkk,wadmpr",
      returnGeometry: "true",
      outSR: "4326",
      geometryPrecision: "4",
      maxAllowableOffset: "0.001",
      f: "geojson",
    });
    const viewCallbacks = createBigMapViewCallbacks<GeoFeature>(event => {
      window.clearTimeout(slowTimerRef.current);
      setIsSlowLoading(false);
      setMapRequestState(state => reduceBigMapViewState(state, event));
      if (event.type === "loading") slowTimerRef.current = window.setTimeout(() => setIsSlowLoading(true), 1200);
    });
    const controller = createBigMapRequestController<GeoFeature>({
      loadRemote: async (context, signal) => {
        const url = context.regionLevel === "province"
          ? `${bigService}/13/query?${provinceQuery}`
          : `${bigDistrictService}/0/query?${districtQuery}`;
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error("BIG service unavailable");
        const data = await response.json() as { features?: GeoFeature[] };
        return Array.isArray(data.features) ? data.features : [];
      },
      loadFallback: async (context, signal) => {
        if (context.regionLevel !== "district") throw new Error("Province fallback unavailable");
        const response = await fetch("/data/merauke-districts.geojson", { signal });
        if (!response.ok) throw new Error("Local boundary unavailable");
        const data = await response.json() as { features?: GeoFeature[] };
        return Array.isArray(data.features) ? data.features : [];
      },
    }, viewCallbacks);
    requestControllerRef.current = controller;
    return () => {
      window.clearTimeout(slowTimerRef.current);
      controller.dispose();
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = requestControllerRef.current;
    if (!controller) return;
    const regionId = level === "province" ? "93" : globalDistrict?.id ?? "93.01";
    void controller.load({ requestKey: `geometry:${level}:${regionId}`, regionId, regionLevel: level });
    return () => controller.cancel();
  }, [globalDistrict?.id, level]);

  useEffect(() => {
    queueMicrotask(() => {
      if (globalDistrict) {
        setLevel("district");
        setSelectedName(globalDistrict.name);
      } else {
        setSelectedName("");
      }
    });
  }, [globalDistrict]);

  const mapModel = useMemo(() => {
    const allPoints = features.flatMap(feature => polygonRings(feature).flat());
    if (!allPoints.length) return null;
    const width = 900, height = 480, pad = 28;
    const camera = fitToBounds(allPoints as [number, number][], width, height, pad);
    if (!camera.bounds) return null;
    const project = ([lon, lat]: number[]) => [camera.offsetX + (lon - camera.bounds!.minX) * camera.scale, height - camera.offsetY - (lat - camera.bounds!.minY) * camera.scale];
    return features.map(feature => {
      const rings = polygonRings(feature);
      const projected = rings.map(ring => ring.map(project));
      const path = projected.map(ring => ring.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ") + " Z").join(" ");
      const outer = projected[0] ?? [];
      const center: [number, number] = outer.length
        ? [outer.reduce((sum, p) => sum + p[0], 0) / outer.length, outer.reduce((sum, p) => sum + p[1], 0) / outer.length]
        : [0, 0];
      const projectedPoints = projected.flat();
      const bounds = {
        minX: Math.min(...projectedPoints.map(point => point[0])),
        maxX: Math.max(...projectedPoints.map(point => point[0])),
        minY: Math.min(...projectedPoints.map(point => point[1])),
        maxY: Math.max(...projectedPoints.map(point => point[1])),
      };
      return { feature, name: featureName(feature, level), path, center, bounds };
    });
  }, [features, level]);

  const visibleLabels = useMemo(() => prioritizedMapLabels((mapModel ?? []).map(item => ({ ...item, active: level === "district" || /merauke/i.test(item.name), selected: item.name === selectedName })), level === "district" ? 54 : 38, level === "district" ? 12 : 6), [level, mapModel, selectedName]);

  const focusedDistrict = useMemo(
    () => level === "district" && selectedName ? mapModel?.find(item => item.name === selectedName) ?? null : null,
    [level, mapModel, selectedName],
  );

  useEffect(() => {
    const districtNames = level === "district" ? canonicalDistrictNames : [];
    onContextChange(level, selectedName, districtNames);
  }, [level, onContextChange, selectedName]);

  const districtDummy = useMemo(() => makeDistrictSummary(selectedName, filters.seasonId), [filters.seasonId, selectedName]);
  const selectedPhase = useMemo(() => phaseProfile(selectedName, filters.seasonId), [filters.seasonId, selectedName]);
  const selectedRisk = useMemo(() => riskProfile(selectedName, filters.seasonId), [filters.seasonId, selectedName]);

  return (
    <div className="real-map-shell">
      <div className="map-breadcrumb">
        <button onClick={() => { const next = reduceMapBreadcrumb("province", filters); setDistrict(next.districtId); setLevel("province"); setSelectedName(""); resetZoom(); }} className={level === "province" ? "current" : ""}>Papua Selatan</button>
        {level === "district" && <><span>›</span><button className="current" onClick={() => { const next = reduceMapBreadcrumb("regency", filters); setDistrict(next.districtId); setSelectedName(""); resetZoom(); }}>Kabupaten Merauke</button>{selectedName && <><span>›</span><button className="current" onClick={() => { const next = reduceMapBreadcrumb("district", filters); setDistrict(next.districtId); }}>{selectedName}</button></>}</>}
      </div>
      <div className={`real-map-canvas ${focusedDistrict ? "district-detail-view" : ""}`}>
        {status === "loading" && <div className="map-state" role="status" aria-live="polite"><span className="map-loader" /><strong>Memuat peta resmi BIG...</strong><small>{isSlowLoading ? "Peta masih dimuat. Data indikator tetap tersedia." : "Menyiapkan geometri wilayah resmi"}</small></div>}
        {status === "error" && <div className="map-state error"><strong>Peta resmi belum dapat dimuat</strong><small>Layanan BIG dan data cadangan belum berhasil dibaca.</small><button aria-label="Coba muat ulang peta BIG" onClick={() => { void requestControllerRef.current?.retry(); }}>Coba lagi</button></div>}
        {status === "ready" && mapModel && focusedDistrict ? (
          <div className="district-focus-layout">
            <section className="focused-map-card">
              <header>
                <div><span>PETA DISTRIK</span><strong>{focusedDistrict.name}</strong></div>
                <button onClick={() => { setSelectedName(""); resetZoom(); }}>← Semua distrik</button>
              </header>
              <div className="focused-map-stage">
                {zoomControls}
                <svg
                  viewBox={`${focusedDistrict.bounds.minX - 22} ${focusedDistrict.bounds.minY - 22} ${focusedDistrict.bounds.maxX - focusedDistrict.bounds.minX + 44} ${focusedDistrict.bounds.maxY - focusedDistrict.bounds.minY + 44}`}
                  role="img"
                  aria-label={`Peta Distrik ${focusedDistrict.name}`}
                  preserveAspectRatio="xMidYMid meet"
                  className={`${mapZoom > 1 ? "is-pannable" : ""} ${isPanning ? "is-panning" : ""}`}
                  {...panProps}
                >
                  <g className="map-zoom-layer" style={{ transform: mapTransform, transformOrigin: `${focusedDistrict.center[0]}px ${focusedDistrict.center[1]}px` }}>
                    <path className="focused-district-shape" d={focusedDistrict.path} vectorEffect="non-scaling-stroke" style={layer !== "Luas Tanam" ? { fill: layerColor(layer, focusedDistrict.name, filters.seasonId) } : undefined} />
                    <text className="focused-district-label" x={focusedDistrict.center[0]} y={focusedDistrict.center[1]} textAnchor="middle">{focusedDistrict.name}</text>
                  </g>
                </svg>
              </div>
              <footer><span>◉</span> Badan Informasi Geospasial · WGS 84{sourceMode === "fallback" ? " · cadangan lokal" : ""}</footer>
            </section>
            <aside className="district-data-card">
              {layer === "Luas Tanam" ? <>
              <div className="district-data-heading">
                <div><span>RINGKASAN DISTRIK</span><strong>{districtDummy.district}</strong></div>
                <div className={`district-condition ${districtDummy.condition === "Baik" ? "good" : "watch"}`}>{districtDummy.condition}</div>
              </div>
              <div className="district-data-grid">
                  <div title={districtDummy.landMetric.description}><span>{districtDummy.landMetric.label}</span><strong>{districtDummy.land}</strong><small>ha</small></div>
                <div title={districtDummy.plantedMetric.description}><span>{districtDummy.plantedMetric.label}</span><strong>{districtDummy.planted}</strong><small>ha</small></div>
                <div title={districtDummy.harvestedMetric.description}><span>{districtDummy.harvestedMetric.label}</span><strong>{districtDummy.harvest}</strong><small>ha</small></div>
                <div><span>Produksi GKG</span><strong>{districtDummy.gkg}</strong><small>ton</small></div>
                <div><span>Estimasi beras</span><strong>{districtDummy.rice}</strong><small>ton</small></div>
                <div><span>Produktivitas</span><strong>{districtDummy.yield}</strong><small>ton/ha</small></div>
              </div>
              <div className="district-data-summary">
                <div><span>Kampung terpantau</span><strong>{districtDummy.villages} kampung</strong></div>
                <div><span>Capaian target</span><strong>{districtDummy.target}%</strong></div>
              </div>
              <div className="district-progress-bar"><i style={{ width: `${districtDummy.target}%` }} /></div>
              <small className="district-updated">Diperbarui {districtDummy.updated}</small>
              </> : layer === "Fase Tanam" ? <>
                <div className="district-data-heading">
                  <div><span>FASE TANAM DISTRIK</span><strong>{focusedDistrict.name}</strong></div>
                  <div className="district-condition good">{selectedPhase.phase}</div>
                </div>
                <div className="district-data-grid">
                  <div><span>Fase dominan</span><strong>{selectedPhase.phase}</strong></div>
                  <div><span>Progres fase</span><strong>{formatPresentationValue(selectedPhase.progress, "%")}</strong></div>
                  <div><span>Umur tanaman</span><strong>{formatPresentationValue(selectedPhase.age, "hari")}</strong></div>
                  <div><span>Luas dalam fase</span><strong>{formatPresentationValue(selectedPhase.planted, "ha")}</strong></div>
                  <div><span>Siap panen</span><strong>{selectedPhase.ready.toLocaleString("id-ID")}</strong><small>ha</small></div>
                  <div><span>Kampung terpantau</span><strong>{districtDummy.villages}</strong><small>kampung</small></div>
                </div>
                <div className="district-data-summary"><div><span>Mulai tanam</span><strong>{selectedPhase.start}</strong></div><div><span>Estimasi panen</span><strong>{selectedPhase.harvest}</strong></div></div>
                <div className="district-progress-bar phase-progress"><i style={{ width: `${selectedPhase.progress ?? 0}%`, background: phaseColors[selectedPhase.phase] }} /></div>
                <small className="district-updated">Data simulasi fase tanam · {districtDummy.updated}</small>
              </> : <>
                <div className="district-data-heading">
                  <div><span>RISIKO DISTRIK</span><strong>{focusedDistrict.name}</strong></div>
                  <div className="district-condition risk-badge" style={{ background: riskColors[selectedRisk.level], color: "#fff" }}>{selectedRisk.level}</div>
                </div>
                <div className="district-data-grid">
                  <div><span>Tingkat risiko</span><strong>{selectedRisk.level}</strong></div>
                  <div><span>Skor risiko</span><strong>{formatPresentationValue(selectedRisk.score)}</strong></div>
                  <div><span>Ancaman dominan</span><strong>{selectedRisk.threat}</strong></div>
                  <div><span>Luas terdampak</span><strong>{formatPresentationValue(selectedRisk.affected, "ha")}</strong></div>
                  <div><span>Kampung terdampak</span><strong>{selectedRisk.villages}</strong><small>kampung</small></div>
                  <div><span>Status data</span><strong>{selectedRisk.monitored ? "Terpantau" : "Belum dipantau"}</strong></div>
                </div>
                <div className="risk-recommendation"><span>REKOMENDASI</span><strong>{selectedRisk.recommendation}</strong></div>
                <div className="district-progress-bar"><i style={{ width: `${selectedRisk.percentage ?? 0}%`, background: riskColors[selectedRisk.level] }} /></div>
                <small className="district-updated">Data simulasi risiko · {districtDummy.updated}</small>
              </>}
            </aside>
          </div>
        ) : status === "ready" && mapModel ? (
          <>
            {zoomControls}
            <svg viewBox="0 0 900 480" role="img" aria-label={level === "province" ? "Peta empat kabupaten Provinsi Papua Selatan" : "Peta distrik Kabupaten Merauke"} className={`${mapZoom > 1 ? "is-pannable" : ""} ${isPanning ? "is-panning" : ""}`} {...panProps}>
              <g className="map-zoom-layer" style={{ transform: mapTransform, transformOrigin: "450px 240px" }}>
                <g className={`geo-layer ${level}`}>
                  {mapModel.map(item => {
                const isMerauke = /merauke/i.test(item.name);
                const active = level === "district" || isMerauke;
                return (
                  <g
                    key={`${item.name}-${item.path.slice(0,24)}`}
                    className={active ? "geo-active" : "geo-disabled"}
                    onClick={() => {
                      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                      if (level === "province" && isMerauke) { setLevel("district"); setSelectedName(""); resetZoom(); }
                      if (level === "district") { setSelectedName(item.name); setDistrict(getRegionByName(item.name, "district")?.id ?? null); resetZoom(); }
                    }}
                    tabIndex={active ? 0 : -1}
                    role={active ? "button" : undefined}
                    aria-label={level === "province" ? `${item.name}${active ? ", klik untuk melihat distrik" : ", belum aktif"}` : `Pilih Distrik ${item.name}`}
                    onKeyDown={event => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (level === "province" && isMerauke) { setLevel("district"); setSelectedName(""); resetZoom(); }
                      if (level === "district") { setSelectedName(item.name); setDistrict(getRegionByName(item.name, "district")?.id ?? null); resetZoom(); }
                    }}
                  >
                    <path d={item.path} vectorEffect="non-scaling-stroke" style={active && layer !== "Luas Tanam" ? { fill: layerColor(layer, item.name, filters.seasonId) } : undefined} />
                    <title>{item.name}</title>
                    {visibleLabels.has(item.name) && <text x={item.center[0]} y={item.center[1]} textAnchor="middle">
                      {item.name}
                    </text>}
                  </g>
                );
              })}
                </g>
              </g>
            </svg>
          </>
        ) : null}
        {!focusedDistrict && <div className="official-source"><span>◉</span><div><strong>Sumber geometri</strong><small>Badan Informasi Geospasial · WGS 84{sourceMode === "fallback" ? " · cadangan lokal" : ""}</small></div></div>}
        {level === "province" ? (
          <div className="province-hint"><strong>Kabupaten Merauke aktif</strong><small>Klik wilayah berwarna untuk melihat pembagian distrik</small></div>
        ) : status === "ready" && !focusedDistrict ? (
          <div className="district-focus-hint"><strong>Pilih salah satu distrik</strong><small>Klik wilayah pada peta untuk memperbesar dan melihat datanya</small></div>
        ) : null}
      </div>
      <div className="real-map-legend">
        {layer === "Fase Tanam" ? plantingPhases.map(item => <span key={item}><i style={{background:phaseColors[item]}} /> {item}</span>) : layer === "Tingkat Risiko" ? riskLevels.map(item => <span key={item}><i style={{background:riskColors[item]}} /> {item}</span>) : level === "province" ? <><span><i className="active-area" /> Wilayah aktif</span><span><i className="inactive-area" /> Tahap pengembangan</span></> : <><span><i className="active-area" /> Distrik terpantau</span><span><i className="selected-area" /> Distrik terpilih</span></>}
        {level === "province" && layer !== "Luas Tanam" && <span><i className="inactive-area" /> Belum tersedia data</span>}
        <em>Peta untuk visualisasi pemantauan, bukan penetapan hukum batas wilayah.</em>
      </div>
    </div>
  );
}

function LandPage() {
  const { filters, setDistrict } = useDashboardFilters();
  const [layer, setLayer] = useState<LandLayer>("Luas Tanam");
  const [regionDraft, setRegionDraft] = useState<string | null>(null);
  const [regionSearchOpen, setRegionSearchOpen] = useState(false);
  const [regionActiveIndex, setRegionActiveIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("Semua");
  const [minimumFilter, setMinimumFilter] = useState("Semua");
  const [detailRow, setDetailRow] = useState<LandTableRow | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const tableRef = useRef<HTMLElement | null>(null);
  const [mapContext, setMapContext] = useState<{ level: MapLevel; selectedName: string; districtNames: string[] }>({ level: "province", selectedName: "", districtNames: [] });
  const handleMapContext = useMemo(
    () => (level: MapLevel, selectedName: string, districtNames: string[]) => {
      setTablePage(1);
      setSearch("");
      setCategoryFilter("Semua");
      setMinimumFilter("Semua");
      setDetailRow(null);
      setMapContext(current => {
        if (current.level === level && current.selectedName === selectedName && current.districtNames.join("|") === districtNames.join("|")) return current;
        return { level, selectedName, districtNames };
      });
    },
    [],
  );
  const tableModel = useMemo(() => {
    const settlementNames = mapContext.selectedName ? makeVillageRows(mapContext.selectedName, filters.seasonId).map(row => row.cells[0]) : [];
    const areaNames = resolveTableRegionNames(mapContext.level, mapContext.selectedName, canonicalDistrictNames, settlementNames);
    const areaLabel = mapContext.level === "province" ? "Kabupaten" : mapContext.selectedName ? "Kampung/Kelurahan" : "Distrik";
    const countLabel = mapContext.level === "province" ? "Jumlah Distrik" : mapContext.selectedName ? "Cakupan" : "Jumlah Kampung/Kelurahan";
    const scopeTitle = mapContext.level === "province"
      ? "KABUPATEN MERAUKE"
      : mapContext.selectedName ? `DISTRIK ${mapContext.selectedName.toUpperCase()}` : "KABUPATEN MERAUKE";

    if (layer === "Fase Tanam") return {
      title: `REKAP FASE TANAM — ${scopeTitle}`,
      headers: [areaLabel, countLabel, "Luas Dalam Fase", "Fase Dominan", "Progres Fase", "Estimasi Panen", "Validasi"],
      rows: areaNames.map(name => {
        const phase = phaseProfile(name, filters.seasonId);
        return {
          cells: [
            name,
            mapContext.selectedName ? "1 lokasi" : mapContext.level === "province" ? "22 distrik" : `${districtVillageCount(name)} kampung`,
            formatPresentationValue(phase.planted, "ha"),
            phase.phase,
            formatPresentationValue(phase.progress, "%"),
            phase.harvest,
            (() => {
              const region = getRegionByName(name);
              return region?.monitoring_status === "active" ? `${Math.round(aggregateRegion(region.id, filters.seasonId).validation_rate)}%` : "Belum dipantau";
            })(),
          ],
          statusIndex: 3,
          validationIndex: 6,
        };
      }),
    };
    if (layer === "Tingkat Risiko") return {
      title: `REKAP TINGKAT RISIKO — ${scopeTitle}`,
      headers: [areaLabel, countLabel, "Ancaman Dominan", "Tingkat Risiko", "Luas Terdampak", "Rekomendasi", "Skor"],
      rows: areaNames.map(name => {
        const risk = riskProfile(name, filters.seasonId);
        return {
          cells: [
            name,
            mapContext.selectedName ? "1 lokasi" : mapContext.level === "province" ? "22 distrik" : `${districtVillageCount(name)} kampung`,
            risk.threat,
            risk.level,
            formatPresentationValue(risk.affected, "ha", risk.monitored ? undefined : "not_monitored"),
            risk.recommendation,
            formatPresentationValue(risk.score),
          ],
          statusIndex: 3,
          validationIndex: 6,
        };
      }),
    };
    if (mapContext.level === "province") return {
      title: "REKAP DATA KABUPATEN MERAUKE",
      headers: ["Kabupaten", "Jumlah Distrik", "Luas Tanam", "Luas Panen", "Produksi GKG", "Status Data", "Validasi"],
      rows: regencyRows.filter(row => row.cells[0] === "Merauke"),
    };
    if (!mapContext.selectedName) return {
      title: "REKAP DISTRIK KABUPATEN MERAUKE",
      headers: ["Distrik", "Jumlah Kampung/Kelurahan", "Luas Tanam", "Luas Panen", "Produksi GKG", "Kondisi", "Validasi"],
      rows: makeDistrictRows(mapContext.districtNames, filters.seasonId),
    };
    return {
      title: `DAFTAR KAMPUNG TERPANTAU — DISTRIK ${mapContext.selectedName.toUpperCase()}`,
      headers: ["Kampung/Kelurahan", "Luas lahan terpetakan", "Realisasi luas tanam", "Fase Tanam", "Produksi GKG", "Status", "Validasi"],
      rows: makeVillageRows(mapContext.selectedName, filters.seasonId),
    };
  }, [filters.seasonId, layer, mapContext]);
  const insightModel = useMemo(() => {
    const region = mapContext.selectedName ? getRegionByName(mapContext.selectedName, "district") : getRegionById("93.01");
    const aggregate = aggregateRegion(region?.id ?? "93.01", filters.seasonId);
    const risk = riskProfile(mapContext.selectedName || "Kabupaten Merauke", filters.seasonId, region?.id ?? "93.01");
    return {
      scope: mapContext.selectedName ? `Distrik ${mapContext.selectedName}` : "Kabupaten Merauke",
      mapped: Math.round(aggregate.mapped_land_ha).toLocaleString("id-ID"),
      active: Math.round(aggregate.active_land_ha).toLocaleString("id-ID"),
      verified: Math.round(aggregate.validation_rate),
      coverage: mapContext.selectedName
        ? `${risk.villages} kampung/kelurahan terpantau`
        : `${activeRegionCounts.districts} distrik aktif · ${activeRegionCounts.settlements} kampung/kelurahan terpantau`,
      risk,
    };
  }, [filters.seasonId, mapContext]);
  const analyticalInsight = useMemo(() => {
    const scope = mapContext.selectedName ? `Distrik ${mapContext.selectedName}` : "Kabupaten Merauke";
    const key = mapContext.selectedName || "Kabupaten Merauke";
    const regionId = mapContext.selectedName ? profileRegionId(mapContext.selectedName) : "93.01";
    const phase = phaseProfile(key, filters.seasonId, regionId);
    const risk = riskProfile(key, filters.seasonId, regionId);
    return { scope, phase, risk };
  }, [filters.seasonId, mapContext]);
  const activeMapRegion = filters.districtId ? getRegionById(filters.districtId) : null;
  const regionQuery = regionDraft ?? formatMapRegionLabel(activeMapRegion?.name ?? "Merauke", activeMapRegion ? "Distrik" : "Kabupaten");
  const matchingMapRegions = useMemo(() => {
    const query = regionQuery.trim().toLocaleLowerCase("id-ID");
    return filterMapRegionOptions(mapRegionOptions, query);
  }, [regionQuery]);
  const chooseMapRegion = (option: (typeof mapRegionOptions)[number]) => {
    setDistrict(districtIdForMapRegion(option));
    setRegionDraft(null);
    setRegionSearchOpen(false);
    setRegionActiveIndex(0);
  };
  const entityLabel = mapContext.level === "province"
    ? "Kabupaten"
    : mapContext.selectedName
      ? "Kampung"
      : "Distrik";
  const categoryOptions = useMemo(
    () => Array.from(new Set(tableModel.rows.map(row => row.cells[row.statusIndex]))),
    [tableModel],
  );
  const searchMatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return tableModel.rows
      .filter(row => row.cells.join(" ").toLowerCase().includes(query))
      .slice(0, 6);
  }, [search, tableModel]);
  const openSearchResult = (row: LandTableRow) => {
    setSearch(row.cells[0]);
    setSearchOpen(false);
    setTablePage(1);
    setDetailRow(row);
    window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };
  const filterActive = Boolean(search.trim()) || categoryFilter !== "Semua" || minimumFilter !== "Semua";
  const filtered = tableModel.rows.filter(row => {
    const matchesSearch = row.cells.join(" ").toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "Semua" || row.cells[row.statusIndex] === categoryFilter;
    const matchesMinimum = minimumFilter === "Semua" || numericValue(row.cells[row.validationIndex]) >= Number(minimumFilter);
    return matchesSearch && matchesCategory && matchesMinimum;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleRows = filterActive ? filtered : filtered.slice((tablePage - 1) * pageSize, tablePage * pageSize);
  const totalModel = useMemo(() => {
    const average = (index: number) => filtered.length ? Math.round(filtered.reduce((sum, row) => sum + numericValue(row.cells[index]), 0) / filtered.length) : 0;
    const sum = (index: number) => filtered.reduce((total, row) => total + numericValue(row.cells[index]), 0).toLocaleString("id-ID");
    const validationSummary = getValidationSummary(filtered.map(row => ({
      monitoringStatus: /^\d/.test(row.cells[row.validationIndex]) ? "active" : "not_monitored",
      validation: /^\d/.test(row.cells[row.validationIndex]) ? numericValue(row.cells[row.validationIndex]) : null,
    })));
    const validationValue = validationSummary.averageValidation === null ? "Belum tersedia" : `${validationSummary.averageValidation.toLocaleString("id-ID")}%`;
    if (layer === "Fase Tanam") return [
      [`${entityLabel} ditampilkan`, `${filtered.length}`],
      ["Luas dalam fase", `${sum(2)} ha`],
      ["Rata-rata progres", `${average(4)}%`],
      ["Rata-rata validasi", validationValue],
      ["Cakupan validasi", validationSummary.calculationScope],
    ];
    if (layer === "Tingkat Risiko") {
      const dominant = filtered.length
        ? Array.from(new Set(filtered.map(row => row.cells[3]))).sort((a, b) => filtered.filter(row => row.cells[3] === b).reduce((sum, row) => sum + numericValue(row.cells[4]), 0) - filtered.filter(row => row.cells[3] === a).reduce((sum, row) => sum + numericValue(row.cells[4]), 0))[0]
        : "—";
      return [
        [`${entityLabel} ditampilkan`, `${filtered.length}`],
        ["Luas terdampak", `${sum(4)} ha`],
        ["Rata-rata skor risiko", "Belum tersedia"],
        ["Risiko dominan", dominant],
      ];
    }
    if (!mapContext.selectedName) return [
      [`${entityLabel} ditampilkan`, `${filtered.length}`],
      ["Total luas tanam", `${sum(2)} ha`],
      ["Total luas panen", `${sum(3)} ha`],
      ["Total produksi GKG", `${sum(4)} ton`],
      ["Rata-rata validasi", validationValue],
      ["Cakupan validasi", validationSummary.calculationScope],
    ];
    return [
      [`${entityLabel} ditampilkan`, `${filtered.length}`],
      ["Total luas lahan terpetakan", `${sum(1)} ha`],
      ["Total realisasi luas tanam", `${sum(2)} ha`],
      ["Total produksi GKG", `${sum(4)} ton`],
      ["Rata-rata validasi", validationValue],
      ["Cakupan validasi", validationSummary.calculationScope],
    ];
  }, [filtered, layer, entityLabel, mapContext.selectedName]);
  const detailModel = useMemo(() => {
    if (!detailRow) return null;
    const name = detailRow.cells[0];
    const status = detailRow.cells[detailRow.statusIndex];
    if (layer === "Fase Tanam") {
      const profile = phaseProfile(name, filters.seasonId);
      return {
        eyebrow: "DETAIL FASE TANAM",
        name,
        status,
        color: phaseColors[status],
        description: `${name} berada pada fase ${status} dengan progres komposisi sebesar ${profile.progress}% dari data monitoring musim terpilih.`,
        reason: `Status berasal dari fase dengan luas terbesar pada record musim dan wilayah aktif, dengan luas dalam fase ${detailRow.cells[2]}.`,
        recommendation: "Lanjutkan validasi record dan pemantauan perkembangan fase.",
      };
    }
    if (layer === "Tingkat Risiko") {
      const profile = riskProfile(name, filters.seasonId);
      return {
        eyebrow: "DETAIL TINGKAT RISIKO",
        name,
        status,
        color: riskColors[status],
        description: `${name} memiliki tingkat risiko dominan ${status}${profile.percentage === null ? "" : ` sebesar ${profile.percentage.toLocaleString("id-ID")}% dari luas risiko terpantau`} pada data musim terpilih.`,
        reason: "Kategori berasal dari agregasi field risiko pada record monitoring yang terverifikasi.",
        recommendation: profile.recommendation,
      };
    }
    const validation = numericValue(detailRow.cells[detailRow.validationIndex]);
    const reasonByStatus: Record<string, string> = {
      Baik: `Status Baik diberikan karena validasi mencapai ${validation}% dan metrik monitoring berada dalam kategori baik.`,
      Waspada: `Status Waspada diberikan karena validasi mencapai ${validation}% dan kategori monitoring memerlukan perhatian.`,
      Verifikasi: `Status Verifikasi diberikan karena tingkat validasi masih ${validation}% sehingga data lapangan perlu dicocokkan kembali dengan laporan penyuluh dan pemetaan.`,
      Aktif: `Data dinyatakan aktif karena pembaruan dan validasi wilayah telah mencapai ${validation}%.`,
    };
    return {
      eyebrow: "DETAIL KONDISI LAHAN",
      name,
      status,
      color: status === "Baik" || status === "Aktif" ? "#16845d" : status === "Waspada" ? "#c58222" : "#d05b49",
      description: `Pemantauan ${name} mencakup luas lahan, luas tanam, fase pertumbuhan, produksi GKG, dan hasil validasi lapangan.`,
      reason: reasonByStatus[status] ?? `Status ${status} ditetapkan berdasarkan hasil pemantauan dan validasi data lapangan.`,
      recommendation: status === "Baik" || status === "Aktif" ? "Pertahankan pola pemeliharaan dan pembaruan data berkala." : status === "Waspada" ? "Lakukan pemantauan lebih sering dan tindak lanjuti indikator gangguan." : "Lakukan verifikasi lapangan dan perbarui data pendukung.",
    };
  }, [detailRow, filters.seasonId, layer]);
  useEffect(() => {
    if (!detailRow) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailRow(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [detailRow]);

  return (
    <div className="subpage page-enter">
      <PageTitle eyebrow="PEMANTAUAN SPASIAL" title="Peta Lahan Pertanian" description="Pemantauan lahan padi Papua Selatan" />
      <div className="prototype-scope page-scope">Cakupan data aktif: Kabupaten Merauke</div>
      <section className="sub-toolbar">
        <div className="segmented" aria-label="Lapisan peta">
          {(["Luas Tanam", "Fase Tanam", "Tingkat Risiko"] as LandLayer[]).map(item => <button key={item} className={layer === item ? "on" : ""} onClick={() => { setLayer(item); setTablePage(1); setCategoryFilter("Semua"); setMinimumFilter("Semua"); setDetailRow(null); }}>{item}</button>)}
        </div>
        <div className={`search-box ${searchOpen && search.trim() ? "is-open" : ""}`}>
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
            onChange={event => { setSearch(event.target.value); setSearchOpen(true); setTablePage(1); }}
            onKeyDown={event => {
              if (event.key === "Escape") setSearchOpen(false);
              if (event.key === "Enter" && searchMatches.length) openSearchResult(searchMatches[0]);
            }}
            placeholder={`Cari ${entityLabel.toLowerCase()}…`}
            aria-label={`Cari data ${entityLabel.toLowerCase()}`}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen && Boolean(search.trim())}
            aria-controls="land-search-results"
          />
          {search && <button className="search-clear" aria-label="Hapus pencarian" onMouseDown={event => event.preventDefault()} onClick={() => { setSearch(""); setSearchOpen(false); setTablePage(1); }}>×</button>}
          {searchOpen && search.trim() && <div id="land-search-results" className="search-results" role="listbox">
            <div className="search-results-head"><strong>HASIL PENCARIAN</strong><span>{searchMatches.length} ditemukan</span></div>
            {searchMatches.length ? searchMatches.map(row => (
              <button key={row.cells[0]} role="option" aria-selected="false" onMouseDown={event => event.preventDefault()} onClick={() => openSearchResult(row)}>
                <span><strong>{row.cells[0]}</strong><small>{entityLabel} · {row.cells[row.statusIndex]}</small></span>
                <em>Lihat detail →</em>
              </button>
            )) : <div className="search-empty"><strong>Data tidak ditemukan</strong><small>Periksa penulisan atau coba kata lain.</small></div>}
          </div>}
        </div>
      </section>
      <section className="land-layout">
        <article className="card large-map">
          <div className="card-title"><div><span className="live-dot" /> LAPISAN: {layer.toUpperCase()}</div><span>Batas administrasi resmi</span></div>
          <div className="map-region-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRegionSearchOpen(false); }}>
            <label htmlFor="map-region-query">Cari wilayah pada peta</label>
            <div className="map-region-search-field">
              <Search className="map-region-search-icon" size={17} aria-hidden="true" />
              <input id="map-region-query" value={regionQuery} placeholder="Cari kabupaten atau distrik..." autoComplete="off"
                role="combobox" aria-autocomplete="list" aria-expanded={regionSearchOpen} aria-controls="map-region-options"
                aria-activedescendant={regionSearchOpen && matchingMapRegions[regionActiveIndex] ? `map-region-${matchingMapRegions[regionActiveIndex].id}` : undefined}
                onFocus={() => setRegionSearchOpen(true)} onChange={event => { setRegionDraft(event.target.value); setRegionSearchOpen(true); setRegionActiveIndex(0); }}
                onKeyDown={event => {
                  if (event.key === "Escape") setRegionSearchOpen(false);
                  if (event.key === "ArrowDown") { event.preventDefault(); setRegionSearchOpen(true); setRegionActiveIndex(index => Math.min(index + 1, matchingMapRegions.length - 1)); }
                  if (event.key === "ArrowUp") { event.preventDefault(); setRegionActiveIndex(index => Math.max(0, index - 1)); }
                  if (event.key === "Enter" && matchingMapRegions[regionActiveIndex]) { event.preventDefault(); chooseMapRegion(matchingMapRegions[regionActiveIndex]); }
                }} />
              <div className="map-region-search-actions">
                {regionQuery && <button type="button" aria-label="Hapus pencarian wilayah" onClick={() => { setRegionDraft(""); setRegionSearchOpen(true); setRegionActiveIndex(0); }}><X size={16} aria-hidden="true" /></button>}
                <ChevronDown className="map-region-chevron" size={17} aria-hidden="true" />
              </div>
            </div>
            {regionSearchOpen && <div id="map-region-options" className="map-region-options" role="listbox" aria-label="Wilayah Kabupaten Merauke">
              {matchingMapRegions.length ? matchingMapRegions.map((option, index) => <button type="button" id={`map-region-${option.id}`} key={option.id} role="option"
                aria-selected={option.typeLabel === "Kabupaten" ? !filters.districtId : filters.districtId === option.id}
                className={index === regionActiveIndex ? "active" : ""} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setRegionActiveIndex(index)} onClick={() => chooseMapRegion(option)}>
                <strong>{option.name}</strong><span><span aria-hidden="true">{REGION_SEPARATOR}</span> {option.typeLabel}</span>
              </button>) : <p role="status">Wilayah tidak ditemukan.</p>}
            </div>}
          </div>
          <GeoAdministrativeMap layer={layer} onContextChange={handleMapContext} />
        </article>
        <aside className="land-insight">
          {layer === "Luas Tanam" ? <>
          <article className="card mini-stat"><span>LUAS LAHAN TERPETAKAN</span><small className="insight-scope">{insightModel.scope}</small><strong>{insightModel.mapped} <small>ha</small></strong><em>↑ {insightModel.verified}% telah diverifikasi</em></article>
          <article className="card mini-stat"><span>LAHAN AKTIF MT II</span><small className="insight-scope">{insightModel.scope}</small><strong>{insightModel.active} <small>ha</small></strong><em>{insightModel.coverage}</em></article>
          <article className="card condition-card"><div className="card-title"><div>KOMPOSISI RISIKO</div><span>{insightModel.scope}</span></div><div>{insightModel.risk.monitored ? riskLevels.map(label => { const item = insightModel.risk.items.find(entry => entry.label === label); const area = item?.area ?? 0; const percentage = insightModel.risk.total ? area / insightModel.risk.total * 100 : 0; return <div className="composition-row" key={label}><span>{label} <b>{area.toLocaleString("id-ID")} ha · {percentage.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%</b></span><i><em style={{width:`${percentage}%`,background:riskColors[label]}} /></i></div>; }) : <span>{insightModel.risk.level}</span>}</div></article>
          </> : layer === "Fase Tanam" ? <>
            <article className="card mini-stat"><span>FASE TANAM DOMINAN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong className="textual-stat" style={{color:phaseColors[analyticalInsight.phase.phase]}}>{analyticalInsight.phase.phase}</strong><em>{analyticalInsight.phase.progress === null ? "Belum tersedia" : `Progres fase ${analyticalInsight.phase.progress.toLocaleString("id-ID")}%`}</em></article>
            <article className="card mini-stat"><span>LUAS SIAP PANEN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong>{analyticalInsight.phase.ready.toLocaleString("id-ID")} <small>ha</small></strong><em>Estimasi {analyticalInsight.phase.harvest}</em></article>
            <article className="card condition-card"><div className="card-title"><div>KOMPOSISI FASE</div><span>{analyticalInsight.scope}</span></div><div>{analyticalInsight.phase.items.map(item => { const percentage = analyticalInsight.phase.total ? (item.area ?? 0) / analyticalInsight.phase.total * 100 : 0; return <div className="composition-row" key={item.id}><span>{item.label} <b>{percentage.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%</b></span><i><em style={{width:`${percentage}%`,background:item.color}} /></i></div>; })}</div></article>
          </> : <>
            <article className="card mini-stat"><span>LUAS TERDAMPAK RISIKO DOMINAN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong>{formatPresentationValue(analyticalInsight.risk.affected, "ha")}</strong><em>{analyticalInsight.risk.threat}</em></article>
            <article className="card mini-stat"><span>TINGKAT RISIKO DOMINAN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong className="textual-stat" style={{color:riskColors[analyticalInsight.risk.level]}}>{analyticalInsight.risk.level}</strong><em>{analyticalInsight.risk.villages} wilayah terdampak</em></article>
            <article className="card condition-card"><div className="card-title"><div>KOMPOSISI RISIKO</div><span>{analyticalInsight.scope}</span></div><div>{analyticalInsight.risk.items.map(item => { const percentage = analyticalInsight.risk.total ? (item.area ?? 0) / analyticalInsight.risk.total * 100 : 0; return <div className="composition-row" key={item.id}><span>{item.label} <b>{percentage.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%</b></span><i><em style={{width:`${percentage}%`,background:item.color}} /></i></div>; })}</div></article>
          </>}
        </aside>
      </section>
      <article ref={tableRef} className="card data-table-card">
        <div className="card-title"><div>{tableModel.title}</div><span>{filtered.length} dari {tableModel.rows.length} data{filterActive ? " · seluruh hasil filter ditampilkan" : " · maks. 10 per halaman"}</span></div>
        <div className="table-filterbar">
          <div className="filter-heading"><strong>FILTER DATA {entityLabel.toUpperCase()}</strong><small>Pilih kategori untuk menyaring daftar {entityLabel.toLowerCase()}</small></div>
          <label><span>{layer === "Luas Tanam" ? "Status kondisi" : layer === "Fase Tanam" ? "Fase dominan" : "Tingkat risiko"}</span><select value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); setTablePage(1); }}><option>Semua</option>{categoryOptions.map(option => <option key={option}>{option}</option>)}</select></label>
          <label><span>{layer === "Tingkat Risiko" ? "Skor minimum" : "Validasi minimum"}</span><select value={minimumFilter} onChange={event => { setMinimumFilter(event.target.value); setTablePage(1); }}><option>Semua</option><option value="70">≥ 70%</option><option value="80">≥ 80%</option><option value="90">≥ 90%</option></select></label>
          <button className="reset-filter" disabled={!filterActive} onClick={() => { setSearch(""); setCategoryFilter("Semua"); setMinimumFilter("Semua"); setTablePage(1); }}>↺ Reset filter</button>
        </div>
        <div className="table-scroll"><table><thead><tr>{tableModel.headers.map(header => <th key={header}>{header}</th>)}<th>Detail</th></tr></thead><tbody>{!visibleRows.length && <tr><td colSpan={tableModel.headers.length + 1}>Tidak ada data sesuai filter.<small>Ubah pencarian atau filter untuk melihat data lainnya.</small></td></tr>}{visibleRows.map((row, rowIndex) => <tr key={`${row.cells[0]}-${rowIndex}`}>{row.cells.map((cell,i) => {
          const indicatorColor = layer === "Fase Tanam" ? phaseColors[cell] : layer === "Tingkat Risiko" ? riskColors[cell] : undefined;
          return <td key={i}>{i === row.statusIndex ? <span className={`status ${indicatorColor ? "layer-status" : cell !== "Baik" && cell !== "Aktif" ? "warn" : ""}`} style={indicatorColor ? { color: indicatorColor, borderColor: `${indicatorColor}55`, background: `${indicatorColor}18` } : undefined}>{cell}</span> : i === row.validationIndex && /^\d/.test(cell) ? <span className="validation"><i style={{width:cell}} />{cell}</span> : cell}</td>;
        })}<td><button className="detail-button" aria-label={`Buka detail ${row.cells[0]}`} onClick={() => setDetailRow(row)}>Lihat selengkapnya</button></td></tr>)}</tbody></table></div>
        <div className="table-total">
          <div><strong>TOTAL HASIL</strong><small>Berdasarkan data yang sedang ditampilkan</small></div>
          {totalModel.map(item => <div key={item[0]}><span>{item[0]}</span><b>{item[1]}</b></div>)}
        </div>
        {!filterActive && totalPages > 1 && <div className="table-pagination">
          <button disabled={tablePage === 1} aria-disabled={tablePage === 1} aria-label="Halaman sebelumnya" onClick={() => setTablePage(page => Math.max(1, page - 1))}>← Sebelumnya</button>
          <span>Halaman <strong>{tablePage}</strong> dari {totalPages}</span>
          <button disabled={tablePage === totalPages} aria-disabled={tablePage === totalPages} aria-label="Halaman berikutnya" onClick={() => setTablePage(page => Math.min(totalPages, page + 1))}>Lihat selanjutnya →</button>
        </div>}
      </article>
      {detailRow && detailModel && createPortal(<div className="detail-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDetailRow(null); }}>
        <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-modal-title">
          <header><div><span>{detailModel.eyebrow}</span><h2 id="detail-modal-title">{detailModel.name}</h2><small>{mapContext.selectedName ? `Distrik ${mapContext.selectedName}` : "Kabupaten Merauke"} · Data simulasi</small></div><button aria-label="Tutup detail" onClick={() => setDetailRow(null)}>×</button></header>
          <div className="detail-modal-body">
            <div className="detail-status-strip"><span>Status terpantau</span><strong style={{ color: detailModel.color, background: `${detailModel.color}18`, borderColor: `${detailModel.color}55` }}>{detailModel.status}</strong></div>
            <div className="detail-metrics">{tableModel.headers.map((header, index) => <div key={header}><span>{header}</span><b>{detailRow.cells[index]}</b></div>)}</div>
            <article><span>RINGKASAN KONDISI</span><p>{detailModel.description}</p></article>
            <article className="detail-reason"><span>ALASAN PENETAPAN STATUS</span><p>{detailModel.reason}</p></article>
            <article className="detail-recommendation"><span>REKOMENDASI TINDAK LANJUT</span><p>{detailModel.recommendation}</p></article>
          </div>
          <footer><small>Diperbarui 25 Juli 2026 · 22.42 WIT</small><button onClick={() => setDetailRow(null)}>Tutup</button></footer>
        </section>
      </div>, document.body)}
    </div>
  );
}

function SeasonPage() {
  return <SeasonCommandCenter />;
}

function ProductionPage() {
  return <ProductionCommandCenter />;
}

function HomeContent() {
  const [activeNav, setActiveNav] = useState("Ringkasan");
  const { filters } = useDashboardFilters();
  const printDistrict = filters.districtId ? getRegionById(filters.districtId) : null;
  const printVillage = filters.villageId ? getRegionById(filters.villageId) : null;
  const printSeason = getSeasonById(filters.seasonId);
  const printScope = printVillage
    ? `${printVillage.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung"} ${printVillage.name}`
    : printDistrict ? `Distrik ${printDistrict.name}` : "Kabupaten Merauke";

  return (
    <>
      <header className="print-brand-header">
        <Image src="/branding/icons/app-icon-192.png" alt="Lambang Pemerintah Provinsi Papua Selatan" width={72} height={72} priority />
        <div className="print-brand-identity">
          <strong>MAWAR PAPUA SELATAN</strong>
          <span>Model Aksi Wadah Kolaborasi &amp; Resiliensi</span>
          <b>Dashboard Pemantauan Padi dan Ketahanan Pangan</b>
        </div>
        <div className="print-brand-context">
          <span>Laporan: {activeNav}</span>
          <span>Wilayah aktif: {printScope}</span>
          <span>Musim aktif: {printSeason?.display_name ?? filters.seasonId}</span>
          <span>Dicetak berdasarkan pembaruan 24 Juli 2026 · 22.42 WIT</span>
        </div>
      </header>
      <main className="app-shell">
      <aside className="sidebar">
        <button type="button" className="brand-mark" aria-label="Buka beranda MAWAR Papua Selatan" onClick={() => setActiveNav("Ringkasan")}>
          <Image className="brand-logo" src="/branding/logo-papua-selatan.png" alt="" width={48} height={60} priority />
          <span className="brand-copy"><strong>MAWAR</strong><small>Papua Selatan</small></span>
        </button>
        <nav aria-label="Navigasi utama">
          {nav.map(({ Icon, label, enabled }) => (
            <button
              key={label}
              className={activeNav === label ? "nav-item active" : "nav-item"}
              onClick={() => enabled && setActiveNav(label)}
              aria-label={`Buka halaman ${label}`}
              aria-current={activeNav === label ? "page" : undefined}
              aria-disabled={!enabled}
            >
              <span aria-hidden="true"><Icon size={21} /></span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-status">
          <span className="pulse" />
          Sistem aktif
          <small>Data demonstrasi</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="identity">
            <Image className="identity-logo" src="/branding/logo-papua-selatan.png" alt="Lambang Pemerintah Provinsi Papua Selatan" width={36} height={45} priority />
            <div>
              <strong>MAWAR PAPUA SELATAN</strong>
              <span>Model Aksi Wadah Kolaborasi &amp; Resiliensi</span>
            </div>
          </div>
          <div className="trust">
            <div><span>TERAKHIR DIPERBARUI</span><strong>24 Juli 2026 · 22.42 WIT</strong></div>
            <i />
            <div><span>SUMBER DATA & KEPERCAYAAN</span><strong>Dinas Pertanian · BPS · BMKG</strong></div>
            <b>Tinggi</b>
            <button className="profile" aria-label="Menu profil">SD</button>
          </div>
        </header>

        <div className="content">
          {activeNav === "Ringkasan" && <ExecutiveDashboard onNavigate={setActiveNav} />}
          {activeNav === "Peta Lahan" && <LandPage />}
          {activeNav === "Musim Tanam" && <SeasonPage />}
          {activeNav === "Produksi" && <ProductionPage />}
          {activeNav === "Ketahanan Pangan" && <FoodSecurityPage />}

          <footer><span>Data pada prototipe bersifat simulasi dan perlu divalidasi sebelum digunakan sebagai dasar kebijakan.</span><strong>© 2026 Pemerintah Provinsi Papua Selatan</strong></footer>
        </div>
      </section>
      </main>
    </>
  );
}

export default function Home() {
  return <DashboardFilterProvider><HomeContent /></DashboardFilterProvider>;
}
