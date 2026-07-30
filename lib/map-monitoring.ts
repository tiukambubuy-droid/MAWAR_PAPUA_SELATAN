import { getChildrenByRegionId, getRegionById, seasonRecords } from "@/lib/data-foundation";

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
  snapshotId: string | null;
  monitored: boolean;
  dominant: string;
  composition: Record<string, number>;
  total: number;
};

function selectComposition(
  seasonId: string,
  regionId: string,
  snapshotId: string | null,
  field: "phase" | "risk",
): MonitoringComposition {
  const region = getRegionById(regionId);
  if (!region || region.monitoring_status === "not_monitored") {
    return { seasonId, regionId, snapshotId, monitored: false, dominant: "Belum dipantau", composition: {}, total: 0 };
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
  const dominant = Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Belum dipantau";
  return { seasonId, regionId, snapshotId, monitored: rows.length > 0, dominant, composition, total };
}

export function selectPhaseMonitoring(seasonId: string, regionId: string, snapshotId: string | null) {
  return selectComposition(seasonId, regionId, snapshotId, "phase");
}

export function selectRiskMonitoring(seasonId: string, regionId: string, snapshotId: string | null) {
  return selectComposition(seasonId, regionId, snapshotId, "risk");
}

export type MapBreadcrumbTarget = "province" | "regency" | "district";
export function reduceMapBreadcrumb(
  target: MapBreadcrumbTarget,
  current: { districtId: string | null; villageId: string | null },
) {
  if (target === "district") return { districtId: current.districtId, villageId: null };
  return { districtId: null, villageId: null };
}
