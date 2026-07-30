import landMonitoringJson from "@/data/monitoring/land-monitoring.json";
import regionsJson from "@/data/master/regions.json";
import phasesJson from "@/data/master/planting-phases.json";
import landStatusesJson from "@/data/master/land-statuses.json";
import riskLevelsJson from "@/data/master/risk-levels.json";
import threatsJson from "@/data/master/threats.json";
import type {
  LandAggregate,
  LandAreaValues,
  LandMonitoringRecord,
  LandScopeLevel,
} from "@/types/land-monitoring";

type Region = (typeof regionsJson.regions)[number];

const records = landMonitoringJson.records as LandMonitoringRecord[];
const regions = regionsJson.regions;
const regionById = new Map(regions.map((region) => [region.id, region]));
const phaseById = new Map(phasesJson.plantingPhases.map((phase) => [phase.id, phase]));
const statusById = new Map(landStatusesJson.landStatuses.map((status) => [status.id, status]));
const riskById = new Map(riskLevelsJson.riskLevels.map((risk) => [risk.id, risk]));
const threatById = new Map(threatsJson.threats.map((threat) => [threat.id, threat]));
const recordByVillageId = new Map(records.map((record) => [record.villageId, record]));

const emptyAreas = (): LandAreaValues => ({
  potentialHa: 0,
  mappedHa: 0,
  verifiedHa: 0,
  activeHa: 0,
  plantedHa: 0,
  harvestedHa: 0,
  failedHarvestHa: 0,
  fallowHa: 0,
});

const sumAreas = (target: LandAreaValues, values: LandAreaValues) => {
  (Object.keys(target) as Array<keyof LandAreaValues>).forEach((key) => {
    target[key] += values[key];
  });
};

const weightedPercent = (
  selectedRecords: LandMonitoringRecord[],
  value: (record: LandMonitoringRecord) => number,
  weight: (record: LandMonitoringRecord) => number,
) => {
  const totalWeight = selectedRecords.reduce((total, record) => total + weight(record), 0);
  if (!totalWeight) return 0;
  return Math.round(
    selectedRecords.reduce((total, record) => total + value(record) * weight(record), 0) /
      totalWeight,
  );
};

const composition = (
  selectedRecords: LandMonitoringRecord[],
  key: (record: LandMonitoringRecord) => string,
  weight: (record: LandMonitoringRecord) => number,
) => {
  const totals: Record<string, number> = {};
  selectedRecords.forEach((record) => {
    const id = key(record);
    totals[id] = (totals[id] ?? 0) + weight(record);
  });
  const grandTotal = Object.values(totals).reduce((total, value) => total + value, 0);
  return Object.fromEntries(
    Object.entries(totals).map(([id, value]) => [
      id,
      grandTotal ? Math.round((value / grandTotal) * 100) : 0,
    ]),
  );
};

const dominantId = (values: Record<string, number>) =>
  Object.entries(values).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

const descendants = (scopeId: string, type: Region["type"]) => {
  const result: Region[] = [];
  const visit = (parentId: string) => {
    regions
      .filter((region) => region.parentId === parentId)
      .forEach((region) => {
        if (region.type === type) result.push(region);
        visit(region.id);
      });
  };
  visit(scopeId);
  return result;
};

const recordsForRegion = (scopeId: string) => {
  const scope = regionById.get(scopeId);
  if (!scope) return [];
  if (scope.type === "village") {
    const record = recordByVillageId.get(scopeId);
    return record ? [record] : [];
  }
  const villageIds = new Set(descendants(scopeId, "village").map((village) => village.id));
  return records.filter((record) => villageIds.has(record.villageId));
};

export const landMonitoringContext = landMonitoringJson.context;
export const landMonitoringRecords = records;

export function getRegion(regionId: string) {
  return regionById.get(regionId) ?? null;
}

export function getRegionByName(name: string, type?: Region["type"]) {
  const normalized = name.trim().toLocaleLowerCase("id-ID");
  return (
    regions.find(
      (region) =>
        (!type || region.type === type) &&
        region.name.toLocaleLowerCase("id-ID") === normalized,
    ) ?? null
  );
}

