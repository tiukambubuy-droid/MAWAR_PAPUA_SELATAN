import { getChildrenByRegionId, getRegionById, seasonRecords } from "@/lib/data-foundation";
import { getDominantPhase, getDominantRisk, type CompositionItem, type DominantPhase, type DominantRisk } from "@/lib/presentation-selectors";

export const phaseColors: Record<string, string> = {
  Persiapan: "#4b8fa8",
  Persemaian: "#b9dba8",
  Vegetatif: "#55a977",
  Generatif: "#d9c954",
  Pematangan: "#df963c",
  "Siap Panen": "#ad7927",
  Pascapanen: "#7f6b45",
};

export const riskColors: Record<string, string> = {
  Rendah: "#57a878",
  Waspada: "#dfc849",
  Sedang: "#e79a39",
  "Tinggi/Kritis": "#b33d38",
};

export const mappedLandRiskDefinition = {
  id: "mapped_planting_risk_classification",
  label: "Klasifikasi risiko lahan",
  description: "Klasifikasi kondisi risiko atas realisasi luas tanam yang terpetakan pada musim aktif.",
  denominatorField: "planting_realization_ha",
  unit: "ha",
} as const;

function descendantIds(regionId: string): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    const children = getChildrenByRegionId(id);
    if (!children.length) ids.add(id);
    children.forEach(child => visit(child.id));
  };
  visit(regionId);
  return ids;
}

export type MonitoringComposition = {
  seasonId: string;
  regionId: string;
  monitored: boolean;
  dominant: string;
  composition: Record<string, number>;
  total: number;
  items: CompositionItem[];
  dominantDetail: DominantPhase | DominantRisk;
  monitoredLocationCount: number;
};

function selectComposition(
  seasonId: string,
  regionId: string,
  field: "phase" | "risk",
): MonitoringComposition {
  const region = getRegionById(regionId);
  if (!region || region.monitoring_status === "not_monitored") {
    const items: CompositionItem[] = [{ id: "not-monitored", label: "Belum dipantau", area: null, color: "#aab7b0", monitoringStatus: "not_monitored" }];
    return { seasonId, regionId, monitored: false, dominant: "Belum dipantau", composition: {}, total: 0, items, dominantDetail: field === "phase" ? getDominantPhase(items) : getDominantRisk(items), monitoredLocationCount: 0 };
  }
  const ids = descendantIds(regionId);
  const rows = seasonRecords.filter(row =>
    row.season_id === seasonId &&
    row.validation_status === "approved" &&
    ids.has(row.region_id),
  );
  const weights: Record<string, number> = {};
  for (const row of rows) {
    const key = row[field] || "Belum dipantau";
    weights[key] = (weights[key] ?? 0) + Math.max(0, row.planting_realization_ha);
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const composition = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, total ? value / total * 100 : 0]));
  const colors = field === "phase" ? phaseColors : riskColors;
  const items = Object.entries(weights).map(([key, area]) => ({ id: key, label: key, area, color: colors[key] ?? "#aab7b0", monitoringStatus: "active" as const }));
  const monitoredLocationCount = new Set(rows.map(row => row.region_id)).size;
  const dominantDetail = field === "phase" ? getDominantPhase(items) : getDominantRisk(items, monitoredLocationCount);
  return { seasonId, regionId, monitored: rows.length > 0, dominant: dominantDetail.label, composition, total, items, dominantDetail, monitoredLocationCount };
}

export function selectPhaseMonitoring(seasonId: string, regionId: string) {
  return selectComposition(seasonId, regionId, "phase") as MonitoringComposition & { dominantDetail: DominantPhase };
}

export function selectRiskMonitoring(seasonId: string, regionId: string) {
  return selectComposition(seasonId, regionId, "risk") as MonitoringComposition & { dominantDetail: DominantRisk };
}

export type MapBreadcrumbTarget = "province" | "regency" | "district";
export function reduceMapBreadcrumb(
  target: MapBreadcrumbTarget,
  current: { districtId: string | null; villageId: string | null },
) {
  if (target === "district") return { districtId: current.districtId, villageId: null };
  return { districtId: null, villageId: null };
}
