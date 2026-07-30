import type { ProductionRecord } from "@/types/production";
import { compactYieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";

export function ProductionInsight({ total, records, scope, season }: { total: ProductionRecord; records: ProductionRecord[]; scope: string; season: Season | null }) {
  const top = [...records].sort((a,b)=>b.gkg-a.gkg)[0];
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  return <article className="card production-insight"><div className="production-card-title">INSIGHT PRODUKSI</div><div className="production-insight-list">
    <p><b>◎</b>Produksi GKG {scope} mencapai {Math.round(total.gkg).toLocaleString("id-ID")} ton atau {achievement.toLocaleString("id-ID",{maximumFractionDigits:1})}% dari target {season?.name}.</p>
    <p><b>♧</b>Produktivitas rata-rata {total.yieldRate.toLocaleString("id-ID",{maximumFractionDigits:2})} ton/ha; tetap dalam kategori baik.</p>
    <p><b>♙</b>{top?.name} menjadi kontributor terbesar pada wilayah aktif.</p>
    <p><b>□</b>{season?.status === "completed" ? `${season.name} telah selesai.` : "Puncak produksi diperkirakan berlangsung pada Agustus–September 2026."}</p>
    <p><b>◴</b>{compactYieldNote}; verifikasi lapangan diprioritaskan pada data validasi terendah.</p>
  </div><div className="production-forecast"><span>{season?.status === "completed" ? `Produksi Akhir ${season.name}` : `Realisasi ${season?.name}`}<strong>{Math.round(total.gkg).toLocaleString("id-ID")} <small>ton GKG</small></strong></span><span>Estimasi Beras<strong>{Math.round(total.rice).toLocaleString("id-ID")} <small>ton</small></strong></span></div><em>*Data bersifat demonstrasi / simulasi</em></article>;
}
