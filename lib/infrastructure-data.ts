import irrigationJson from "@/data/monitoring/irrigation-monitoring.json";
import inputsJson from "@/data/monitoring/production-inputs-monitoring.json";
import { regions } from "@/lib/data-foundation";

export type IrrigationRecord = (typeof irrigationJson.records)[number];
export type ProductionInputRecord = (typeof inputsJson.records)[number];
export const irrigationMetadata = irrigationJson.metadata;
export const productionInputMetadata = inputsJson.metadata;
export const irrigationRecords = irrigationJson.records as IrrigationRecord[];
export const productionInputRecords = inputsJson.records as ProductionInputRecord[];
export const equipmentCategories = new Set(["Traktor", "Combine Harvester", "Pompa Air"]);

const scopeIds = (regionId: string) => regionId === "93.01"
  ? new Set(regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district").map(region => region.id))
  : new Set([regionId]);
const valid = (value: number) => Number.isFinite(value) && value >= 0;

export function irrigationConditionValid(record: IrrigationRecord, tolerance = irrigationMetadata.rounding_tolerance_km) {
  return [record.network_length_km, record.good_condition_km, record.light_damage_km, record.heavy_damage_km].every(valid) &&
    Math.abs(record.good_condition_km + record.light_damage_km + record.heavy_damage_km - record.network_length_km) <= tolerance;
}

export function selectIrrigation(seasonId: string, regionId = "93.01") {
  const ids = scopeIds(regionId);
  const items = irrigationRecords.filter(record => record.season_id === seasonId && ids.has(record.region_id) && record.monitoring_status === "monitored" && irrigationConditionValid(record));
  if (!items.length) return { monitored: false, items: [], aggregate: null };
  const sum = (field: "network_length_km"|"service_area_ha"|"good_condition_km"|"light_damage_km"|"heavy_damage_km") => items.reduce((total, item) => total + item[field], 0);
  const weighted = (field: "water_adequacy_pct"|"functional_pct") => items.reduce((total, item) => total + item[field] * item.service_area_ha, 0) / Math.max(1, sum("service_area_ha"));
  return { monitored: true, items, aggregate: { networkLengthKm: sum("network_length_km"), serviceAreaHa: sum("service_area_ha"), goodKm: sum("good_condition_km"), lightDamageKm: sum("light_damage_km"), heavyDamageKm: sum("heavy_damage_km"), waterAdequacyPct: weighted("water_adequacy_pct"), functionalPct: weighted("functional_pct"), approved: items.filter(item => item.validation_status === "approved").length, total: items.length } };
}

export function inputRecordValid(record: ProductionInputRecord) {
  const quantities = [record.required_quantity, record.available_quantity, record.distributed_quantity, record.ready_quantity, record.light_damage_quantity, record.heavy_damage_quantity];
  if (!quantities.every(valid) || record.distributed_quantity > record.available_quantity) return false;
  return !equipmentCategories.has(record.category) || record.ready_quantity + record.light_damage_quantity + record.heavy_damage_quantity <= record.available_quantity;
}

export function inputFulfillment(record: ProductionInputRecord) {
  if (!inputRecordValid(record) || record.required_quantity <= 0) return null;
  const rawPct = record.available_quantity / record.required_quantity * 100;
  return { presentationPct: Math.min(100, rawPct), excessQuantity: Math.max(0, record.available_quantity - record.required_quantity) };
}

export function selectProductionInputs(seasonId: string, regionId = "93.01", category = "all") {
  const ids = scopeIds(regionId);
  const items = productionInputRecords.filter(record => record.season_id === seasonId && ids.has(record.region_id) && record.monitoring_status === "monitored" && inputRecordValid(record) && (category === "all" || record.category === category));
  if (!items.length) return { monitored: false, items: [], aggregate: null };
  const categories = [...new Set(items.map(item => item.category))];
  const categoryScores = categories.map(name => {
    const values = items.filter(item => item.category === name).map(inputFulfillment).filter((value): value is NonNullable<ReturnType<typeof inputFulfillment>> => value !== null);
    return values.reduce((sum, value) => sum + value.presentationPct, 0) / Math.max(1, values.length);
  });
  const equipment = items.filter(item => equipmentCategories.has(item.category));
  return { monitored: true, items, aggregate: { categoryCount: categories.length, fulfilledCategories: categoryScores.filter(score => score >= 100).length, averageFulfillmentPct: categoryScores.reduce((sum, score) => sum + score, 0) / Math.max(1, categoryScores.length), equipmentReady: equipment.reduce((sum, item) => sum + item.ready_quantity, 0), equipmentNeedsRepair: equipment.reduce((sum, item) => sum + item.light_damage_quantity + item.heavy_damage_quantity, 0), shortageRegions: new Set(items.filter(item => (inputFulfillment(item)?.presentationPct ?? 0) < 100).map(item => item.region_id)).size, approved: items.filter(item => item.validation_status === "approved").length, total: items.length } };
}

export function formatInfrastructureValue(value: number | null, unit: string) {
  return value === null || !Number.isFinite(value) ? "Belum tersedia" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${unit}`;
}
