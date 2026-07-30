import referenceJson from "@/data/master/data-foundation.json";
import regionsJson from "@/data/master/regions.json";
import landJson from "@/data/monitoring/land-monitoring.json";
import seasonJson from "@/data/monitoring/season-monitoring.json";
import productionJson from "@/data/monitoring/production-monitoring.json";

export type ValidationStatus = "draft" | "submitted" | "verified" | "approved";
export type RegionType = "province" | "regency" | "district" | "kampung" | "kelurahan";

export type Region = {
  id: string;
  code: string;
  legacy_code: string | null;
  name: string;
  canonical_name: string;
  aliases: string[];
  administrative_type: RegionType;
  parent_id: string | null;
  monitoring_status: "context" | "active" | "not_monitored";
  agricultural_role: "rice_center" | "supporting" | "non_active" | "unknown";
  is_active: boolean;
};

export type Season = {
  season_id: string;
  name: string;
  display_name: string;
  sequence: number;
  year: number;
  status: "completed" | "in_progress";
  commodity_id: string;
  regency_id: string;
  start_date: string;
  end_date: string;
  reporting_cutoff: string;
  data_type: "simulation";
  validation_status: ValidationStatus;
  validation_rate: number;
};

export type LandRecord = {
  id: string;
  season_id: string;
  region_id: string;
  region_level: "kampung" | "kelurahan";
  commodity_id: string;
  monitoring_status: "active";
  validation_status: ValidationStatus;
  validation_rate: number;
  updated_at: string;
  source_type: string;
  data_type: "simulation";
  mapped_land_ha: number;
  active_land_ha: number;
  phase: string;
  risk: string;
};

export type SeasonRecord = Omit<LandRecord, "mapped_land_ha" | "active_land_ha"> & {
  planting_target_ha: number;
  planting_realization_ha: number;
};

export type ProductionRecord = Omit<LandRecord, "mapped_land_ha" | "active_land_ha" | "phase" | "risk"> & {
  harvested_area_ha: number;
  gkg_production_ton: number;
  gkg_production_target_ton: number;
  loss_rate: number;
};

export type Aggregate = {
  region_id: string;
  mapped_land_ha: number;
  active_land_ha: number;
  planting_target_ha: number;
  planting_realization_ha: number;
  harvested_area_ha: number;
  gkg_production_ton: number;
  gkg_production_target_ton: number;
  validation_rate: number;
};

export const regions = regionsJson.regions as Region[];
export const seasons = referenceJson.seasons as Season[];
export const landRecords = landJson.records as LandRecord[];
export const seasonRecords = seasonJson.records as SeasonRecord[];
export const productionRecords = productionJson.records as ProductionRecord[];
export const millingYield = referenceJson.milling_yield;
export const seasonSnapshots = seasonJson.snapshots;
export const futureTargetsAndProjections = seasonJson.future_targets_and_projections;

const regionMap = new Map(regions.map((region) => [region.id, region]));
const emptyAggregate = (regionId: string): Aggregate => ({
  region_id: regionId,
  mapped_land_ha: 0,
  active_land_ha: 0,
  planting_target_ha: 0,
  planting_realization_ha: 0,
  harvested_area_ha: 0,
  gkg_production_ton: 0,
  gkg_production_target_ton: 0,
  validation_rate: 0,
});

export function getRegionById(regionId: string) {
  return regionMap.get(regionId) ?? null;
}

export function getRegionByName(name: string, type?: RegionType) {
  const normalized = name.toLocaleLowerCase("id-ID");
  return regions.find(
    (region) =>
      (!type || region.administrative_type === type) &&
      (region.name.toLocaleLowerCase("id-ID") === normalized ||
        region.aliases.some((alias) => alias.toLocaleLowerCase("id-ID") === normalized)),
  ) ?? null;
}

export function getChildrenByRegionId(regionId: string) {
  return regions.filter((region) => region.parent_id === regionId);
}

export function getSeasonById(seasonId: string) {
  return seasons.find((season) => season.season_id === seasonId) ?? null;
}

export function getApprovedRecords<T extends { validation_status: ValidationStatus }>(records: T[]) {
  return records.filter((record) => record.validation_status === "approved");
}

export function calculatePlantingAchievement(realization: number, target: number) {
  return target ? (realization / target) * 100 : 0;
}

export function calculateProductivity(production: number, harvestedArea: number) {
  return harvestedArea ? production / harvestedArea : 0;
}

export function calculateProductionAchievement(production: number, target: number) {
  return target ? (production / target) * 100 : 0;
}

export function calculateEstimatedRice(production: number, rate = millingYield.rate) {
  return production * rate / 100;
}

export function calculateEstimatedLoss(production: number, rate: number) {
  return production * rate / 100;
}

export function descendantVillageIds(regionId: string): string[] {
  const region = getRegionById(regionId);
  if (!region) return [];
  if (region.administrative_type === "kampung" || region.administrative_type === "kelurahan") return [region.id];
  const result: string[] = [];
  const visit = (parentId: string) => {
    getChildrenByRegionId(parentId).forEach((child) => {
      if (child.administrative_type === "kampung" || child.administrative_type === "kelurahan") result.push(child.id);
      else visit(child.id);
    });
  };
  visit(regionId);
  return result;
}

