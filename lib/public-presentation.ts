import { getRegionById, productionRecords, regions, type Region } from "@/lib/data-foundation";
import { formatMonitoringSourceType, formatMonitoringStatus, formatMonitoringTimestamp, latestMonitoringTimestamp } from "@/lib/monitoring-presentation";
import type { ProductionRecord as PresentationProductionRecord } from "@/types/production";

export type ProductionModalScope = "regency" | "district" | "village";
export type ProductionModalPresentation = {
  scope: ProductionModalScope;
  title: string;
  regionName: string;
  regionId: string;
  parentRegency: string | null;
  seasonId: string;
  cutoff: string;
  monitoringStatus: string;
  validation: string;
  sourceType: string;
  dataType: string;
  updatedAt: string;
};

export function monitoredRegionOption(region: Region) {
  return `${region.name}${region.monitoring_status === "active" ? "" : " — Belum dipantau"}`;
}

export function buildProductionModalPresentation(row: PresentationProductionRecord, seasonId: string, cutoff: string): ProductionModalPresentation | null {
  const region = getRegionById(row.id);
  if (!region || region.monitoring_status !== "active") return null;
  const scope: ProductionModalScope = region.administrative_type === "regency" ? "regency" : region.administrative_type === "district" ? "district" : "village";
  const belongsToScope = (regionId: string) => {
    let current = getRegionById(regionId);
    while (current) {
      if (current.id === region.id) return true;
      current = getRegionById(current.parent_id ?? "");
    }
    return false;
  };
  const records = productionRecords.filter(item => item.season_id === seasonId && belongsToScope(item.region_id));
  const latest = latestMonitoringTimestamp(records.map(item => item.updated_at));
  const sourceTypes = [...new Set(records.map(item => item.source_type))];
  const dataTypes = [...new Set(records.map(item => item.data_type))];
  return {
    scope,
    title: scope === "regency" ? "Detail Produksi Kabupaten" : scope === "district" ? "Detail Produksi Distrik" : "Detail Produksi Kampung",
    regionName: region.name,
    regionId: region.id,
    parentRegency: scope === "regency" ? null : "Kabupaten Merauke",
    seasonId,
    cutoff,
    monitoringStatus: "Terpantau",
    validation: `${row.validation}%`,
    sourceType: sourceTypes.length ? sourceTypes.map(formatMonitoringSourceType).join(", ") : "Belum tersedia",
    dataType: dataTypes.length ? dataTypes.map(formatMonitoringStatus).join(", ") : "Belum tersedia",
    updatedAt: formatMonitoringTimestamp(latest),
  };
}

export function districtMonitoringCoverage() {
  const districts = regions.filter(item => item.parent_id === "93.01" && item.administrative_type === "district");
  return { total: districts.length, monitored: districts.filter(item => item.monitoring_status === "active").length, label: `${districts.filter(item => item.monitoring_status === "active").length} distrik terpantau dari ${districts.length} distrik` };
}
