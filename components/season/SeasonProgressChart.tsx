import { getChartDataPoints } from "@/lib/chart-data";
import { formatAreaHa, formatPercentId } from "@/lib/season-formatters";
import type { MonthObservation } from "@/types/planting-season";

export function SeasonProgressChart({ months, active, title, seasonId, scale }: { months: MonthObservation[]; active: number; title: string; seasonId: string; scale: number }) {
  const targetTotal = months[0]?.target ?? 0;
  const data = getChartDataPoints(seasonId, "planting_realization_ha", targetTotal, scale);
  const values = data.flatMap(point => [point.target, point.actual, point.projection].filter((value): value is number => value !== null));
  const max = Math.max(...values, 1) * 1.12;
  const x = (index: number) => 36 + index * (430 / Math.max(1, data.length - 1));
  const y = (value: number) => 210 - value / max * 170;
  const series = (field: "target" | "actual" | "projection") => data.filter(point => point[field] !== null).map(point => `${x(point.stageIndex - 1)},${y(point[field]!)}`).join(" ");
  const selected = data[active] ?? data.find(point => point.isCutoff) ?? data[0];
  const selectedActual = selected?.actual ?? 0;
  const cutoff = data.find(point => point.isCutoff);
  return <article className="card season-line-card">
    <div className="season-section-title">PERKEMBANGAN REALISASI TANAM — {title.toUpperCase()}</div>
    <div className="line-legend"><span className="target">Target Tanam</span><span className="actual">Realisasi Tanam</span><span className="projection">Proyeksi Realisasi</span></div>
    <svg viewBox="0 0 500 245" role="img" aria-label="Grafik perkembangan realisasi tanam">
      {[40,80,120,160,200].map(value => <line key={value} x1="36" x2="466" y1={value} y2={value} className="grid" />)}
      {cutoff && <line x1={x(cutoff.stageIndex - 1)} x2={x(cutoff.stageIndex - 1)} y1="27" y2="217" className="active-line" />}
      <polyline points={series("target")} className="season-target-line" />
      <polyline points={series("actual")} className="season-actual-line" />
      {data.some(point => point.projection !== null) && <polyline points={series("projection")} className="season-projection-line" />}
      {data.filter(point => point.actual !== null).map(point => <circle key={point.period} cx={x(point.stageIndex - 1)} cy={y(point.actual!)} r={point.period === selected?.period ? 5 : 3} className="actual-dot"><title>{point.label}: {formatAreaHa(point.actual!)}</title></circle>)}
      {data.map(point => <text key={point.period} x={x(point.stageIndex - 1)} y="235" textAnchor="middle">{point.label.split(" ")[0]}</text>)}
    </svg>
    <div className="season-chart-note">◉ Capaian hingga {selected?.label}: <strong>{formatPercentId(selected?.target ? selectedActual / selected.target * 100 : 0)}</strong> dari target kumulatif</div>
  </article>;
}
