import type { ProductionRecord } from "@/types/production";
import type { Season } from "@/lib/data-foundation";
import { getSeasonKpis } from "@/lib/data-foundation";
import { getChartDataPoints } from "@/lib/chart-data";
import { formatPercentId } from "@/lib/season-formatters";
import { MonitoringLineChart } from "@/components/ui/MonitoringLineChart";
import { Gauge } from "lucide-react";

export function ProductionTrendChart({ total, season }: { total: ProductionRecord; season: Season | null }) {
  const regency = season ? getSeasonKpis(season.season_id).aggregate : null;
  const scale = regency?.gkg_production_ton ? total.gkg / regency.gkg_production_ton : 0;
  const data = season ? getChartDataPoints(season.season_id, "gkg_production_ton", regency?.gkg_production_target_ton ?? 0, scale) : [];
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  return <article className="card production-trend">
    <div className="production-card-title">TREN PRODUKSI GKG (KUMULATIF) — {season?.name.toUpperCase()}</div>
    <MonitoringLineChart data={data} unit="ton" ariaLabel="Grafik kumulatif target, realisasi, dan proyeksi produksi GKG" presentation="production" showSummaryStrip summaryStatus={season?.status} showPersistentValueLabels={false} />
    <p><Gauge size={16} aria-hidden="true"/> Capaian {season?.display_name}: <b>{formatPercentId(achievement)}</b> dari target produksi GKG {season?.name}</p>
  </article>;
}
