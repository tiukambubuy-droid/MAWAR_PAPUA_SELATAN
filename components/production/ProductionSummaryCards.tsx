import type { ProductionRecord } from "@/types/production";
import { compactYieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";

const fmt = (value: number, decimals = 0) => value.toLocaleString("id-ID", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });

export function ProductionSummaryCards({ total, season }: { total: ProductionRecord; season: Season | null }) {
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  const cards = [
    ["♨", "Produksi GKG", fmt(total.gkg), "ton", `Realisasi ${season?.display_name ?? ""}`],
    ["♙", "Estimasi Beras", fmt(total.rice), "ton", compactYieldNote],
    ["↗", "Produktivitas", fmt(total.yieldRate, 2), "ton/ha", "Rata-rata"],
    ["♜", "Luas Panen", fmt(total.harvested), "ha", `Realisasi ${season?.display_name ?? ""}`],
    ["◎", "Target Produksi GKG", fmt(total.target), "ton", season?.name ?? ""],
    ["◴", "Capaian Target", fmt(achievement, 1), "%", `vs Target ${season?.name ?? ""}`],
  ];
  return <section className="production-kpis">{cards.map((card, index) => <article className={`card ${index > 3 ? "accent" : ""}`} key={card[1]}><span>{card[0]}</span><div><small>{card[1]}</small><strong>{card[2]} <em>{card[3]}</em></strong><p>{card[4]}</p></div></article>)}</section>;
}
