import { futureTargetsAndProjections, getSeasonById, seasonSnapshots } from "@/lib/data-foundation";

export type ChartDataPoint = {
  id: string; period: string; label: string; stageIndex: number;
  target: number | null; actual: number | null; projection: number | null;
  status: "actual" | "target" | "projection" | "not_available";
  isCutoff: boolean;
};

const stagePeriods: Record<string, string[]> = {
  "MT1-2026": ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"],
  "MT2-2026": ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
};
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (period: string) => `${monthLabels[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

export function getChartDataPoints(seasonId: string, metric: "planting_realization_ha" | "gkg_production_ton", targetTotal: number, scale = 1): ChartDataPoint[] {
  const cutoff = getSeasonById(seasonId)?.reporting_cutoff.slice(0, 7);
  return (stagePeriods[seasonId] ?? []).map((period, index) => {
    const actualRow = seasonSnapshots.find(row => row.season_id === seasonId && row.period === period && row.kind === "actual");
    const projectionRow = futureTargetsAndProjections.find(row => row.season_id === seasonId && row.period === period && row.kind === "projection");
    const afterCutoff = Boolean(cutoff && period > cutoff);
    const actual = !afterCutoff && actualRow ? Number(actualRow[metric] ?? 0) * scale : null;
    const projection = afterCutoff && projectionRow
      ? Number(metric === "gkg_production_ton" ? projectionRow.gkg_production_ton : projectionRow.planting_target_ha ?? targetTotal) * scale
      : null;
    return {
      id: `${seasonId}:${period}`, period, label: monthLabel(period), stageIndex: index + 1,
      target: targetTotal * ((index + 1) / 6) * scale, actual, projection,
      status: actual !== null ? "actual" : projection !== null ? "projection" : afterCutoff ? "target" : "not_available",
      isCutoff: period === cutoff,
    };
  });
}

export function getComparableStageSnapshot(seasonId: string, stageIndex: number) {
  const period = stagePeriods[seasonId]?.[stageIndex - 1];
  return seasonSnapshots.find(row => row.season_id === seasonId && row.period === period && row.kind === "actual") ?? null;
}

export function compareActualAtEquivalentStage(leftSeasonId: string, rightSeasonId: string, stageIndex: number, metric: "planting_realization_ha" | "gkg_production_ton") {
  const left = getComparableStageSnapshot(leftSeasonId, stageIndex);
  const right = getComparableStageSnapshot(rightSeasonId, stageIndex);
  return left && right ? { left: Number(left[metric] ?? 0), right: Number(right[metric] ?? 0), stageIndex } : null;
}

export function compareProjectedFinalToCompletedSeason() {
  const actual = getComparableStageSnapshot("MT1-2026", 6);
  const projection = futureTargetsAndProjections.filter(row => row.season_id === "MT2-2026" && row.kind === "projection").sort((a, b) => a.period.localeCompare(b.period)).at(-1);
  return actual && projection ? { actual: Number(actual.gkg_production_ton ?? 0), projection: Number(projection.gkg_production_ton ?? 0) } : null;
}
