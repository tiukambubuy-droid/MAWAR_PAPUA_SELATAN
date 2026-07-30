import type { ProductionRecord } from "@/types/production";
import { compactYieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";
import { buildAchievementInsight, insightDisclaimer } from "@/lib/system-insights";
import { formatPercentId, formatProductivity, formatTon } from "@/lib/season-formatters";

export function ProductionInsight({ total, records, scope, season }: { total: ProductionRecord; records: ProductionRecord[]; scope: string; season: Season | null }) {
  const top = [...records].sort((a,b)=>b.gkg-a.gkg)[0];
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  const rule = buildAchievementInsight("production", achievement);
  return <article className="card production-insight"><div className="production-card-title">INSIGHT & REKOMENDASI SISTEM</div><div className="production-insight-list">
    <p><b>●</b><strong>{rule.title}</strong> — {rule.description}</p>
    <p><b>◎</b>Produksi GKG {scope} mencapai {formatTon(total.gkg)} atau {formatPercentId(achievement)} dari target {season?.name}.</p>
    <p><b>♧</b>Produktivitas rata-rata {formatProductivity(total.yieldRate)} ton/ha.</p>
    {top && <p><b>♙</b>{top.name} menjadi kontributor terbesar pada wilayah aktif.</p>}
    <p><b>◴</b>{compactYieldNote}.</p>
  </div><p>{insightDisclaimer}</p><div className="production-forecast"><span>{season?.status === "completed" ? `Produksi Akhir ${season.name}` : `Realisasi ${season?.name}`}<strong>{formatTon(total.gkg)}</strong></span><span>Estimasi Beras<strong>{formatTon(total.rice)}</strong></span></div><em>*Data bersifat demonstrasi / simulasi</em></article>;
}
