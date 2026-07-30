import type { ProductionDistrict, ProductionGroup, ProductionRecord, ProductionVillage } from "@/types/production";
import sipangan from "@/data/sipangan.json";

const productionConfig = sipangan.production;

function seed(text: string) {
  return [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
}

function makeGroup(name: string, index: number): ProductionGroup {
  const value = seed(name) + index * 37;
  const config = productionConfig.generation;
  const harvested = config.harvestBase + value % config.harvestRange;
  const yieldRate = config.yieldBase + (value % config.yieldRange) / 100;
  const gkg = harvested * yieldRate;
  return {
    name: config.groupNames[index],
    harvested,
    yieldRate,
    target: Math.round(gkg / (0.84 + (value % 10) / 100)),
    validation: config.validationBase + value % config.validationRange,
    trend: config.trendFactors.map((factor, i) => Math.round(gkg * (factor + ((value + i) % 5) / 100))),
  };
}

export const productionDistricts: ProductionDistrict[] = productionConfig.districts.map(district => ({
  name: district.name,
  villages: district.villages.map(name => ({
    name,
    groups: Array.from({ length: 3 }, (_, index) => makeGroup(`${district.name}-${name}`, index)),
  })),
}));

function groupRecord(group: ProductionGroup, parent: string): ProductionRecord {
  const gkg = group.harvested * group.yieldRate;
  return {
    id: `${parent}-${group.name}`,
    name: group.name,
    level: "Kelompok Tani",
    harvested: group.harvested,
    yieldRate: group.yieldRate,
    gkg,
    rice: gkg * productionConfig.riceConversion,
    loss: gkg * productionConfig.lossRate,
    target: group.target,
    validation: group.validation,
    trend: group.trend,
  };
}

function sumRecords(name: string, level: ProductionRecord["level"], records: ProductionRecord[]): ProductionRecord {
  const harvested = records.reduce((sum, row) => sum + row.harvested, 0);
  const gkg = records.reduce((sum, row) => sum + row.gkg, 0);
  return {
    id: `${level}-${name}`,
    name,
    level,
    harvested,
    yieldRate: harvested ? gkg / harvested : 0,
    gkg,
    rice: records.reduce((sum, row) => sum + row.rice, 0),
    loss: records.reduce((sum, row) => sum + row.loss, 0),
    target: records.reduce((sum, row) => sum + row.target, 0),
    validation: Math.round(records.reduce((sum, row) => sum + row.validation, 0) / Math.max(1, records.length)),
    trend: [0, 1, 2, 3].map(index => records.reduce((sum, row) => sum + row.trend[index], 0)),
  };
}

export function recordsForScope(districtName: string, villageName: string) {
  if (districtName === "Semua Distrik") {
    return productionDistricts.map(district => {
      const groups = district.villages.flatMap(village => village.groups.map(group => groupRecord(group, `${district.name}-${village.name}`)));
      return sumRecords(district.name, "Distrik", groups);
    });
  }
  const district = productionDistricts.find(item => item.name === districtName) ?? productionDistricts[0];
  if (villageName === "Semua Kampung") {
    return district.villages.map(village => sumRecords(
      village.name,
      "Kampung",
      village.groups.map(group => groupRecord(group, `${district.name}-${village.name}`)),
    ));
  }
  const village = district.villages.find(item => item.name === villageName) ?? district.villages[0];
  return village.groups.map(group => groupRecord(group, `${district.name}-${village.name}`));
}

export function aggregateProduction(records: ProductionRecord[]) {
  return sumRecords("Total", records[0]?.level ?? "Distrik", records);
}

export function villagesForDistrict(districtName: string): ProductionVillage[] {
  return productionDistricts.find(item => item.name === districtName)?.villages ?? [];
}
