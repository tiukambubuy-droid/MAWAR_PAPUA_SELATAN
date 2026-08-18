import { insightDisclaimer } from "@/lib/system-insights";
import { formatTon } from "@/lib/season-formatters";
import { CloudRain, Diamond, Leaf, Route, TriangleAlert } from "lucide-react";

export function SeasonInsights({ insights, production, rice }: { insights: string[]; production: number; rice: number }) {
  const icons = [Route, Diamond, TriangleAlert, Leaf, CloudRain];
  return <article className="card season-insights"><div className="season-section-title">INSIGHT & REKOMENDASI SISTEM</div><div className="insight-list">{insights.map((item, i) => { const Icon = icons[i % icons.length]; return <p key={item}><b><Icon size={16} aria-hidden="true"/></b><span>{item}</span></p>; })}</div><p>{insightDisclaimer}</p><div className="insight-result"><div><span>Produksi GKG</span><strong>{formatTon(production)}</strong></div><div><span>Estimasi Beras</span><strong>{formatTon(rice)}</strong></div></div><em>*Data bersifat demonstrasi / simulasi</em></article>;
}
