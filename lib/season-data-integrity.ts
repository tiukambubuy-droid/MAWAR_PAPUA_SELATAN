export type SeasonFarmerParticipation = { targetFarmers: number; activeFarmers: number };
export type PhaseAreaRecord = { phase: string | null; planting_realization_ha: number; monitoring_status: string; validation_status: string };
export type SeasonRegion = { id: string; name: string; monitoring_status: string };
export type SeasonMonitoringRecord = PhaseAreaRecord & { season_id: string; region_id: string };
export type SeasonAggregate = { planting_target_ha: number; planting_realization_ha: number; validation_rate: number };

const seasonFarmerParticipation: Readonly<Record<string, SeasonFarmerParticipation>> = Object.freeze({
  "MT1-2026": Object.freeze({ targetFarmers: 2607, activeFarmers: 2341 }),
  "MT2-2026": Object.freeze({ targetFarmers: 3049, activeFarmers: 2545 }),
});

export function calculateActiveFarmerPercentage(activeFarmers: number | null, targetFarmers: number | null) {
  if (activeFarmers === null || targetFarmers === null || !Number.isFinite(activeFarmers) || !Number.isFinite(targetFarmers) || targetFarmers <= 0) return null;
  return activeFarmers / targetFarmers * 100;
}

export function getSeasonFarmerParticipation(seasonId: string, regionId: string): SeasonFarmerParticipation | null {
  if (regionId !== "93.01") return null;
  return seasonFarmerParticipation[seasonId] ?? null;
}

export function sumMonitoredPhaseArea(records: readonly PhaseAreaRecord[]) {
  return records.reduce((sum, record) =>
    record.monitoring_status === "active" &&
    record.validation_status === "approved" &&
    typeof record.phase === "string" &&
    Number.isFinite(record.planting_realization_ha)
      ? sum + record.planting_realization_ha
      : sum, 0);
}

export function monitoringRows<T extends SeasonRegion>({
  names, scopeKey, seasonId, regions, records, aggregateRegion,
}: {
  names: readonly string[];
  scopeKey: string;
  seasonId: string;
  regions: readonly T[];
  records: readonly SeasonMonitoringRecord[];
  aggregateRegion: (regionId: string, seasonId: string) => SeasonAggregate;
}) {
  return names.flatMap(name => {
    const region = regions.find(item => item.id === scopeKey && item.name === name) ?? regions.find(item => item.name === name);
    if (!region || region.monitoring_status !== "active") return [];
    const activeRecords = records.filter(item => item.season_id === seasonId && item.monitoring_status === "active" &&
      (item.region_id === region.id || item.region_id.startsWith(`${region.id}.`)));
    if (!activeRecords.length) return [];
    const phaseAreas = activeRecords.reduce((totals, item) => totals.set(item.phase, (totals.get(item.phase) ?? 0) + item.planting_realization_ha), new Map<string | null, number>());
    const phase = [...phaseAreas].filter((item): item is [string, number] => typeof item[0] === "string").sort((left, right) => right[1] - left[1])[0]?.[0];
    if (!phase) return [];
    return [{ id: region.id, name, phase, aggregate: aggregateRegion(region.id, seasonId), seasonId, monitoringStatus: "active" as const }];
  });
}
