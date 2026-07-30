import {
  getDefaultSeasonSnapshot,
  getRegionById,
  getSeasonById,
  seasonSnapshots,
} from "@/lib/data-foundation";

export type DashboardFilterState = {
  seasonId: string;
  commodityId: string;
  provinceId: string;
  regencyId: string;
  districtId: string | null;
  villageId: string | null;
  snapshotId: string | null;
};

export const DASHBOARD_FILTER_STORAGE_KEY = "mawar-dashboard-filters-v1";
export const dashboardFilterParamNames = ["season", "commodity", "province", "regency", "district", "village", "snapshot"] as const;

export function defaultDashboardFilters(): DashboardFilterState {
  return {
    seasonId: "MT2-2026",
    commodityId: "PADI",
    provinceId: "93",
    regencyId: "93.01",
    districtId: null,
    villageId: null,
    snapshotId: getDefaultSeasonSnapshot("MT2-2026")?.id ?? null,
  };
}

export function normalizeDashboardFilters(
  candidate: Partial<DashboardFilterState>,
  base = defaultDashboardFilters(),
): DashboardFilterState {
  const seasonId = candidate.seasonId && getSeasonById(candidate.seasonId)
    ? candidate.seasonId
    : base.seasonId;
  const provinceId = getRegionById(candidate.provinceId ?? "")?.administrative_type === "province"
    ? candidate.provinceId!
    : base.provinceId;
  const regencyId = getRegionById(candidate.regencyId ?? "")?.administrative_type === "regency"
    ? candidate.regencyId!
    : base.regencyId;
  const district = getRegionById(candidate.districtId ?? "");
  const districtId = district?.administrative_type === "district" && district.parent_id === regencyId
    ? district.id
    : null;
  const village = getRegionById(candidate.villageId ?? "");
  const villageId = districtId &&
    (village?.administrative_type === "kampung" || village?.administrative_type === "kelurahan") &&
    village.parent_id === districtId
    ? village.id
    : null;
  const requestedSnapshot = seasonSnapshots.find(
    (snapshot) => snapshot.id === candidate.snapshotId && snapshot.season_id === seasonId && snapshot.kind === "actual",
  );
  return {
    seasonId,
    commodityId: candidate.commodityId === "PADI" ? "PADI" : base.commodityId,
    provinceId,
    regencyId,
    districtId,
    villageId,
    snapshotId: requestedSnapshot?.id ?? getDefaultSeasonSnapshot(seasonId)?.id ?? null,
  };
}

export const validateDashboardFilters = normalizeDashboardFilters;

export function parseDashboardFilterParams(params: URLSearchParams): Partial<DashboardFilterState> {
  return {
    seasonId: params.get("season") ?? undefined,
    commodityId: params.get("commodity") ?? undefined,
    provinceId: params.get("province") ?? undefined,
    regencyId: params.get("regency") ?? undefined,
    districtId: params.get("district"),
    villageId: params.get("village"),
    snapshotId: params.get("snapshot"),
  };
}

export function hasValidFilterParams(params: URLSearchParams) {
  const parsed = parseDashboardFilterParams(params);
  const normalized = normalizeDashboardFilters(parsed);
  return (
    (params.has("season") && parsed.seasonId === normalized.seasonId) ||
    (params.has("commodity") && parsed.commodityId === normalized.commodityId) ||
    (params.has("province") && parsed.provinceId === normalized.provinceId) ||
    (params.has("regency") && parsed.regencyId === normalized.regencyId) ||
    (params.has("district") && parsed.districtId === normalized.districtId) ||
    (params.has("village") && parsed.villageId === normalized.villageId) ||
    (params.has("snapshot") && parsed.snapshotId === normalized.snapshotId)
  );
}

export function resolveInitialDashboardFilters(
  params: URLSearchParams,
  sessionCandidate?: Partial<DashboardFilterState> | null,
) {
  const defaults = defaultDashboardFilters();
  const session = sessionCandidate ? normalizeDashboardFilters(sessionCandidate, defaults) : defaults;
  if (!hasValidFilterParams(params)) return session;

  const parsed = parseDashboardFilterParams(params);
  const validUrlBase = normalizeDashboardFilters(parsed, defaults);
  const explicitDistrict = params.has("district") && parsed.districtId === validUrlBase.districtId;
  const explicitVillage = params.has("village") && parsed.villageId === validUrlBase.villageId;
  return normalizeDashboardFilters({
    ...defaults,
    ...(params.has("season") && parsed.seasonId === validUrlBase.seasonId ? { seasonId: parsed.seasonId } : {}),
    ...(params.has("commodity") && parsed.commodityId === validUrlBase.commodityId ? { commodityId: parsed.commodityId } : {}),
    ...(params.has("province") && parsed.provinceId === validUrlBase.provinceId ? { provinceId: parsed.provinceId } : {}),
    ...(params.has("regency") && parsed.regencyId === validUrlBase.regencyId ? { regencyId: parsed.regencyId } : {}),
    ...(explicitDistrict ? { districtId: parsed.districtId } : {}),
    ...(explicitVillage ? { villageId: parsed.villageId } : {}),
    ...(params.has("snapshot") && parsed.snapshotId === validUrlBase.snapshotId ? { snapshotId: parsed.snapshotId } : {}),
  }, defaults);
}

export function serializeDashboardFilters(filters: DashboardFilterState) {
  const params = new URLSearchParams({
    season: filters.seasonId,
    commodity: filters.commodityId,
    province: filters.provinceId,
    regency: filters.regencyId,
  });
  if (filters.districtId) params.set("district", filters.districtId);
  if (filters.villageId) params.set("village", filters.villageId);
  if (filters.snapshotId) params.set("snapshot", filters.snapshotId);
  return params;
}

export function normalizeDashboardFilterUrl(filters: DashboardFilterState, pathname = "/", hash = "") {
  return `${pathname}?${serializeDashboardFilters(filters).toString()}${hash}`;
}

export type DashboardHistoryMode = "replace" | "push" | "popstate";
export function dashboardHistoryMethod(mode: DashboardHistoryMode) {
  return mode === "push" ? "pushState" : mode === "replace" ? "replaceState" : null;
}