export function getChildren(parentId: string, type?: Region["type"]) {
  return regions.filter(
    (region) => region.parentId === parentId && (!type || region.type === type),
  );
}

export function getDistrictForVillage(villageId: string) {
  const village = regionById.get(villageId);
  if (!village?.parentId) return null;
  const district = regionById.get(village.parentId);
  return district?.type === "district" ? district : null;
}

export function getLandRecord(villageId: string) {
  return recordByVillageId.get(villageId) ?? null;
}

export function getLandRecordsForRegion(scopeId: string) {
  return recordsForRegion(scopeId);
}

export function aggregateLand(scopeId: string): LandAggregate {
  const scope = regionById.get(scopeId);
  const selectedRecords = recordsForRegion(scopeId);
  const areas = emptyAreas();
  selectedRecords.forEach((record) => sumAreas(areas, record.areas));

  const districtIds = new Set(
    selectedRecords
      .map((record) => getDistrictForVillage(record.villageId)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const conditionComposition = composition(
    selectedRecords,
    (record) => record.condition.landStatusId,
    (record) => record.areas.activeHa,
  );
  const phaseComposition = composition(
    selectedRecords,
    (record) => record.phase.phaseId,
    (record) => record.areas.plantedHa,
  );
  const riskComposition = composition(
    selectedRecords,
    (record) => record.risk.riskLevelId,
    (record) => record.areas.activeHa,
  );

  return {
    scopeId,
    scopeName: scope?.name ?? scopeId,
    scopeLevel: (scope?.type ?? "village") as LandScopeLevel,
    recordCount: selectedRecords.length,
    districtCount: districtIds.size,
    villageCount: new Set(selectedRecords.map((record) => record.villageId)).size,
    areas,
    affectedAreaHa: selectedRecords.reduce(
      (total, record) => total + record.risk.affectedAreaHa,
      0,
    ),
    registeredFarmers: selectedRecords.reduce(
      (total, record) => total + record.participation.registeredFarmers,
      0,
    ),
    activeFarmers: selectedRecords.reduce(
      (total, record) => total + record.participation.activeFarmers,
      0,
    ),
    validationPercent: weightedPercent(
      selectedRecords,
      (record) => record.validation.validationPercent,
      (record) => record.areas.mappedHa,
    ),
    verifiedAreaPercent: areas.mappedHa
      ? Math.round((areas.verifiedHa / areas.mappedHa) * 100)
      : 0,
    conditionComposition,
    phaseComposition,
    riskComposition,
    dominantConditionId: dominantId(conditionComposition),
    dominantPhaseId: dominantId(phaseComposition),
    dominantRiskLevelId: dominantId(riskComposition),
    latestUpdate:
      selectedRecords
        .map((record) => record.audit.updatedAt)
        .sort()
        .at(-1) ?? null,
  };
}

export function getDistrictAggregates() {
  return getChildren(landMonitoringJson.context.regencyId, "district")
    .map((district) => aggregateLand(district.id))
    .filter((aggregate) => aggregate.recordCount > 0);
}

export function getVillageAggregates(districtId: string) {
  return getChildren(districtId, "village")
    .map((village) => aggregateLand(village.id))
    .filter((aggregate) => aggregate.recordCount > 0);
}

export function resolvePhase(phaseId: string | null) {
  return phaseId ? phaseById.get(phaseId) ?? null : null;
}

export function resolveLandStatus(statusId: string | null) {
  return statusId ? statusById.get(statusId) ?? null : null;
}

export function resolveRiskLevel(riskLevelId: string | null) {
  return riskLevelId ? riskById.get(riskLevelId) ?? null : null;
}

export function resolveThreat(threatId: string) {
  return threatById.get(threatId) ?? null;
}

export const papuaSelatanLandAggregate = aggregateLand(
  landMonitoringJson.context.provinceId,
);
export const meraukeLandAggregate = aggregateLand(
  landMonitoringJson.context.regencyId,
);
