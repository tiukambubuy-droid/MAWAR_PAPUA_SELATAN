import {
  aggregateRegion,
  getRegionById,
  regions,
  seasonRecords,
  seasonSnapshots,
} from "@/lib/data-foundation";
import type { MonthObservation, MonitoringRow, PlantingPhase, PlantingSeason } from "@/types/planting-season";
export { calculateActiveFarmerPercentage, getSeasonFarmerParticipation } from "@/lib/season-data-integrity";
import { monitoringRows as selectMonitoringRows } from "@/lib/season-data-integrity";

export const phasePalette: Record<PlantingPhase, string> = {
  Persiapan: "#4B8FA8", Persemaian: "#B9DBA8", Vegetatif: "#55A977",
  Generatif: "#D9C954", Pematangan: "#DF963C", "Siap Panen": "#AD7927", Pascapanen: "#AAB7B0",
};

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00`).toLocaleDateString("id-ID", { month: "short" }).replace(".", "");

export function seasonMonths(season: PlantingSeason, scopeKey: string): MonthObservation[] {
  void scopeKey;
  const rows = seasonSnapshots.filter((snapshot) => snapshot.season_id === season.id && snapshot.kind === "actual");
  const activities: PlantingPhase[] =
    season.status === "Selesai"
      ? ["Persiapan", "Persemaian", "Vegetatif", "Generatif", "Pematangan", "Pascapanen"]
      : ["Persiapan", "Vegetatif", "Generatif", "Pematangan"];
  return rows.map((snapshot, index) => ({
    key: snapshot.period,
    label: monthLabel(snapshot.period),
    year: Number(snapshot.period.slice(0, 4)),
    activity: activities[Math.min(index, activities.length - 1)],
    progress: season.target > 0 ? Math.round(snapshot.planting_realization_ha / season.target * 100) : 0,
    focus: index < 2
      ? "Percepatan persiapan dan tanam"
      : index < rows.length - 1
        ? "Pemantauan pertumbuhan, panen, dan kebutuhan air"
        : season.status === "Selesai"
          ? "Pascapanen dan evaluasi hasil"
          : "Realisasi sampai batas pelaporan",
    target: season.target,
    realized: snapshot.planting_realization_ha,
    projected: snapshot.planting_realization_ha,
    validation: season.status === "Selesai" ? 93 : 91,
  }));
}

export function monitoringRows(names: string[], scopeKey: string, seasonId = "MT2-2026"): MonitoringRow[] {
  return selectMonitoringRows({ names, scopeKey, seasonId, regions, records: seasonRecords, aggregateRegion }).flatMap(row => {
    if (!(row.phase in phasePalette)) return [];
    return [{
      id: row.id,
      name: row.name,
      phase: row.phase as PlantingPhase,
      target: row.aggregate.planting_target_ha,
      realized: row.aggregate.planting_realization_ha,
      validation: Math.round(row.aggregate.validation_rate),
      harvest: seasonId === "MT2-2026" ? "Agustus–September 2026" : "Selesai Maret 2026",
      farmers: null,
      groups: null,
      monitoringStatus: "active" as const,
      plantedAt: seasonId === "MT2-2026" ? "April–Juli 2026" : "Oktober 2025–Maret 2026",
      updatedAt: seasonId === "MT2-2026" ? "24 Juli 2026" : "31 Maret 2026",
      trend: [34, 45, 57, 69, 82, 91],
    }];
  });
}

export function phaseComposition(scopeKey: string, seasonId = "MT2-2026") {
  const scope = getRegionById(scopeKey);
  const records = seasonRecords.filter((record) => {
    if (record.season_id !== seasonId || record.monitoring_status !== "active" || record.validation_status !== "approved") return false;
    if (scope?.administrative_type === "regency") return true;
    if (scope?.administrative_type === "district") return getRegionById(record.region_id)?.parent_id === scopeKey;
    return record.region_id === scopeKey;
  });
  const phases: PlantingPhase[] = ["Persiapan", "Persemaian", "Vegetatif", "Generatif", "Pematangan", "Siap Panen", "Pascapanen"];
  const totals = new Map<PlantingPhase, number>(phases.map((phase) => [phase, 0]));
  records.forEach((record) => {
    if (!phases.includes(record.phase as PlantingPhase)) return;
    const phase = record.phase as PlantingPhase;
    totals.set(phase, (totals.get(phase) ?? 0) + record.planting_realization_ha);
  });
  const grandTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (!grandTotal) return phases.map((phase) => ({ phase, value: 0 }));
  const values = phases.map((phase) => ({ phase, value: (totals.get(phase) ?? 0) / grandTotal * 100 }));
  values[values.length - 1].value += 100 - values.reduce((sum, item) => sum + item.value, 0);
  return values;
}
