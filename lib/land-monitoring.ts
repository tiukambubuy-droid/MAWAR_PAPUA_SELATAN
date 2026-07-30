import {
  aggregateRegion,
  getChildrenByRegionId,
  getRegionById,
  getRegionByName,
  landRecords,
  regions,
} from "@/lib/data-foundation";

export const landMonitoringContext = {
  regencyId: "93.01",
  seasonId: "MT2-2026",
  commodityId: "PADI",
  isDummy: true,
};

export const landMonitoringRecords = landRecords;

export { getRegionById, getRegionByName };

export function getChildren(parentId: string) {
  return getChildrenByRegionId(parentId);
}

export function getDistrictForVillage(villageId: string) {
  const village = getRegionById(villageId);
  return village?.parent_id ? getRegionById(village.parent_id) : null;
}

export function getLandRecord(villageId: string, seasonId = "MT2-2026") {
  return landRecords.find(
    (record) => record.region_id === villageId && record.season_id === seasonId,
  ) ?? null;
}

export function getLandRecordsForRegion(scopeId: string, seasonId = "MT2-2026") {
  const scope = getRegionById(scopeId);
  if (!scope) return [];
  if (scope.administrative_type === "kampung" || scope.administrative_type === "kelurahan") {
    return landRecords.filter(
      (record) => record.region_id === scopeId && record.season_id === seasonId,
    );
  }
  const children = new Set(
    scope.administrative_type === "district"
      ? getChildrenByRegionId(scopeId).map((region) => region.id)
      : regions
          .filter((region) => region.administrative_type === "kampung" || region.administrative_type === "kelurahan")
          .map((region) => region.id),
  );
  return landRecords.filter(
    (record) => children.has(record.region_id) && record.season_id === seasonId,
  );
}

export const aggregateLand = aggregateRegion;

export function getDistrictAggregates(seasonId = "MT2-2026") {
  return getChildrenByRegionId("93.01")
    .filter((region) => region.administrative_type === "district")
    .map((region) => ({ region, aggregate: aggregateRegion(region.id, seasonId) }));
}

export function getVillageAggregates(districtId: string, seasonId = "MT2-2026") {
  return getChildrenByRegionId(districtId).map((region) => ({
    region,
    aggregate: aggregateRegion(region.id, seasonId),
  }));
}

export const papuaSelatanLandAggregate = aggregateRegion("93.01", "MT2-2026");
export const meraukeLandAggregate = papuaSelatanLandAggregate;
