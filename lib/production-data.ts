import {
  aggregateRegion,
  calculateEstimatedLoss,
  calculateEstimatedRice,
  calculateProductivity,
  districtAggregates,
  getChildrenByRegionId,
  getRegionById,
  getRegionByName,
  getSeasonById,
  productionRecords,
} from "@/lib/data-foundation";
import type { ProductionDistrict, ProductionRecord, ProductionVillage } from "@/types/production";

const trendFactors = [0.1309, 0.5807, 1];

function presentationRecord(
  id: string,
  name: string,
  level: ProductionRecord["level"],
  aggregate: ReturnType<typeof aggregateRegion>,
): ProductionRecord {
  const gkg = aggregate.gkg_production_ton;
  return {
    id,
    name,
    level,
    harvested: aggregate.harvested_area_ha,
    yieldRate: calculateProductivity(gkg, aggregate.harvested_area_ha),
    gkg,
    rice: calculateEstimatedRice(gkg),
    loss: calculateEstimatedLoss(gkg, 4.5),
    target: aggregate.gkg_production_target_ton,
    validation: Math.round(aggregate.validation_rate),
    trend: trendFactors.map((factor) => Math.round(gkg * factor)),
  };
}

export const productionDistricts: ProductionDistrict[] = districtAggregates("MT2-2026").map(({ region }) => ({
  id: region.id,
  name: region.name,
  villages: getChildrenByRegionId(region.id)
    .filter((item) => item.monitoring_status === "active")
    .map((item) => ({
      id: item.id,
      name: item.name,
      administrativeType: item.administrative_type === "kelurahan" ? "kelurahan" as const : "kampung" as const,
      groups: [],
    })),
}));

export function recordsForScope(districtName: string, villageName: string, seasonId = "MT2-2026") {
  if (districtName === "Semua Distrik") {
    return districtAggregates(seasonId).map(({ region, aggregate }) =>
      presentationRecord(region.id, region.name, "Distrik", aggregate),
    );
  }
  const district = getRegionByName(districtName, "district") ?? districtAggregates(seasonId)[0]?.region;
  if (!district) return [];
  if (villageName === "Semua Kampung" || villageName === "Semua Kampung/Kelurahan") {
    return getChildrenByRegionId(district.id)
      .filter((region) => region.monitoring_status === "active")
      .map((region) =>
        presentationRecord(
          region.id,
          region.name,
          region.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung",
          aggregateRegion(region.id, seasonId),
        ),
      );
  }
  const village = getChildrenByRegionId(district.id).find(
    (region) => region.name === villageName || region.aliases.includes(villageName),
  );
  return village
    ? [presentationRecord(
        village.id,
        village.name,
        village.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung",
        aggregateRegion(village.id, seasonId),
      )]
    : [];
}

export function recordsForRegionIds(seasonId: string, districtId: string | null, villageId: string | null) {
  if (villageId) {
    const region = getRegionById(villageId);
    return region ? [presentationRecord(
      region.id,
      region.name,
      region.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung",
      aggregateRegion(region.id, seasonId),
    )] : [];
  }
  if (districtId) {
    return getChildrenByRegionId(districtId)
      .filter((region) => region.monitoring_status === "active")
      .map((region) => presentationRecord(
        region.id,
        region.name,
        region.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung",
        aggregateRegion(region.id, seasonId),
      ));
  }
  return districtAggregates(seasonId).map(({ region, aggregate }) =>
    presentationRecord(region.id, region.name, "Distrik", aggregate),
  );
}

export function aggregateProduction(records: ProductionRecord[]) {
  const harvested = records.reduce((sum, row) => sum + row.harvested, 0);
  const gkg = records.reduce((sum, row) => sum + row.gkg, 0);
  return {
    id: "aggregate",
    name: "Total",
    level: records[0]?.level ?? "Distrik",
    harvested,
    yieldRate: calculateProductivity(gkg, harvested),
    gkg,
    rice: calculateEstimatedRice(gkg),
    loss: calculateEstimatedLoss(gkg, 4.5),
    target: records.reduce((sum, row) => sum + row.target, 0),
    validation: records.length
      ? Math.round(records.reduce((sum, row) => sum + row.validation, 0) / records.length)
      : 0,
    trend: [0, 1, 2].map((index) => records.reduce((sum, row) => sum + (row.trend[index] ?? 0), 0)),
  } satisfies ProductionRecord;
}

export function villagesForDistrict(districtName: string): ProductionVillage[] {
  return productionDistricts.find((item) => item.name === districtName)?.villages ?? [];
}

export function currentProductionSeason(seasonId = "MT2-2026") {
  return getSeasonById(seasonId);
}

export const approvedProductionSourceRecords = productionRecords.filter(
  (record) => record.season_id === "MT2-2026" && record.validation_status === "approved",
);
