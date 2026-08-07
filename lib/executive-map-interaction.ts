export type ExecutiveMapInteraction = {
  hoveredRegionId: string | null;
  focusedRegionId: string | null;
  selectedRegionId: string | null;
};

export function displayedExecutiveRegionId({ hoveredRegionId, focusedRegionId, selectedRegionId }: ExecutiveMapInteraction) {
  return hoveredRegionId ?? focusedRegionId ?? selectedRegionId ?? null;
}
