import type { MonitoringRow, MonthObservation } from "@/types/planting-season";

export function buildSeasonInsights(rows: MonitoringRow[], month: MonthObservation, scope: string) {
  const lagging = [...rows].sort((a, b) => a.realized / a.target - b.realized / b.target)[0];
  const strongest = [...rows].sort((a, b) => b.realized / b.target - a.realized / a.target)[0];
  return [
    `${month.progress}% target kumulatif telah terealisasi pada ${scope}.`,
    `${month.focus}.`,
    `${lagging?.name ?? scope} perlu percepatan pendampingan dan verifikasi lapangan.`,
    `${strongest?.name ?? scope} berpotensi mencapai target produksi lebih awal.`,
    `Validasi data ${month.validation}% · risiko operasional dipantau secara berkala.`,
  ];
}