export function aggregateRegion(regionId: string, seasonId: string): Aggregate {
  const villageIds = new Set(descendantVillageIds(regionId));
  const land = getApprovedRecords(landRecords).filter(
    (record) => record.season_id === seasonId && villageIds.has(record.region_id),
  );
  const planting = getApprovedRecords(seasonRecords).filter(
    (record) => record.season_id === seasonId && villageIds.has(record.region_id),
  );
  const production = getApprovedRecords(productionRecords).filter(
    (record) => record.season_id === seasonId && villageIds.has(record.region_id),
  );
  const aggregate = emptyAggregate(regionId);
  land.forEach((record) => {
    aggregate.mapped_land_ha += record.mapped_land_ha;
    aggregate.active_land_ha += record.active_land_ha;
  });
  planting.forEach((record) => {
    aggregate.planting_target_ha += record.planting_target_ha;
    aggregate.planting_realization_ha += record.planting_realization_ha;
  });
  production.forEach((record) => {
    aggregate.harvested_area_ha += record.harvested_area_ha;
    aggregate.gkg_production_ton += record.gkg_production_ton;
    aggregate.gkg_production_target_ton += record.gkg_production_target_ton;
  });
  const validationRecords = [...land, ...planting, ...production];
  aggregate.validation_rate = validationRecords.length
    ? validationRecords.reduce((sum, record) => sum + record.validation_rate, 0) / validationRecords.length
    : 0;
  return aggregate;
}

export function aggregateVillageToDistrict(districtId: string, seasonId: string) {
  return aggregateRegion(districtId, seasonId);
}

export function aggregateDistrictToRegency(regencyId: string, seasonId: string) {
  const districts = getChildrenByRegionId(regencyId).filter(
    (region) => region.administrative_type === "district",
  );
  const total = emptyAggregate(regencyId);
  districts.map((district) => aggregateVillageToDistrict(district.id, seasonId)).forEach((item) => {
    for (const key of Object.keys(total) as (keyof Aggregate)[]) {
      if (key !== "region_id" && key !== "validation_rate") total[key] += item[key] as never;
    }
  });
  const active = districts.filter((district) => district.monitoring_status === "active");
  total.validation_rate = active.length
    ? active.reduce((sum, district) => sum + aggregateRegion(district.id, seasonId).validation_rate, 0) / active.length
    : 0;
  return total;
}

export function validateComposition(values: number[], tolerance = 0.1) {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) <= tolerance;
}

export function validateRegionalHierarchy() {
  const ids = new Set(regions.map((region) => region.id));
  return regions.every((region) =>
    region.administrative_type === "province"
      ? region.parent_id === null
      : region.parent_id !== null && ids.has(region.parent_id),
  );
}

export function districtAggregates(seasonId = "MT2-2026") {
  return getChildrenByRegionId("93.01")
    .filter((region) => region.administrative_type === "district" && region.monitoring_status === "active")
    .map((region) => ({ region, aggregate: aggregateRegion(region.id, seasonId) }));
}

export function scopeAggregate(districtName: string, villageName: string, seasonId = "MT2-2026") {
  if (districtName === "Semua Distrik") return aggregateRegion("93.01", seasonId);
  const district = getRegionByName(districtName, "district");
  if (!district) return emptyAggregate("unknown");
  if (villageName === "Semua Kampung" || villageName === "Semua Kampung/Kelurahan") {
    return aggregateRegion(district.id, seasonId);
  }
  const village = getChildrenByRegionId(district.id).find(
    (region) => region.name === villageName || region.aliases.includes(villageName),
  );
  return aggregateRegion(village?.id ?? district.id, seasonId);
}

export const yieldNote = "Estimasi menggunakan rendemen standar Papua 63,39% — SKGB BPS 2018.";
export const compactYieldNote = "Rendemen standar Papua: 63,39%";

export function getDefaultSeasonSnapshot(seasonId: string) {
  const season = getSeasonById(seasonId);
  if (!season) return null;
  const cutoffPeriod = season.reporting_cutoff.slice(0, 7);
  const actuals = seasonSnapshots
    .filter(
      (snapshot) =>
        snapshot.season_id === seasonId &&
        snapshot.kind === "actual" &&
        snapshot.period <= cutoffPeriod,
    )
    .sort((a, b) => a.period_end.localeCompare(b.period_end));
  return actuals.at(-1) ?? null;
}

export function getSeasonKpis(seasonId: string, regionId = "93.01") {
  const season = getSeasonById(seasonId);
  const aggregate = aggregateRegion(regionId, seasonId);
  return {
    season,
    aggregate,
    planting_achievement_percent: calculatePlantingAchievement(
      aggregate.planting_realization_ha,
      aggregate.planting_target_ha,
    ),
    productivity_ton_per_ha: calculateProductivity(
      aggregate.gkg_production_ton,
      aggregate.harvested_area_ha,
    ),
    production_achievement_percent: calculateProductionAchievement(
      aggregate.gkg_production_ton,
      aggregate.gkg_production_target_ton,
    ),
    estimated_rice_ton: calculateEstimatedRice(aggregate.gkg_production_ton),
    estimated_loss_ton: calculateEstimatedLoss(aggregate.gkg_production_ton, 4.5),
  };
}

export function getAdministrativeRegionCounts() {
  const districts = regions.filter((region) => region.administrative_type === "district").length;
  const kampung = regions.filter((region) => region.administrative_type === "kampung").length;
  const kelurahan = regions.filter((region) => region.administrative_type === "kelurahan").length;
  return {
    provinces: regions.filter((region) => region.administrative_type === "province").length,
    regencies: regions.filter((region) => region.administrative_type === "regency").length,
    districts,
    kampung,
    kelurahan,
    settlements: kampung + kelurahan,
  };
}

export function getActiveMonitoringRegionCounts() {
  const active = regions.filter((region) => region.monitoring_status === "active");
  const kampung = active.filter((region) => region.administrative_type === "kampung").length;
  const kelurahan = active.filter((region) => region.administrative_type === "kelurahan").length;
  return {
    districts: active.filter((region) => region.administrative_type === "district").length,
    kampung,
    kelurahan,
    settlements: kampung + kelurahan,
  };
}
