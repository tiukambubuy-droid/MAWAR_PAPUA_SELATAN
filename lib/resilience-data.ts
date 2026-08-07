import { aggregateRegion } from "@/lib/data-foundation";
import { foodAvailabilityScore, resilienceWeights, selectFoodSecurity } from "@/lib/food-security-data";
import { selectIrrigation, selectProductionInputs } from "@/lib/infrastructure-data";

export function selectOperationalResilience(seasonId: string, regionId = "93.01") {
  const food = selectFoodSecurity(seasonId, regionId);
  const irrigation = selectIrrigation(seasonId, regionId);
  const inputs = selectProductionInputs(seasonId, regionId);
  const production = aggregateRegion(regionId, seasonId);
  const components = {
    availability: foodAvailabilityScore(food.aggregate),
    productionAchievement: production.gkg_production_target_ton > 0 ? Math.max(0, Math.min(100, production.gkg_production_ton / production.gkg_production_target_ton * 100)) : null,
    irrigationReadiness: irrigation.aggregate?.functionalPct ?? null,
    productionInputFulfillment: inputs.aggregate?.averageFulfillmentPct ?? null,
    validation: food.aggregate && irrigation.aggregate && inputs.aggregate ? (food.aggregate.approved + irrigation.aggregate.approved + inputs.aggregate.approved) / (food.aggregate.total + irrigation.aggregate.total + inputs.aggregate.total) * 100 : null,
  };
  const complete = Object.values(components).every((value): value is number => value !== null && Number.isFinite(value));
  const score = complete ? components.availability! * resilienceWeights.availability + components.productionAchievement! * resilienceWeights.productionAchievement + components.irrigationReadiness! * resilienceWeights.irrigationReadiness + components.productionInputFulfillment! * resilienceWeights.productionInputFulfillment + components.validation! * resilienceWeights.validation : null;
  return { monitored: food.monitored && irrigation.monitored && inputs.monitored, complete, score, components };
}
