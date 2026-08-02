import {
  aggregateRegion,
  getRegionById,
  getRegionByName,
  seasonRecords,
  seasonSnapshots,
} from "@/lib/data-foundation";
import type { MonthObservation, MonitoringRow, PlantingPhase, PlantingSeason } from "@/types/planting-season";

export const phasePalette: Record<PlantingPhase, string> = {
  Persiapan: "#4B8FA8", Persemaian: "#B9DBA8", Vegetatif: "#55A977",
  Generatif: "#D9C954", Pematangan: "#DF963C", "Siap Panen": "#AD7927", Pascapanen: "#AAB7B0",
};

export const stableSeed = (value: string) =>
  [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 17);

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
    progress: Math.round(snapshot.planting_realization_ha / Math.max(1, season.target) * 100),
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
  return names.map((name) => {
    const region = getRegionById(scopeKey)?.name === name ? getRegionById(scopeKey) : getRegionByName(name);
    const aggregate = aggregateRegion(region?.id ?? scopeKey, seasonId);
    const record = seasonRecords.find(
      (item) => item.season_id === seasonId && item.region_id === region?.id,
    );
    return {
      id: region?.id ?? `${scopeKey}:${name}`,
      name,
      phase: (record?.phase ?? "Vegetatif") as PlantingPhase,
      target: aggregate.planting_target_ha,
      realized: aggregate.planting_realization_ha,
      validation: Math.round(aggregate.validation_rate),
      harvest: seasonId === "MT2-2026" ? "Agustus–September 2026" : "Selesai Maret 2026",
      farmers: Math.max(1, Math.round(aggregate.planting_realization_ha / 15)),
      groups: Math.max(1, Math.round(aggregate.planting_realization_ha / 220)),
      plantedAt: seasonId === "MT2-2026" ? "April–Juli 2026" : "Oktober 2025–Maret 2026",
      updatedAt: seasonId === "MT2-2026" ? "24 Juli 2026" : "31 Maret 2026",
      trend: [34, 45, 57, 69, 82, 91],
    };
  });
}

export function phaseComposition(scopeKey: string, seasonId = "MT2-2026") {
  const scope = getRegionById(scopeKey);
  const records = seasonRecords.filter((record) => {
    if (record.season_id !== seasonId || record.validation_status !== "approved") return false;
    if (scope?.administrative_type === "regency") return true;
    if (scope?.administrative_type === "district") return getRegionById(record.region_id)?.parent_id === scopeKey;
    return record.region_id === scopeKey;
  });
  const phases: PlantingPhase[] = ["Persemaian", "Vegetatif", "Generatif", "Pematangan", "Siap Panen"];
  const totals = new Map<PlantingPhase, number>(phases.map((phase) => [phase, 0]));
  records.forEach((record) => {
    const phase = phases.includes(record.phase as PlantingPhase) ? record.phase as PlantingPhase : "Vegetatif";
    totals.set(phase, (totals.get(phase) ?? 0) + record.planting_realization_ha);
  });
  const grandTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
  if (!grandTotal) return phases.map((phase, index) => ({ phase, value: index === 1 ? 100 : 0 }));
  const values = phases.map((phase) => ({ phase, value: (totals.get(phase) ?? 0) / grandTotal * 100 }));
  values[values.length - 1].value += 100 - values.reduce((sum, item) => sum + item.value, 0);
  return values;
}
