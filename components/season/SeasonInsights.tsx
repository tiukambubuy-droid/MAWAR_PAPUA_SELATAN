import { insightDisclaimer } from "@/lib/system-insights";
import { formatTon } from "@/lib/season-formatters";

export function SeasonInsights({ insights, production, rice }: { insights: string[]; production: number; rice: number }) {
  return <article className="card season-insights"><div className="season-section-title">INSIGHT & REKOMENDASI SISTEM</div><div className="insight-list">{insights.map((item, i) => <p key={item}><b>{["⌁","♢","△","♧","☂"][i]}</b><span>{item}</span></p>)}</div><p>{insightDisclaimer}</p><div className="insight-result"><div><span>Produksi GKG</span><strong>{formatTon(production)}</strong></div><div><span>Estimasi Beras</span><strong>{formatTon(rice)}</strong></div></div><em>*Data bersifat demonstrasi / simulasi</em></article>;
}
