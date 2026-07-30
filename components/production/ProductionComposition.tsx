import type { ProductionRecord } from "@/types/production";
import { millingYield, yieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";
import { formatTon } from "@/lib/season-formatters";

export function ProductionComposition({ total, season }: { total: ProductionRecord; season: Season | null }) {
  return <article className="card production-composition"><div className="production-card-title">ALUR KONVERSI PRODUKSI — {season?.display_name.toUpperCase()}</div>
    <div className="composition-labels"><span>Input: Produksi GKG<strong>{formatTon(total.gkg)}</strong></span><span>Faktor Rendemen<strong>{millingYield.rate.toLocaleString("id-ID", { minimumFractionDigits: 2 })}%</strong></span><span>Output: Estimasi Beras<strong>{formatTon(total.rice)}</strong></span></div>
    <div className="composition-meta"><div><small>Estimasi Susut (indikator terpisah)</small><strong>{formatTon(total.loss)}</strong><span>Produksi GKG × 4,5%</span></div><div><small>Catatan</small><strong>Konversi GKG → Beras</strong><span>{yieldNote}</span></div></div>
  </article>;
}
