import { aggregateRegion, seasons } from "@/lib/data-foundation";
import type { PlantingSeason } from "@/types/planting-season";

export const plantingSeasons: PlantingSeason[] = seasons.map((season) => {
  const total = aggregateRegion("93.01", season.season_id);
  return {
    id: season.season_id,
    name: season.name,
    displayName: season.display_name,
    year: season.year,
    order: season.sequence,
    commodity: "Padi",
    commodityId: season.commodity_id,
    regencyId: season.regency_id,
    startDate: season.start_date,
    endDate: season.end_date,
    reportingCutoff: season.reporting_cutoff,
    status: season.status === "completed" ? "Selesai" : "Berjalan",
    target: total.planting_target_ha,
    realized: total.planting_realization_ha,
    production: total.gkg_production_ton,
  };
});
