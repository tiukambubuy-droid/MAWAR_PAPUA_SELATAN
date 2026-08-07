import { BadgeCheck, ChartNoAxesCombined, Gauge, Scale, Trophy } from "lucide-react";
import type { ProductionRecord } from "@/types/production";
import { compactYieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";
import { buildAchievementInsight, insightDisclaimer } from "@/lib/system-insights";
import { formatPercentId, formatProductivity, formatTon } from "@/lib/season-formatters";

export function ProductionInsight({ total, records, scope, season }: { total: ProductionRecord; records: ProductionRecord[]; scope: string; season: Season | null }) {
  const top = [...records].sort((a, b) => b.gkg - a.gkg)[0];
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  const rule = buildAchievementInsight("production", achievement);
  const insights = [
    { Icon: BadgeCheck, title: rule.title, text: rule.description },
    { Icon: ChartNoAxesCombined, title: "Realisasi aktif", text: `Produksi GKG ${scope} mencapai ${formatTon(total.gkg)} atau ${formatPercentId(achievement)} dari target ${season?.name}.` },
    { Icon: Gauge, title: "Produktivitas", text: `Produktivitas rata-rata ${formatProductivity(total.yieldRate)} ton/ha.` },
    ...(top ? [{ Icon: Trophy, title: "Kontributor terbesar", text: `${top.name} menjadi kontributor terbesar pada wilayah aktif.` }] : []),
    { Icon: Scale, title: "Konversi beras", text: `${compactYieldNote}.` },
  ];

  return <article className="card production-insight">
    <div className="production-card-title">INSIGHT & REKOMENDASI SISTEM</div>
    <div className="production-insight-layout">
      <section className="production-insight-copy" aria-label="Insight sistem">
        <div className={`production-insight-status ${rule.severity}`}><span>{rule.severity === "success" ? "Sangat Baik" : rule.severity === "info" ? "Terpantau" : rule.severity === "warning" ? "Waspada" : "Perlu Intervensi"}</span><strong>{rule.title}</strong></div>
        <div className="production-insight-list">{insights.map(({ Icon, title, text }) => <p key={title}><Icon aria-hidden="true"/><span><strong>{title}</strong>{text}</span></p>)}</div>
        <p className="production-insight-disclaimer">{insightDisclaimer}</p>
      </section>
      <aside className="production-forecast" aria-label="Ringkasan KPI produksi">
        <span>{season?.status === "completed" ? `Produksi Akhir ${season.name}` : `Realisasi ${season?.name}`}<strong>{formatTon(total.gkg)}</strong></span>
        <span>Estimasi Beras<strong>{formatTon(total.rice)}</strong></span>
        <span>Capaian Produksi<strong>{formatPercentId(achievement)}</strong></span>
        <span>Produktivitas<strong>{formatProductivity(total.yieldRate)} ton/ha</strong></span>
      </aside>
    </div>
    <em>*Data bersifat demonstrasi / simulasi</em>
  </article>;
}
