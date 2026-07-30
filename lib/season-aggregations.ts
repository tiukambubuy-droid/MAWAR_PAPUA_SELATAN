import type { MonthObservation, MonitoringRow, PlantingPhase, PlantingSeason } from "@/types/planting-season";

export const phasePalette: Record<PlantingPhase, string> = {
  Persiapan: "#4B8FA8", Persemaian: "#B9DBA8", Vegetatif: "#55A977",
  Generatif: "#D9C954", Pematangan: "#DF963C", "Siap Panen": "#AD7927", Pascapanen: "#AAB7B0",
};

export const stableSeed = (value: string) => [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);

export function seasonMonths(season: PlantingSeason, scopeKey: string): MonthObservation[] {
  const start = new Date(`${season.startDate}T00:00:00`);
  const end = new Date(`${season.endDate}T00:00:00`);
  const months: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const activities: PlantingPhase[] = ["Persiapan", "Persemaian", "Vegetatif", "Generatif", "Pematangan", "Siap Panen", "Pascapanen"];
  const scale = Math.max(.05, Math.min(1, (stableSeed(scopeKey) % 52 + 48) / 100));
  return months.map((date, index) => {
    const ratio = (index + 1) / months.length;
    const target = Math.round(season.target * scale * ratio);
    const progressRatio = season.status === "Selesai" ? .96 : season.status === "Berjalan" ? Math.min(.93, ratio * 1.18) : ratio * .08;
    const realized = Math.round(target * progressRatio);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString("id-ID", { month: "short" }).replace(".", ""),
      year: date.getFullYear(),
      activity: activities[Math.min(index, activities.length - 1)],
      progress: Math.round(progressRatio * 100),
      focus: index < 2 ? "Percepatan persiapan dan tanam" : index < 4 ? "Pemantauan pertumbuhan dan kebutuhan air" : index < 6 ? "Puncak panen awal di Kurik dan Tanah Miring" : "Pascapanen dan evaluasi hasil",
      target, realized, projected: Math.round(target * Math.min(1, progressRatio + .14)),
      validation: 82 + (stableSeed(scopeKey + index) % 15),
    };
  });
}

export function monitoringRows(names: string[], scopeKey: string): MonitoringRow[] {
  const phases: PlantingPhase[] = ["Vegetatif", "Generatif", "Pematangan", "Siap Panen", "Persemaian"];
  return names.map((name, index) => {
    const seed = stableSeed(`${scopeKey}-${name}`);
    const target = 320 + seed % 720;
    const realized = Math.round(target * (.72 + (seed % 24) / 100));
    return {
      id: `${scopeKey}-${name}`, name, phase: phases[seed % phases.length], target, realized,
      validation: 78 + seed % 20,
      harvest: index < 4
        ? `${28 + index} Jul – ${5 + index} Agu 2026`
        : `${1 + (index - 4)} Agu – ${9 + (index - 4)} Agu 2026`,
      farmers: 30 + seed % 120, groups: 2 + seed % 8, plantedAt: `${4 + index} Mei 2026`,
      updatedAt: `${1 + index} jam lalu`, trend: [34, 45, 41, 57, 54, 69, 65, 82].map(v => Math.min(98, v + seed % 11)),
    };
  });
}

export function phaseComposition(scopeKey: string, monthIndex: number) {
  const base = [7, 38, 25, 18, 12];
  const shift = (stableSeed(scopeKey) + monthIndex) % base.length;
  const labels: PlantingPhase[] = ["Persemaian", "Vegetatif", "Generatif", "Pematangan", "Siap Panen"];
  return labels.map((phase, i) => ({ phase, value: base[(i + shift) % base.length] }));
}
