import type { ProductionRecord } from "@/types/production";

const fmt = (value: number, decimals = 0) => value.toLocaleString("id-ID", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });

export function ProductionSummaryCards({ total }: { total: ProductionRecord }) {
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  const cards = [
    ["♨", "Produksi GKG", fmt(total.gkg), "ton", "Realisasi hingga Juli 2026"],
    ["♙", "Estimasi Beras", fmt(total.rice), "ton", "Rendemen 62,5%"],
    ["↗", "Produktivitas", fmt(total.yieldRate, 2), "ton/ha", "Rata-rata"],
    ["♜", "Luas Panen", fmt(total.harvested), "ha", "Realisasi hingga Juli 2026"],
    ["◎", "Target Produksi GKG", fmt(total.target), "ton", "MT II 2026"],
    ["◴", "Capaian Target", fmt(achievement, 1), "%", "vs Target MT II 2026"],
  ];
  return <section className="production-kpis">{cards.map((card, index) => <article className={`card ${index > 3 ? "accent" : ""}`} key={card[1]}><span>{card[0]}</span><div><small>{card[1]}</small><strong>{card[2]} <em>{card[3]}</em></strong><p>{card[4]}</p></div></article>)}</section>;
}
