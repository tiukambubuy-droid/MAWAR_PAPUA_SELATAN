import type { ProductionRecord } from "@/types/production";
import type { Season } from "@/lib/data-foundation";
import { getSeasonKpis } from "@/lib/data-foundation";
import { getChartDataPoints } from "@/lib/chart-data";
import { formatPercentId, formatTon } from "@/lib/season-formatters";

export function ProductionTrendChart({ total, season }: { total: ProductionRecord; season: Season | null }) {
  const regency = season ? getSeasonKpis(season.season_id).aggregate : null;
  const scale = regency?.gkg_production_ton ? total.gkg / regency.gkg_production_ton : 0;
  const data = season ? getChartDataPoints(season.season_id, "gkg_production_ton", regency?.gkg_production_target_ton ?? 0, scale) : [];
  const values = data.flatMap(point => [point.target, point.actual, point.projection].filter((value): value is number => value !== null));
  const max = Math.max(...values, 1) * 1.08;
  const x = (index: number) => 35 + index * (490 / Math.max(1, data.length - 1));
  const y = (value: number) => 210 - value / max * 170;
  const series = (field: "target" | "actual" | "projection") => data
    .filter(point => point[field] !== null)
    .map(point => `${x(point.stageIndex - 1)},${y(point[field]!)}`).join(" ");
  const cutoff = data.find(point => point.isCutoff);
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  return <article className="card production-trend"><div className="production-card-title">TREN PRODUKSI GKG (KUMULATIF) — {season?.name.toUpperCase()}</div><div className="production-chart-legend"><span className="target">Target</span><span className="actual">Realisasi</span><span className="projection">Proyeksi</span></div>
    <svg viewBox="0 0 560 245" role="img" aria-label="Grafik kumulatif target, realisasi, dan proyeksi produksi GKG">
      {[40,80,120,160,200].map(value => <line key={value} x1="35" x2="530" y1={value} y2={value} className="grid" />)}
      <polyline points={series("target")} className="target-line" />
      <polyline points={series("actual")} className="actual-line" />
      {data.some(point => point.projection !== null) && <polyline points={series("projection")} className="projection-line" />}
      {data.filter(point => point.actual !== null).map(point => <circle key={point.period} cx={x(point.stageIndex - 1)} cy={y(point.actual!)} r="4"><title>{point.label}: {formatTon(point.actual!)}</title></circle>)}
      {cutoff && <><line x1={x(cutoff.stageIndex - 1)} x2={x(cutoff.stageIndex - 1)} y1="31" y2="220" className="today-line" /><text x={x(cutoff.stageIndex - 1) - 15} y="237" className="today-label">Cut-off</text></>}
      {data.map(point => <text key={point.period} x={x(point.stageIndex - 1)} y="228" textAnchor="middle">{point.label.split(" ")[0]}</text>)}
    </svg>
    <p>◴ Capaian {season?.display_name}: <b>{formatPercentId(achievement)}</b> dari target produksi GKG {season?.name}</p>
  </article>;
}
