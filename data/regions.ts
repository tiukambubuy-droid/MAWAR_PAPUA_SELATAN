import type { RegionNode } from "@/types/planting-season";
import sipangan from "@/data/sipangan.json";

export const regions: RegionNode[] = [
  { id: "merauke", name: "Merauke", type: "regency" },
  ...sipangan.regions.districts.map(item => ({ id: item.id, name: item.name, type: "district" as const, parentId: "merauke" })),
  ...sipangan.regions.districts.flatMap(item => item.villages.map((name, i) => ({ id: `${item.id}-v${i + 1}`, name, type: "village" as const, parentId: item.id }))),
];

export const fieldsForVillage = (villageId: string): RegionNode[] =>
  sipangan.regions.fieldNames
    .map((name, i) => ({ id: `${villageId}-f${i + 1}`, name, type: "field", parentId: villageId }));
