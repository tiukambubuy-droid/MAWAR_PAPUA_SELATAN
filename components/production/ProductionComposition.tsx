import type { ProductionRecord } from "@/types/production";
import { millingYield, yieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";

export function ProductionComposition({ total, season }: { total: ProductionRecord; season: Season | null }) {
  const observed = total.gkg + total.rice + total.loss;
  const gkgPct = observed ? total.gkg / observed * 100 : 0;
  const ricePct = observed ? total.rice / observed * 100 : 0;
  const lossPct = Math.max(0, 100 - gkgPct - ricePct);
  return <article className="card production-composition"><div className="production-card-title">KOMPOSISI PRODUKSI — {season?.display_name.toUpperCase()}</div><div className="production-stack" role="img" aria-label="Komposisi GKG, estimasi beras, dan kehilangan atau susut"><i style={{width:`${gkgPct}%`}}>{Math.round(gkgPct)}%</i><i style={{width:`${ricePct}%`}}>{Math.round(ricePct)}%</i><i style={{width:`${lossPct}%`}}>{Math.max(3,Math.round(lossPct))}%</i></div>
    <div className="composition-labels"><span>GKG<strong>{Math.round(total.gkg).toLocaleString("id-ID")} ton</strong></span><span>Beras<strong>{Math.round(total.rice).toLocaleString("id-ID")} ton</strong></span><span>Kehilangan & Susut<strong>{Math.round(total.loss).toLocaleString("id-ID")} ton</strong></span></div>
    <div className="composition-meta"><div><small>Rendemen</small><strong>{millingYield.rate.toLocaleString("id-ID", { minimumFractionDigits: 2 })}%</strong><span>{yieldNote}</span></div><div><small>Kualitas Rata-rata GKG</small><strong>Premium - Medium</strong><span>Kadar air 14–16%</span></div></div>
  </article>;
}
