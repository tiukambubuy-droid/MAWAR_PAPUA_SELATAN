"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import SeasonCommandCenter from "@/components/season/SeasonPage";
import ProductionCommandCenter from "@/components/production/ProductionPage";
import ExecutiveDashboard from "@/components/overview/ExecutiveDashboard";
import { recordsForScope as sharedProductionRecords } from "@/lib/production-data";
import {
  aggregateRegion,
  compactYieldNote,
  getActiveMonitoringRegionCounts,
  getChildrenByRegionId,
  getRegionByName,
} from "@/lib/data-foundation";

const activeRegionCounts = getActiveMonitoringRegionCounts();

const districts = [
  { name: "Merauke", x: 67, y: 70, value: "Data teragregasi", risk: "Aman" },
  { name: "Semangga", x: 45, y: 48, value: "Data teragregasi", risk: "Waspada" },
  { name: "Tanah Miring", x: 65, y: 39, value: "Data teragregasi", risk: "Waspada" },
  { name: "Kurik", x: 77, y: 28, value: "Data teragregasi", risk: "Tinggi" },
  { name: "Malind", x: 35, y: 67, value: "Data teragregasi", risk: "Aman" },
];

const metrics = [
  { icon: "↗", label: "Luas Tanam", value: "38.180", unit: "ha", change: "+8,4%" },
  { icon: "⌁", label: "Luas Panen", value: "31.854", unit: "ha", change: "+7,1%" },
  { icon: "◉", label: "Produksi GKG", value: "174.577", unit: "ton", change: "+9,6%" },
  { icon: "▥", label: "Produktivitas", value: "5,48", unit: "ton/ha", change: "+1,2%" },
  { icon: "●", label: "Estimasi Beras", value: "110.664", unit: "ton", change: compactYieldNote },
];

const nav = [
  ["▦", "Ringkasan"],
  ["◇", "Peta Lahan"],
  ["♧", "Musim Tanam"],
  ["▥", "Produksi"],
  ["▣", "Stok Beras"],
  ["△", "Risiko & Iklim"],
  ["▤", "Laporan"],
];

type MapLevel = "province" | "district";
type LandLayer = "Luas Tanam" | "Fase Tanam" | "Tingkat Risiko";
type LandTableRow = { cells: string[]; statusIndex: number; validationIndex: number };

const regencyRows: LandTableRow[] = [
  { cells: ["Merauke", "22 distrik", "38.180 ha", "31.854 ha", "174.577 ton", "Aktif", "91%"], statusIndex: 5, validationIndex: 6 },
];

