import { getChildrenByRegionId, regions as masterRegions } from "@/lib/data-foundation";
import type { RegionNode } from "@/types/planting-season";

export const regions: RegionNode[] = masterRegions
  .filter((region) => region.id === "93.01" || region.parent_id === "93.01" || region.monitoring_status === "active")
  .map((region) => ({
    id: region.id,
    name: region.name,
    type:
      region.administrative_type === "regency"
        ? "regency"
        : region.administrative_type === "district"
          ? "district"
          : "village",
    parentId: region.parent_id === "93.01" ? "merauke" : region.parent_id ?? undefined,
    administrativeType:
      region.administrative_type === "kampung" || region.administrative_type === "kelurahan"
        ? region.administrative_type
        : undefined,
  }));

export function fieldsForVillage(villageId: string): RegionNode[] {
  const village = masterRegions.find((region) => region.id === villageId);
  if (!village) return [];
  return [
    {
      id: `${village.id}:record`,
      name: village.name,
      type: "field",
      parentId: village.id,
      administrativeType: village.administrative_type === "kelurahan" ? "kelurahan" : "kampung",
    },
  ];
}

export const monitoredDistricts = getChildrenByRegionId("93.01").filter(
  (region) => region.administrative_type === "district" && region.monitoring_status === "active",
);
