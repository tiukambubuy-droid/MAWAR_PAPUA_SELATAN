export function RegionBreadcrumb({ district, village }: { district: string; village: string }) {
  return <div className="season-breadcrumb"><span>Papua Selatan</span><b>›</b><span>Kabupaten Merauke</span>{district !== "all" && <><b>›</b><strong>Distrik {district}</strong></>}{village !== "all" && <><b>›</b><strong>Kampung {village}</strong></>}</div>;
}
