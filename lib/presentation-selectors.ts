export type PresentationDataState =
  | "verified_zero"
  | "available"
  | "not_monitored"
  | "not_available"
  | "loading"
  | "error";

export type CompositionItem = {
  id: string;
  label: string;
  area: number | null;
  color: string;
  monitoringStatus?: "active" | "not_monitored" | "not_available";
};

export type DominantPhase = {
  phaseId: string | null;
  label: string;
  areaHa: number | null;
  percentage: number | null;
  color: string | null;
  monitoringStatus: PresentationDataState;
};

export type DominantRisk = {
  riskLevel: string | null;
  label: string;
  affectedAreaHa: number | null;
  percentage: number | null;
  color: string | null;
  monitoredLocationCount: number;
  monitoringStatus: PresentationDataState;
};

const roundOne = (value: number) => Math.round(value * 10) / 10;

function dominantComposition(items: CompositionItem[]) {
  if (items.some(item => item.monitoringStatus === "not_monitored")) return { state: "not_monitored" as const, total: null, item: null };
  const available = items.filter((item): item is CompositionItem & { area: number } => typeof item.area === "number" && Number.isFinite(item.area));
  if (!available.length) return { state: "not_available" as const, total: null, item: null };
  const total = available.reduce((sum, item) => sum + Math.max(0, item.area), 0);
  if (total === 0) return { state: "verified_zero" as const, total, item: available[0] };
  const item = available.reduce((best, candidate) => candidate.area > best.area ? candidate : best);
  return { state: "available" as const, total, item };
}

export function getDominantPhase(items: CompositionItem[]): DominantPhase {
  const result = dominantComposition(items);
  if (!result.item || result.total === null) return { phaseId: null, label: result.state === "not_monitored" ? "Belum dipantau" : "Belum tersedia", areaHa: null, percentage: null, color: null, monitoringStatus: result.state };
  return {
    phaseId: result.item.id,
    label: result.item.label,
    areaHa: result.item.area,
    percentage: result.total ? roundOne(result.item.area / result.total * 100) : 0,
    color: result.item.color,
    monitoringStatus: result.state,
  };
}

export function getDominantRisk(items: CompositionItem[], monitoredLocationCount = 0): DominantRisk {
  const result = dominantComposition(items);
  if (!result.item || result.total === null) return { riskLevel: null, label: result.state === "not_monitored" ? "Belum dipantau" : "Belum tersedia", affectedAreaHa: null, percentage: null, color: null, monitoredLocationCount, monitoringStatus: result.state };
  return {
    riskLevel: result.item.id,
    label: result.item.label,
    affectedAreaHa: result.item.area,
    percentage: result.total ? roundOne(result.item.area / result.total * 100) : 0,
    color: result.item.color,
    monitoredLocationCount,
    monitoringStatus: result.state,
  };
}

export function getPhaseMonthlyChange(current: { label: string; value: number } | null, previous: { label: string; value: number } | null, previousPeriod?: string) {
  if (!current || !previous) return { deltaPoints: null, direction: "unavailable" as const, text: "Data pembanding bulan sebelumnya belum tersedia" };
  const deltaPoints = roundOne(current.value - previous.value);
  if (deltaPoints === 0) return { deltaPoints, direction: "same" as const, text: `${current.label} tetap pada ${roundOne(current.value).toLocaleString("id-ID")}%` };
  const direction = deltaPoints > 0 ? "up" as const : "down" as const;
  const verb = deltaPoints > 0 ? "naik" : "turun";
  const suffix = previousPeriod ? ` dibanding ${previousPeriod}` : "";
  return { deltaPoints, direction, text: `${current.label} ${verb} ${Math.abs(deltaPoints).toLocaleString("id-ID")} poin persentase${suffix}` };
}

export function getValidationSummary(records: { monitoringStatus: string; validation: number | null | undefined; placeholder?: boolean; validationStatus?: string; projection?: boolean }[]) {
  const included = records.filter(record => record.monitoringStatus === "active" && !record.placeholder && !record.projection && record.validationStatus !== "rejected" && typeof record.validation === "number" && Number.isFinite(record.validation));
  return {
    averageValidation: included.length ? roundOne(included.reduce((sum, record) => sum + (record.validation ?? 0), 0) / included.length) : null,
    includedRecordCount: included.length,
    excludedRecordCount: records.length - included.length,
    calculationScope: included.length ? `Rata-rata dari ${included.length} wilayah terpantau` : "Belum tersedia",
  };
}

export function formatPresentationValue(value: number | null | undefined, unit = "", state: PresentationDataState = value === null || value === undefined ? "not_available" : "available") {
  if (state === "not_monitored") return "Belum dipantau";
  if (state === "not_available" || value === null || value === undefined || !Number.isFinite(value)) return "Belum tersedia";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`;
}

export type LandMetricDefinition = {
  id: "administrative_area" | "mapped_land" | "active_land" | "target_planted_area" | "realized_planted_area" | "harvested_area";
  label: string;
  description: string;
  valueHa: number | null;
  sourceField: string;
  dataStatus: PresentationDataState;
};

const landMetricMeta = {
  administrative_area: ["Luas wilayah administrasi", "Luas keseluruhan batas administrasi.", "administrative_area_ha"],
  mapped_land: ["Luas lahan terpetakan", "Luas sawah atau lahan pertanian yang sudah dipetakan.", "mapped_land_ha"],
  active_land: ["Lahan aktif MT", "Lahan yang aktif dalam musim tanam terpilih.", "active_land_ha"],
  target_planted_area: ["Target luas tanam", "Target tanam musim aktif.", "planting_target_ha"],
  realized_planted_area: ["Realisasi luas tanam", "Luas yang sudah ditanami.", "planting_realization_ha"],
  harvested_area: ["Luas panen", "Luas yang telah dipanen.", "harvested_area_ha"],
} as const;

export function defineLandMetric(id: LandMetricDefinition["id"], valueHa: number | null, dataStatus: PresentationDataState = valueHa === null ? "not_available" : "available"): LandMetricDefinition {
  const [label, description, sourceField] = landMetricMeta[id];
  return { id, label, description, valueHa, sourceField, dataStatus };
}

export function resolveTableRegionNames(level: "province" | "district", selectedDistrictName: string, canonicalDistrictNames: string[], selectedSettlementNames: string[]) {
  if (level === "province") return ["Merauke"];
  return selectedDistrictName ? selectedSettlementNames : canonicalDistrictNames;
}