function seededNumber(name: string) {
  return [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function districtVillageCount(name: string) {
  const district = getRegionByName(name, "district");
  return district ? getChildrenByRegionId(district.id).length : 0;
}

const plantingPhases = ["Persiapan", "Persemaian", "Vegetatif", "Generatif", "Pematangan", "Siap Panen"];
const phaseColors: Record<string, string> = {
  Persiapan: "#4b8fa8", Persemaian: "#b9dba8", Vegetatif: "#55a977",
  Generatif: "#d9c954", Pematangan: "#df963c", "Siap Panen": "#ad7927",
};
const riskLevels = ["Rendah", "Waspada", "Sedang", "Tinggi/Kritis"];
const riskColors: Record<string, string> = {
  Rendah: "#57a878", Waspada: "#dfc849", Sedang: "#e79a39", "Tinggi/Kritis": "#b33d38",
};

function phaseProfile(name: string) {
  const seed = seededNumber(name);
  const phase = plantingPhases[seed % plantingPhases.length];
  return {
    phase,
    progress: 28 + seed % 68,
    age: 12 + seed % 88,
    planted: 420 + seed % 1480,
    ready: 180 + seed % 920,
    start: `${3 + seed % 24} Juni 2026`,
    harvest: `${5 + seed % 23} Agustus 2026`,
  };
}

function riskProfile(name: string) {
  const seed = seededNumber(name);
  const level = riskLevels[seed % riskLevels.length];
  const threats = ["Banjir/genangan", "Kekeringan", "Hama wereng", "Penyakit blas", "Anomali cuaca"];
  const recommendations = ["Pemantauan rutin", "Perbaiki drainase", "Siapkan pompa air", "Pengendalian OPT terpadu", "Verifikasi lapangan"];
  return {
    level,
    threat: threats[(seed + 2) % threats.length],
    affected: 90 + seed % 1120,
    score: 22 + seed % 76,
    villages: 1 + seed % Math.max(2, districtVillageCount(name)),
    recommendation: recommendations[(seed + 1) % recommendations.length],
  };
}

function numericValue(value: string) {
  return Number(value.replace(/[^\d]/g, "")) || 0;
}

function layerColor(layer: LandLayer, name: string) {
  if (layer === "Fase Tanam") return phaseColors[phaseProfile(name).phase];
  if (layer === "Tingkat Risiko") return riskColors[riskProfile(name).level];
  return "";
}

function makeDistrictSummary(name: string) {
  const seed = seededNumber(name);
  const known = productionRows.find(row => row.district.toLowerCase() === name.toLowerCase());
  const base = known ?? {
    district: name,
    harvest: (950 + seed % 2400).toLocaleString("id-ID"),
    gkg: (5200 + seed * 17).toLocaleString("id-ID"),
    yield: (5.1 + (seed % 70) / 100).toFixed(2).replace(".", ","),
    rice: (3300 + seed * 11).toLocaleString("id-ID"),
    target: 72 + seed % 24,
  };
  return {
    ...base,
    land: (1600 + seed % 3900).toLocaleString("id-ID"),
    planted: (1200 + seed % 3100).toLocaleString("id-ID"),
    villages: districtVillageCount(name),
    condition: base.target >= 88 ? "Baik" : base.target >= 78 ? "Waspada" : "Perlu verifikasi",
    updated: "25 Juli 2026 · 22.42 WIT",
  };
}

function makeDistrictRows(names: string[]): LandTableRow[] {
  return names.map(name => {
    const summary = makeDistrictSummary(name);
    return {
      cells: [
        name,
        `${summary.villages} kampung`,
        `${summary.planted} ha`,
        `${summary.harvest} ha`,
        `${summary.gkg} ton`,
        summary.condition,
        `${summary.target}%`,
      ],
      statusIndex: 5,
      validationIndex: 6,
    };
  });
}

function makeVillageRows(district: string): LandTableRow[] {
  const districtRegion = getRegionByName(district, "district");
  const children = districtRegion ? getChildrenByRegionId(districtRegion.id) : [];
  return children.map((region, index) => {
    const aggregate = aggregateRegion(region.id, "MT2-2026");
    const seed = seededNumber(region.id);
    const validation = Math.round(aggregate.validation_rate);
    const status = validation >= 86 ? "Baik" : validation >= 74 ? "Waspada" : "Verifikasi";
    return {
      cells: [
        region.name,
        `${aggregate.mapped_land_ha.toLocaleString("id-ID")} ha`,
        `${aggregate.planting_realization_ha.toLocaleString("id-ID")} ha`,
        ["Persiapan", "Vegetatif", "Generatif", "Pematangan"][(seed + index) % 4],
        `${aggregate.gkg_production_ton.toLocaleString("id-ID")} ton`,
        status,
        `${validation}%`,
      ],
      statusIndex: 5,
      validationIndex: 6,
    };
  });
}

const sharedDistrictRows = sharedProductionRecords("Semua Distrik", "Semua Kampung");
const productionRows = sharedDistrictRows.map(row => ({
  district: row.name,
  harvest: Math.round(row.harvested).toLocaleString("id-ID"),
  gkg: Math.round(row.gkg).toLocaleString("id-ID"),
  yield: row.yieldRate.toLocaleString("id-ID", { maximumFractionDigits: 2 }),
  rice: Math.round(row.rice).toLocaleString("id-ID"),
  target: Math.round(row.gkg / row.target * 100),
}));
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
  const [level, setLevel] = useState<MapLevel>("province");
  const [features, setFeatures] = useState<GeoFeature[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sourceMode, setSourceMode] = useState<"live" | "local">("live");
  const [loadNonce, setLoadNonce] = useState(0);
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef({ pointerId: -1, x: 0, y: 0, originX: 0, originY: 0, moved: false });
  const suppressClickRef = useRef(false);

  const zoomIn = () => setMapZoom(value => Math.min(3, Number((value + 0.25).toFixed(2))));
  const zoomOut = () => setMapZoom(value => {
    const next = Math.max(1, Number((value - 0.25).toFixed(2)));
    if (next === 1) setMapPan({ x: 0, y: 0 });
    return next;
  });
  const resetZoom = () => { setMapZoom(1); setMapPan({ x: 0, y: 0 }); };
  const panLimit = 250 * (mapZoom - 1);
  const startPan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mapZoom === 1) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: mapPan.x, originY: mapPan.y, moved: false };
  };
  const movePan = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    if (!dragRef.current.moved && Math.abs(dx) + Math.abs(dy) > 5) {
      dragRef.current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
    }
    if (!dragRef.current.moved) return;
    const scaleToViewBox = 900 / Math.max(event.currentTarget.getBoundingClientRect().width, 1);
    setMapPan({
      x: Math.max(-panLimit, Math.min(panLimit, dragRef.current.originX + dx * scaleToViewBox)),
      y: Math.max(-panLimit, Math.min(panLimit, dragRef.current.originY + dy * scaleToViewBox)),
    });
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
    let cancelled = false;
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
    const url = level === "province"
      ? `${bigService}/13/query?${provinceQuery}`
      : `${bigDistrictService}/0/query?${districtQuery}`;

    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error("BIG service unavailable");
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        const next = Array.isArray(data.features) ? data.features : [];
        if (!next.length) throw new Error("No boundary features");
        setFeatures(next);
        setSourceMode("live");
        setStatus("ready");
      })
      .catch(async () => {
        if (cancelled) return;
        if (level === "district") {
          try {
            const response = await fetch("/data/merauke-districts.geojson");
            if (!response.ok) throw new Error("Local boundary unavailable");
            const data = await response.json();
            const next = Array.isArray(data.features) ? data.features : [];
            if (!next.length) throw new Error("No local boundary features");
            if (!cancelled) {
              setFeatures(next);
              setSourceMode("local");
              setStatus("ready");
            }
            return;
          } catch {
            // The shared error state below handles both unavailable sources.
          }
        }
        if (!cancelled) setStatus("error");
      });
    return () => { cancelled = true; };
  }, [level, loadNonce]);

  const mapModel = useMemo(() => {
    const allPoints = features.flatMap(feature => polygonRings(feature).flat());
    if (!allPoints.length) return null;
    const xs = allPoints.map(point => point[0]);
    const ys = allPoints.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = 900, height = 480, pad = 28;
    const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
    const offsetX = (width - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxY - minY) * scale) / 2;
    const project = ([lon, lat]: number[]) => [offsetX + (lon - minX) * scale, height - offsetY - (lat - minY) * scale];
    return features.map(feature => {
      const rings = polygonRings(feature);
      const projected = rings.map(ring => ring.map(project));
      const path = projected.map(ring => ring.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ") + " Z").join(" ");
      const outer = projected[0] ?? [];
      const center = outer.length
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

  const focusedDistrict = useMemo(
    () => level === "district" && selectedName ? mapModel?.find(item => item.name === selectedName) ?? null : null,
    [level, mapModel, selectedName],
  );

  useEffect(() => {
    const districtNames = level === "district" && mapModel ? mapModel.map(item => item.name).sort((a, b) => a.localeCompare(b, "id")) : [];
    onContextChange(level, selectedName, districtNames);
  }, [level, mapModel, onContextChange, selectedName]);

  const districtDummy = useMemo(() => makeDistrictSummary(selectedName), [selectedName]);
  const selectedPhase = useMemo(() => phaseProfile(selectedName), [selectedName]);
  const selectedRisk = useMemo(() => riskProfile(selectedName), [selectedName]);

  return (
    <div className="real-map-shell">
      <div className="map-breadcrumb">
        <button onClick={() => { setStatus("loading"); setLevel("province"); setSelectedName(""); resetZoom(); }} className={level === "province" ? "current" : ""}>Papua Selatan</button>
        {level === "district" && <><span>›</span><button className="current" onClick={() => { setSelectedName(""); resetZoom(); }}>Kabupaten Merauke</button>{selectedName && <><span>›</span><button className="current">{selectedName}</button></>}</>}
      </div>
      <div className={`real-map-canvas ${focusedDistrict ? "district-detail-view" : ""}`}>
        {status === "loading" && <div className="map-state"><span className="map-loader" /><strong>Memuat batas administrasi BIG…</strong><small>Menyiapkan geometri wilayah resmi</small></div>}
        {status === "error" && <div className="map-state error"><strong>Peta resmi belum dapat dimuat</strong><small>Layanan BIG dan data cadangan belum berhasil dibaca.</small><button onClick={() => { setStatus("loading"); setLoadNonce(value => value + 1); }}>Coba lagi</button></div>}
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
                    <path className="focused-district-shape" d={focusedDistrict.path} vectorEffect="non-scaling-stroke" style={layer !== "Luas Tanam" ? { fill: layerColor(layer, focusedDistrict.name) } : undefined} />
                    <text className="focused-district-label" x={focusedDistrict.center[0]} y={focusedDistrict.center[1]} textAnchor="middle">{focusedDistrict.name}</text>
                  </g>
                </svg>
              </div>
              <footer><span>◉</span> Badan Informasi Geospasial · WGS 84{sourceMode === "local" ? " · cadangan lokal" : ""}</footer>
            </section>
            <aside className="district-data-card">
              {layer === "Luas Tanam" ? <>
              <div className="district-data-heading">
                <div><span>RINGKASAN DISTRIK</span><strong>{districtDummy.district}</strong></div>
                <div className={`district-condition ${districtDummy.condition === "Baik" ? "good" : "watch"}`}>{districtDummy.condition}</div>
              </div>
              <div className="district-data-grid">
                <div><span>Luas lahan</span><strong>{districtDummy.land}</strong><small>ha</small></div>
                <div><span>Luas tanam</span><strong>{districtDummy.planted}</strong><small>ha</small></div>
                <div><span>Luas panen</span><strong>{districtDummy.harvest}</strong><small>ha</small></div>
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
                  <div><span>Progres fase</span><strong>{selectedPhase.progress}</strong><small>%</small></div>
                  <div><span>Umur tanaman</span><strong>{selectedPhase.age}</strong><small>hari</small></div>
                  <div><span>Luas dalam fase</span><strong>{selectedPhase.planted.toLocaleString("id-ID")}</strong><small>ha</small></div>
                  <div><span>Siap panen</span><strong>{selectedPhase.ready.toLocaleString("id-ID")}</strong><small>ha</small></div>
                  <div><span>Kampung terpantau</span><strong>{districtDummy.villages}</strong><small>kampung</small></div>
                </div>
                <div className="district-data-summary"><div><span>Mulai tanam</span><strong>{selectedPhase.start}</strong></div><div><span>Estimasi panen</span><strong>{selectedPhase.harvest}</strong></div></div>
                <div className="district-progress-bar phase-progress"><i style={{ width: `${selectedPhase.progress}%`, background: phaseColors[selectedPhase.phase] }} /></div>
                <small className="district-updated">Data simulasi fase tanam · {districtDummy.updated}</small>
              </> : <>
                <div className="district-data-heading">
                  <div><span>RISIKO DISTRIK</span><strong>{focusedDistrict.name}</strong></div>
                  <div className="district-condition risk-badge" style={{ background: riskColors[selectedRisk.level], color: "#fff" }}>{selectedRisk.level}</div>
                </div>
                <div className="district-data-grid">
                  <div><span>Tingkat risiko</span><strong>{selectedRisk.level}</strong></div>
                  <div><span>Skor risiko</span><strong>{selectedRisk.score}</strong><small>/100</small></div>
                  <div><span>Ancaman dominan</span><strong>{selectedRisk.threat}</strong></div>
                  <div><span>Luas terdampak</span><strong>{selectedRisk.affected.toLocaleString("id-ID")}</strong><small>ha</small></div>
                  <div><span>Kampung terdampak</span><strong>{selectedRisk.villages}</strong><small>kampung</small></div>
                  <div><span>Status verifikasi</span><strong>{selectedRisk.score > 70 ? "Prioritas" : "Terpantau"}</strong></div>
                </div>
                <div className="risk-recommendation"><span>REKOMENDASI</span><strong>{selectedRisk.recommendation}</strong></div>
                <div className="district-progress-bar"><i style={{ width: `${selectedRisk.score}%`, background: riskColors[selectedRisk.level] }} /></div>
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
                      if (level === "province" && isMerauke) { setStatus("loading"); setLevel("district"); setSelectedName(""); resetZoom(); }
                      if (level === "district") { setSelectedName(item.name); resetZoom(); }
                    }}
                    tabIndex={active ? 0 : -1}
                    role={active ? "button" : undefined}
                    aria-label={level === "province" ? `${item.name}${active ? ", klik untuk melihat distrik" : ", belum aktif"}` : `Pilih Distrik ${item.name}`}
                    onKeyDown={event => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (level === "province" && isMerauke) { setStatus("loading"); setLevel("district"); setSelectedName(""); resetZoom(); }
                      if (level === "district") { setSelectedName(item.name); resetZoom(); }
                    }}
                  >
                    <path d={item.path} vectorEffect="non-scaling-stroke" style={active && layer !== "Luas Tanam" ? { fill: layerColor(layer, item.name) } : undefined} />
                    <text x={item.center[0]} y={item.center[1]} textAnchor="middle">
                      {item.name}
                    </text>
                  </g>
                );
              })}
                </g>
              </g>
            </svg>
          </>
        ) : null}
        {!focusedDistrict && <div className="official-source"><span>◉</span><div><strong>Sumber geometri</strong><small>Badan Informasi Geospasial · WGS 84{sourceMode === "local" ? " · cadangan lokal" : ""}</small></div></div>}
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
  const [layer, setLayer] = useState<LandLayer>("Luas Tanam");
  const [search, setSearch] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState("Semua");
  const [minimumFilter, setMinimumFilter] = useState("Semua");
  const [detailRow, setDetailRow] = useState<LandTableRow | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const tableRef = useRef<HTMLElement | null>(null);
  const [mapContext, setMapContext] = useState<{ level: MapLevel; selectedName: string; districtNames: string[] }>({ level: "province", selectedName: "", districtNames: [] });
  useEffect(() => {
    if (!detailRow) return;
    const closeDetail = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailRow(null); };
    document.addEventListener("keydown", closeDetail);
    return () => document.removeEventListener("keydown", closeDetail);
  }, [detailRow]);
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
    const areaNames = mapContext.level === "province"
      ? ["Merauke"]
      : mapContext.selectedName
        ? makeVillageRows(mapContext.selectedName).map(row => row.cells[0])
        : mapContext.districtNames;
    const areaLabel = mapContext.level === "province" ? "Kabupaten" : mapContext.selectedName ? "Kampung/Kelurahan" : "Distrik";
    const countLabel = mapContext.level === "province" ? "Jumlah Distrik" : mapContext.selectedName ? "Cakupan" : "Jumlah Kampung/Kelurahan";
    const scopeTitle = mapContext.level === "province"
      ? "KABUPATEN MERAUKE"
      : mapContext.selectedName ? `DISTRIK ${mapContext.selectedName.toUpperCase()}` : "KABUPATEN MERAUKE";

    if (layer === "Fase Tanam") return {
      title: `REKAP FASE TANAM — ${scopeTitle}`,
      headers: [areaLabel, countLabel, "Luas Dalam Fase", "Fase Dominan", "Progres Fase", "Estimasi Panen", "Validasi"],
      rows: areaNames.map(name => {
        const phase = phaseProfile(name);
        const seed = seededNumber(name);
        return {
          cells: [
            name,
            mapContext.selectedName ? "1 lokasi" : mapContext.level === "province" ? "22 distrik" : `${districtVillageCount(name)} kampung`,
            `${phase.planted.toLocaleString("id-ID")} ha`,
            phase.phase,
            `${phase.progress}%`,
            phase.harvest,
            `${72 + seed % 25}%`,
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
        const risk = riskProfile(name);
        return {
          cells: [
            name,
            mapContext.selectedName ? "1 lokasi" : mapContext.level === "province" ? "22 distrik" : `${districtVillageCount(name)} kampung`,
            risk.threat,
            risk.level,
            `${risk.affected.toLocaleString("id-ID")} ha`,
            risk.recommendation,
            `${risk.score}%`,
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
      rows: makeDistrictRows(mapContext.districtNames),
    };
    return {
      title: `DAFTAR KAMPUNG TERPANTAU — DISTRIK ${mapContext.selectedName.toUpperCase()}`,
      headers: ["Kampung/Kelurahan", "Luas Lahan", "Luas Tanam", "Fase Tanam", "Produksi GKG", "Status", "Validasi"],
      rows: makeVillageRows(mapContext.selectedName),
    };
  }, [layer, mapContext]);
  const insightModel = useMemo(() => {
    if (mapContext.level === "province") return {
      scope: "Kabupaten Merauke",
      mapped: "48.920",
      active: "42.680",
      verified: 86,
      coverage: `${activeRegionCounts.districts} distrik aktif · ${activeRegionCounts.settlements} kampung/kelurahan terpantau`,
      good: 78,
      watch: 16,
      verify: 6,
    };
    if (!mapContext.selectedName) return {
      scope: "Kabupaten Merauke",
      mapped: "48.920",
      active: "42.680",
      verified: 86,
      coverage: `${activeRegionCounts.districts} distrik aktif · ${activeRegionCounts.settlements} kampung/kelurahan terpantau`,
      good: 78,
      watch: 16,
      verify: 6,
    };
    const seed = seededNumber(mapContext.selectedName);
    const verified = 71 + seed % 24;
    const watch = 8 + seed % 13;
    const verify = Math.max(3, 100 - verified - watch);
    const good = 100 - watch - verify;
    return {
      scope: `Distrik ${mapContext.selectedName}`,
      mapped: (1600 + seed % 3900).toLocaleString("id-ID"),
      active: (1200 + seed % 3100).toLocaleString("id-ID"),
      verified,
      coverage: `${districtVillageCount(mapContext.selectedName)} kampung/kelurahan terpantau`,
      good,
      watch,
      verify,
    };
  }, [mapContext]);
  const analyticalInsight = useMemo(() => {
    const scope = mapContext.selectedName ? `Distrik ${mapContext.selectedName}` : "Kabupaten Merauke";
    const key = mapContext.selectedName || "Merauke";
    const phase = phaseProfile(key);
    const risk = riskProfile(key);
    return { scope, phase, risk };
  }, [mapContext]);
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
    if (layer === "Fase Tanam") return [
      [`${entityLabel} ditampilkan`, `${filtered.length}`],
      ["Luas dalam fase", `${sum(2)} ha`],
      ["Rata-rata progres", `${average(4)}%`],
      ["Rata-rata validasi", `${average(6)}%`],
    ];
    if (layer === "Tingkat Risiko") {
      const dominant = filtered.length
        ? Array.from(new Set(filtered.map(row => row.cells[3]))).sort((a, b) => filtered.filter(row => row.cells[3] === b).length - filtered.filter(row => row.cells[3] === a).length)[0]
        : "—";
      return [
        [`${entityLabel} ditampilkan`, `${filtered.length}`],
        ["Luas terdampak", `${sum(4)} ha`],
        ["Rata-rata skor", `${average(6)}%`],
        ["Risiko dominan", dominant],
      ];
    }
    if (!mapContext.selectedName) return [
      [`${entityLabel} ditampilkan`, `${filtered.length}`],
      ["Total luas tanam", `${sum(2)} ha`],
      ["Total luas panen", `${sum(3)} ha`],
      ["Total produksi GKG", `${sum(4)} ton`],
      ["Rata-rata validasi", `${average(6)}%`],
    ];
    return [
      [`${entityLabel} ditampilkan`, `${filtered.length}`],
      ["Total luas lahan", `${sum(1)} ha`],
      ["Total luas tanam", `${sum(2)} ha`],
      ["Total produksi GKG", `${sum(4)} ton`],
      ["Rata-rata validasi", `${average(6)}%`],
    ];
  }, [filtered, layer, entityLabel, mapContext.selectedName]);
  const detailModel = useMemo(() => {
    if (!detailRow) return null;
    const name = detailRow.cells[0];
    const status = detailRow.cells[detailRow.statusIndex];
    if (layer === "Fase Tanam") {
      const profile = phaseProfile(name);
      return {
        eyebrow: "DETAIL FASE TANAM",
        name,
        status,
        color: phaseColors[status],
        description: `${name} berada pada fase ${status} berdasarkan umur tanaman sekitar ${profile.age} hari, pengamatan perkembangan tanaman, dan progres fase sebesar ${profile.progress}%.`,
        reason: `Petugas mencatat pertumbuhan tanaman sesuai indikator fase ${status.toLowerCase()}, dengan luas dalam fase ${detailRow.cells[2]} dan tidak ditemukan penyimpangan mayor pada pemantauan terakhir.`,
        recommendation: status === "Siap Panen" ? "Siapkan jadwal panen, alat, tenaga kerja, dan pengangkutan hasil." : "Lanjutkan pemantauan pertumbuhan dan sesuaikan kebutuhan air serta pemupukan.",
      };
    }
    if (layer === "Tingkat Risiko") {
      const profile = riskProfile(name);
      const reasonByRisk: Record<string, string> = {
        Rendah: "Kondisi air, tanaman, dan cuaca masih stabil serta belum ditemukan gangguan yang berdampak besar.",
        Waspada: "Terdapat indikator awal gangguan yang perlu dipantau agar tidak berkembang menjadi risiko yang lebih tinggi.",
        Sedang: "Beberapa indikator ancaman telah muncul dan berpotensi memengaruhi sebagian lahan apabila tidak segera dikendalikan.",
        "Tinggi/Kritis": "Ancaman telah memengaruhi area produktif dan membutuhkan verifikasi serta tindakan lapangan dengan prioritas tinggi.",
      };
      return {
        eyebrow: "DETAIL TINGKAT RISIKO",
        name,
        status,
        color: riskColors[status],
        description: `${name} memiliki tingkat risiko ${status} dengan ancaman dominan ${profile.threat.toLowerCase()} dan skor pemantauan ${profile.score}/100.`,
        reason: reasonByRisk[status],
        recommendation: profile.recommendation,
      };
    }
    const validation = numericValue(detailRow.cells[detailRow.validationIndex]);
    const reasonByStatus: Record<string, string> = {
      Baik: `Status Baik diberikan karena validasi mencapai ${validation}%, kondisi pertanaman stabil, serta produktivitas dan ketersediaan air berada dalam batas normal.`,
      Waspada: `Status Waspada diberikan karena validasi baru mencapai ${validation}% dan ditemukan indikator ringan seperti perubahan kelembapan, keterlambatan fase, atau gangguan tanaman.`,
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
  }, [detailRow, layer]);
  useEffect(() => {
    if (!detailRow) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailRow(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailRow]);

  return (
    <div className="subpage page-enter">
      <PageTitle eyebrow="PEMANTAUAN SPASIAL" title="Peta Lahan Pertanian" description="Sebaran lahan sawah, fase pertumbuhan, dan status pemantauan Kabupaten Merauke" />
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
          <GeoAdministrativeMap layer={layer} onContextChange={handleMapContext} />
        </article>
        <aside className="land-insight">
          {layer === "Luas Tanam" ? <>
          <article className="card mini-stat"><span>LUAS LAHAN TERPETAKAN</span><small className="insight-scope">{insightModel.scope}</small><strong>{insightModel.mapped} <small>ha</small></strong><em>↑ {insightModel.verified}% telah diverifikasi</em></article>
          <article className="card mini-stat"><span>LAHAN AKTIF MT II</span><small className="insight-scope">{insightModel.scope}</small><strong>{insightModel.active} <small>ha</small></strong><em>{insightModel.coverage}</em></article>
          <article className="card condition-card"><div className="card-title"><div>KONDISI LAHAN</div><span>{insightModel.scope}</span></div><div><span>Baik <b>{insightModel.good}%</b></span><i><em style={{width:`${insightModel.good}%`}} /></i><span>Waspada <b>{insightModel.watch}%</b></span><i><em className="amber-bar" style={{width:`${insightModel.watch}%`}} /></i><span>Perlu verifikasi <b>{insightModel.verify}%</b></span><i><em className="red-bar" style={{width:`${insightModel.verify}%`}} /></i></div></article>
          </> : layer === "Fase Tanam" ? <>
            <article className="card mini-stat"><span>FASE TANAM DOMINAN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong className="textual-stat" style={{color:phaseColors[analyticalInsight.phase.phase]}}>{analyticalInsight.phase.phase}</strong><em>Progres fase {analyticalInsight.phase.progress}%</em></article>
            <article className="card mini-stat"><span>LUAS SIAP PANEN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong>{analyticalInsight.phase.ready.toLocaleString("id-ID")} <small>ha</small></strong><em>Estimasi {analyticalInsight.phase.harvest}</em></article>
            <article className="card condition-card"><div className="card-title"><div>KOMPOSISI FASE</div><span>{analyticalInsight.scope}</span></div><div><span>Vegetatif <b>42%</b></span><i><em style={{width:"42%",background:phaseColors.Vegetatif}} /></i><span>Generatif <b>34%</b></span><i><em style={{width:"34%",background:phaseColors.Generatif}} /></i><span>Siap panen <b>24%</b></span><i><em style={{width:"24%",background:phaseColors["Siap Panen"]}} /></i></div></article>
          </> : <>
            <article className="card mini-stat"><span>LUAS WILAYAH BERISIKO</span><small className="insight-scope">{analyticalInsight.scope}</small><strong>{analyticalInsight.risk.affected.toLocaleString("id-ID")} <small>ha</small></strong><em>{analyticalInsight.risk.threat}</em></article>
            <article className="card mini-stat"><span>TINGKAT RISIKO DOMINAN</span><small className="insight-scope">{analyticalInsight.scope}</small><strong className="textual-stat" style={{color:riskColors[analyticalInsight.risk.level]}}>{analyticalInsight.risk.level}</strong><em>{analyticalInsight.risk.villages} wilayah terdampak</em></article>
            <article className="card condition-card"><div className="card-title"><div>KOMPOSISI RISIKO</div><span>{analyticalInsight.scope}</span></div><div><span>Rendah <b>54%</b></span><i><em style={{width:"54%",background:riskColors.Rendah}} /></i><span>Waspada <b>29%</b></span><i><em style={{width:"29%",background:riskColors.Waspada}} /></i><span>Tinggi/Kritis <b>17%</b></span><i><em style={{width:"17%",background:riskColors["Tinggi/Kritis"]}} /></i></div></article>
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
        <div className="table-scroll"><table><thead><tr>{tableModel.headers.map(header => <th key={header}>{header}</th>)}<th>Detail</th></tr></thead><tbody>{visibleRows.map((row, rowIndex) => <tr key={`${row.cells[0]}-${rowIndex}`}>{row.cells.map((cell,i) => {
          const indicatorColor = layer === "Fase Tanam" ? phaseColors[cell] : layer === "Tingkat Risiko" ? riskColors[cell] : undefined;
          return <td key={i}>{i === row.statusIndex ? <span className={`status ${indicatorColor ? "layer-status" : cell !== "Baik" && cell !== "Aktif" ? "warn" : ""}`} style={indicatorColor ? { color: indicatorColor, borderColor: `${indicatorColor}55`, background: `${indicatorColor}18` } : undefined}>{cell}</span> : i === row.validationIndex ? <span className="validation"><i style={{width:cell}} />{cell}</span> : cell}</td>;
        })}<td><button className="detail-button" onClick={() => setDetailRow(row)}>Lihat selengkapnya</button></td></tr>)}</tbody></table></div>
        <div className="table-total">
          <div><strong>TOTAL HASIL</strong><small>Berdasarkan data yang sedang ditampilkan</small></div>
          {totalModel.map(item => <div key={item[0]}><span>{item[0]}</span><b>{item[1]}</b></div>)}
        </div>
        {!filterActive && totalPages > 1 && <div className="table-pagination">
          <button disabled={tablePage === 1} onClick={() => setTablePage(page => Math.max(1, page - 1))}>← Sebelumnya</button>
          <span>Halaman <strong>{tablePage}</strong> dari {totalPages}</span>
          <button disabled={tablePage === totalPages} onClick={() => setTablePage(page => Math.min(totalPages, page + 1))}>Lihat selanjutnya →</button>
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

export default function Home() {
  const [activeNav, setActiveNav] = useState("Ringkasan");
  const [period, setPeriod] = useState("MT II 2026");
  const [district, setDistrict] = useState("Kabupaten Merauke");
  const [selected, setSelected] = useState(districts[0]);
  const [showAlerts, setShowAlerts] = useState(false);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Sistem Informasi Pangan Papua Selatan">
          <span className="grain">♨</span>
          <strong>SI</strong>
        </div>
        <nav aria-label="Navigasi utama">
          {nav.map(([icon, label]) => (
            <button
              key={label}
              className={activeNav === label ? "nav-item active" : "nav-item"}
              onClick={() => ["Ringkasan","Peta Lahan","Musim Tanam","Produksi"].includes(label) && setActiveNav(label)}
              aria-disabled={!["Ringkasan","Peta Lahan","Musim Tanam","Produksi"].includes(label)}
            >
              <span>{icon}</span>
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
            <div className="mini-emblem">♨</div>
            <div>
              <strong>SIPANGAN PAPUA SELATAN</strong>
              <span>Pusat Kendali Padi & Beras</span>
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
          {false && activeNav === "Ringkasan" && <>
          <section className="page-heading">
            <div>
              <p className="eyebrow">RINGKASAN EKSEKUTIF · PKN I</p>
              <h1>Dashboard Pemantauan Padi dan Beras</h1>
              <p>Kabupaten Merauke sebagai wilayah percontohan lumbung pangan Papua Selatan</p>
            </div>
            <button className="download" onClick={() => window.print()}>⇩ Unduh Laporan</button>
          </section>

          <section className="filters" aria-label="Filter dashboard">
            <label>Periode
              <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option>MT II 2026</option><option>MT I 2026</option><option>Tahun 2026</option>
              </select>
            </label>
            <label>Wilayah
              <select value={district} onChange={(e) => setDistrict(e.target.value)}>
                <option>Kabupaten Merauke</option><option>Distrik Merauke</option><option>Distrik Semangga</option>
              </select>
            </label>
            <label>Komoditas
              <select><option>Padi & Beras</option><option>Padi</option><option>Beras</option></select>
            </label>
            <div className="season"><span>●</span><div><small>STATUS MUSIM TANAM</small><strong>MT II · April–September</strong></div></div>
          </section>

          <section className="metric-grid">
            {metrics.map((metric) => (
              <article className="metric" key={metric.label}>
                <div className="metric-icon">{metric.icon}</div>
                <div>
                  <span>{metric.label}</span>
                  <strong>{metric.value} <small>{metric.unit}</small></strong>
                  <em>↑ {metric.change} <i>vs 2025</i></em>
                </div>
              </article>
            ))}
          </section>

          <section className="main-grid">
            <article className="card map-card">
              <div className="card-title">
                <div><span className="live-dot" /> PETA SEBARAN TANAM & PANEN</div>
                <button>Lihat detail ↗</button>
              </div>
              <div className="map-stage">
                <div className="map-copy"><small>PAPUA SELATAN</small><strong>KABUPATEN<br />MERAUKE</strong></div>
                <div className="map-shape">
                  <span className="field f1" /><span className="field f2" /><span className="field f3" />
                  <span className="field f4" /><span className="field f5" /><span className="field f6" />
                  {districts.map((item) => (
                    <button
                      key={item.name}
                      className={`map-pin ${selected.name === item.name ? "selected" : ""} ${item.risk === "Tinggi" ? "danger" : ""}`}
                      style={{ left: `${item.x}%`, top: `${item.y}%` }}
                      onClick={() => setSelected(item)}
                      aria-label={`Pilih ${item.name}`}
                    >
                      <i />
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
                <div className="legend"><strong>Legenda</strong><span><i className="green" /> Tanam</span><span><i className="cyan" /> Panen</span><span><i className="orange" /> Risiko</span></div>
                <div className="map-detail">
                  <span>WILAYAH TERPILIH</span><strong>{selected.name}</strong>
                  <p>Produksi GKG <b>{selected.value}</b></p>
                  <p>Status <b className={selected.risk === "Tinggi" ? "red" : ""}>{selected.risk}</b></p>
                </div>
              </div>
            </article>

            <div className="analytics-stack">
              <article className="card chart-card">
                <div className="card-title"><div>TARGET VS REALISASI PRODUKSI GKG 2026</div><span>Ton</span></div>
                <div className="chart">
                  <div className="chart-labels"><span>220K</span><span>165K</span><span>110K</span><span>55K</span><span>0</span></div>
                  <div className="plot">
                    <div className="grid-lines" />
                    <svg viewBox="0 0 500 160" preserveAspectRatio="none" aria-label="Grafik target dan realisasi">
                      <path className="target-line" d="M0 145 C90 117 160 101 220 78 S390 48 500 8" />
                      <path className="area" d="M0 145 C65 115 110 112 165 84 S265 71 310 51 L310 160 L0 160 Z" />
                      <path className="actual-line" d="M0 145 C65 115 110 112 165 84 S265 71 310 51" />
                    </svg>
                    <div className="chart-tip"><span>Juli 2026</span><strong>174.577 ton</strong><small>Target: 197.220 ton</small></div>
                  </div>
                  <div className="months">{["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"].map(m => <span key={m}>{m}</span>)}</div>
                </div>
              </article>

              <article className="card alert-card">
                <div className="card-title">
                  <div>△ PERINGATAN RISIKO</div>
                  <button onClick={() => setShowAlerts(!showAlerts)}>{showAlerts ? "Tutup" : "Lihat semua"} →</button>
                </div>
                <div className="alerts">
                  <button onClick={() => setSelected(districts[3])}><b className="flood">≋</b><span><strong>Banjir — Kurik</strong><small>Potensi banjir di wilayah persawahan</small></span><em>Tinggi</em></button>
                  <button onClick={() => setSelected(districts[1])}><b className="drought">☀</b><span><strong>Kekeringan — Semangga</strong><small>Curah hujan rendah terpantau</small></span><em>Sedang</em></button>
                  {showAlerts && <button><b className="pest">⌁</b><span><strong>Hama Wereng — Tanah Miring</strong><small>Peningkatan populasi perlu verifikasi</small></span><em>Sedang</em></button>}
                </div>
              </article>
            </div>
          </section>

          <section className="summary-strip">
            <div><span>▣</span><small>PERKIRAAN PANEN PUNCAK</small><strong>Jul–Agu 2026</strong></div>
            <div><span>▤</span><small>STOK BERAS SAAT INI</small><strong>21.480 <i>ton</i></strong><em>● Aman</em></div>
            <div><span>▥</span><small>KEBUTUHAN BERAS 2026</small><strong>118.500 <i>ton</i></strong></div>
            <div><span>♢</span><small>STATUS KETAHANAN</small><strong className="safe">Aman</strong><em>Surplus diproyeksikan</em></div>
            <div><span>♙</span><small>POKOK SASARAN PETANI</small><strong>28.950 <i>KK</i></strong></div>
            <div><span>♜</span><small>ALSINTAN TERSEDIA</small><strong>312 <i>unit</i></strong><em>Siap operasional</em></div>
          </section>
          </>}

          {activeNav === "Peta Lahan" && <LandPage />}
          {activeNav === "Musim Tanam" && <SeasonPage />}
          {activeNav === "Produksi" && <ProductionPage />}

          <footer><span>Data pada prototipe bersifat demonstratif dan perlu divalidasi sebelum digunakan sebagai dasar kebijakan.</span><strong>© 2026 Pemerintah Provinsi Papua Selatan</strong></footer>
        </div>
      </section>
    </main>
  );
}
