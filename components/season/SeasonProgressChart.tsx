import { getChartDataPoints } from "@/lib/chart-data";
import { formatPercentId } from "@/lib/season-formatters";
import type { MonthObservation } from "@/types/planting-season";
import { MonitoringLineChart } from "@/components/ui/MonitoringLineChart";

export function SeasonProgressChart({ months, active, title, seasonId, scale }: { months: MonthObservation[]; active: number; title: string; seasonId: string; scale: number }) {
  const targetTotal = months[0]?.target ?? 0;
  const data = getChartDataPoints(seasonId, "planting_realization_ha", targetTotal, scale);
  const selected = data[active] ?? data.find(point => point.isCutoff) ?? data[0];
  const selectedActual = selected?.actual ?? 0;
  return <article className="card season-line-card">
    <div className="season-section-title">PERKEMBANGAN REALISASI TANAM — {title.toUpperCase()}</div>
    <MonitoringLineChart data={data} unit="ha" selectedId={selected?.id} ariaLabel="Grafik perkembangan realisasi tanam" />
    <div className="season-chart-note">◉ Capaian hingga {selected?.label}: <strong>{formatPercentId(selected?.target ? selectedActual / selected.target * 100 : 0)}</strong> dari target kumulatif</div>
  </article>;
}
