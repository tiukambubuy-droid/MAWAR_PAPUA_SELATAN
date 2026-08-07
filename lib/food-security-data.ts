import foodSecurityJson from "@/data/monitoring/food-security-monitoring.json";
import { aggregateRegion, getSeasonById, millingYield, regions } from "@/lib/data-foundation";

export type FoodSecurityRecord = (typeof foodSecurityJson.records)[number];
export type FoodSecurityMetrics = {
  record: FoodSecurityRecord;
  physicalStockTon: number;
  estimatedRiceProductionTon: number;
  annualNeedTon: number;
  seasonNeedTon: number;
  balanceAvailabilityTon: number;
  surplusDeficitTon: number;
  dailyNeedTon: number | null;
  stockResilienceDays: number | null;
};

export const foodSecurityMetadata = foodSecurityJson.metadata;
export const foodSecurityRecords = foodSecurityJson.records as FoodSecurityRecord[];
export const resilienceWeights = {
  availability: 0.30,
  productionAchievement: 0.25,
  irrigationReadiness: 0.20,
  productionInputFulfillment: 0.15,
  validation: 0.10,
} as const;
export const resilienceDisclaimer = "Simulasi Prototipe — bukan IKP resmi Badan Pangan Nasional";

const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
const durationDays = (seasonId: string) => {
  const season = getSeasonById(seasonId);
  if (!season) return null;
  const days = Math.floor((Date.parse(season.end_date) - Date.parse(season.start_date)) / 86400000) + 1;
  return Number.isFinite(days) && days > 0 ? days : null;
};

export function calculateFoodSecurity(record: FoodSecurityRecord): FoodSecurityMetrics | null {
  const required = [record.population, record.annual_consumption_kg_per_capita, record.bulog_stock_ton, record.government_reserve_ton, record.local_warehouse_stock_ton, record.inbound_supply_ton, record.outbound_supply_ton, record.operational_loss_ton];
  const days = durationDays(record.season_id);
  if (record.monitoring_status !== "monitored" || !required.every(finiteNonNegative) || !days) return null;
  const production = aggregateRegion(record.region_id, record.season_id);
  const physicalStockTon = record.bulog_stock_ton + record.government_reserve_ton + record.local_warehouse_stock_ton;
  const estimatedRiceProductionTon = production.gkg_production_ton * (millingYield.rate / 100);
  const annualNeedTon = record.population * record.annual_consumption_kg_per_capita / 1000;
  const seasonNeedTon = annualNeedTon * days / 365;
  const balanceAvailabilityTon = physicalStockTon + estimatedRiceProductionTon + record.inbound_supply_ton - record.outbound_supply_ton - record.operational_loss_ton;
  const dailyNeedTon = annualNeedTon > 0 ? annualNeedTon / 365 : null;
  return {
    record, physicalStockTon, estimatedRiceProductionTon, annualNeedTon, seasonNeedTon,
    balanceAvailabilityTon, surplusDeficitTon: balanceAvailabilityTon - seasonNeedTon,
    dailyNeedTon, stockResilienceDays: dailyNeedTon ? physicalStockTon / dailyNeedTon : null,
  };
}

export function selectFoodSecurity(seasonId: string, regionId = "93.01", validation = "all") {
  const districtIds = regionId === "93.01"
    ? new Set(regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district").map(region => region.id))
    : new Set([regionId]);
  const records = foodSecurityRecords.filter(record => record.season_id === seasonId && districtIds.has(record.region_id) && (validation === "all" || record.validation_status === validation));
  const items = records.map(calculateFoodSecurity).filter((item): item is FoodSecurityMetrics => item !== null);
  if (!items.length) return { monitored: false, items: [], aggregate: null };
  const total = (field: keyof Omit<FoodSecurityMetrics, "record">) => items.reduce((sum, item) => sum + (typeof item[field] === "number" ? item[field] : 0), 0);
  const annualNeedTon = total("annualNeedTon");
  const physicalStockTon = total("physicalStockTon");
  const aggregate = {
    physicalStockTon,
    estimatedRiceProductionTon: total("estimatedRiceProductionTon"),
    annualNeedTon,
    seasonNeedTon: total("seasonNeedTon"),
    balanceAvailabilityTon: total("balanceAvailabilityTon"),
    surplusDeficitTon: total("surplusDeficitTon"),
    stockResilienceDays: annualNeedTon > 0 ? physicalStockTon / (annualNeedTon / 365) : null,
    approved: records.filter(record => record.validation_status === "approved").length,
    total: records.length,
  };
  return { monitored: true, items, aggregate };
}

export function foodAvailabilityScore(metrics: ReturnType<typeof selectFoodSecurity>["aggregate"]) {
  if (!metrics || metrics.seasonNeedTon <= 0) return null;
  return Math.max(0, Math.min(100, metrics.balanceAvailabilityTon / metrics.seasonNeedTon * 100));
}

export function formatFoodValue(value: number | null, unit: "ton" | "hari" | "%" = "ton") {
  return value === null || !Number.isFinite(value) ? "Belum tersedia" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${unit}`;
}
