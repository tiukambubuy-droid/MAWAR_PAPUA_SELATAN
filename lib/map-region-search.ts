import type { Region } from "@/lib/data-foundation";

export type MapRegionOption = { id: string; name: string; typeLabel: "Kabupaten" | "Distrik" };
export const REGION_SEPARATOR = "\u2014";

export function formatMapRegionLabel(regionName: string, regionType: MapRegionOption["typeLabel"]) {
  return `${regionName} ${REGION_SEPARATOR} ${regionType}`;
}

export function createMapRegionOptions(regions: Region[]): MapRegionOption[] {
  const regency = regions.find(region => region.id === "93.01" && region.administrative_type === "regency");
  const districts = regions
    .filter(region => region.administrative_type === "district" && region.parent_id === "93.01")
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
  return [
    ...(regency ? [{ id: regency.id, name: regency.name, typeLabel: "Kabupaten" as const }] : []),
    ...districts.map(region => ({ id: region.id, name: region.name, typeLabel: "Distrik" as const })),
  ];
}

export function filterMapRegionOptions(options: MapRegionOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase("id-ID");
  return options.filter(option => !normalized || `${option.name} ${option.typeLabel}`.toLocaleLowerCase("id-ID").includes(normalized));
}

export function districtIdForMapRegion(option: MapRegionOption) {
  return option.typeLabel === "Kabupaten" ? null : option.id;
}
