import { aggregateRegion, calculateEstimatedRice, millingYield } from "@/lib/data-foundation";
import { foodAvailabilityScore, resilienceWeights, selectFoodSecurity } from "@/lib/food-security-data";
import { selectIrrigation, selectProductionInputs } from "@/lib/infrastructure-data";

export type ResilienceComponents = {
  availability: number | null;
  productionAchievement: number | null;
  irrigationReadiness: number | null;
  productionInputFulfillment: number | null;
  validation: number | null;
};

export const resilienceFormulaMetadata = {
  availability: "Kebutuhan periode terpenuhi = min(100, ketersediaan neraca ÷ kebutuhan periode × 100). Nilai 100% berarti kebutuhan terpenuhi atau terlampaui.",
  production: "Capaian produksi = produksi GKG ÷ target produksi GKG × 100.",
  irrigation: "Kesiapan irigasi menggunakan rata-rata tingkat fungsional jaringan berbobot luas layanan. Kecukupan air ditampilkan sebagai indikator operasional terpisah.",
  inputs: "Pemenuhan sarana menggunakan rata-rata persentase pemenuhan per kategori; kg, liter, dan unit tidak dijumlahkan.",
  validation: "Validasi data = record disetujui ÷ seluruh record terpantau × 100.",
} as const;

export function productionAchievementScore(productionTon: number, targetTon: number) {
  return Number.isFinite(productionTon) && productionTon >= 0 && Number.isFinite(targetTon) && targetTon > 0
    ? productionTon / targetTon * 100
    : null;
}

export function calculateResilienceScore(components: ResilienceComponents) {
  const values = Object.values(components);
  if (!values.every((value): value is number => value !== null && Number.isFinite(value) && value >= 0 && value <= 100)) return null;
  return components.availability! * resilienceWeights.availability +
    components.productionAchievement! * resilienceWeights.productionAchievement +
    components.irrigationReadiness! * resilienceWeights.irrigationReadiness +
    components.productionInputFulfillment! * resilienceWeights.productionInputFulfillment +
    components.validation! * resilienceWeights.validation;
}

export function selectOperationalResilience(seasonId: string, regionId = "93.01") {
  const food = selectFoodSecurity(seasonId, regionId);
  const irrigation = selectIrrigation(seasonId, regionId);
  const inputs = selectProductionInputs(seasonId, regionId);
  const production = aggregateRegion(regionId, seasonId);
  const components: ResilienceComponents = {
    availability: foodAvailabilityScore(food.aggregate),
    productionAchievement: productionAchievementScore(production.gkg_production_ton, production.gkg_production_target_ton),
    irrigationReadiness: irrigation.aggregate?.functionalPct ?? null,
    productionInputFulfillment: inputs.aggregate?.averageFulfillmentPct ?? null,
    validation: food.aggregate && irrigation.aggregate && inputs.aggregate ? (food.aggregate.approved + irrigation.aggregate.approved + inputs.aggregate.approved) / (food.aggregate.total + irrigation.aggregate.total + inputs.aggregate.total) * 100 : null,
  };
  const score = calculateResilienceScore(components);
  return {
    seasonId, regionId,
    monitored: food.monitored && irrigation.monitored && inputs.monitored,
    complete: score !== null,
    score,
    components,
    production: {
      gkgProductionTon: production.gkg_production_ton,
      gkgTargetTon: production.gkg_production_target_ton,
      estimatedRiceTon: calculateEstimatedRice(production.gkg_production_ton),
      millingYieldPct: millingYield.rate,
    },
    food: food.aggregate,
    irrigation: irrigation.aggregate,
    productionInputs: inputs.aggregate,
  };
}
