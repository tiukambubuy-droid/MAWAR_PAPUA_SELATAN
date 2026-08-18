import type { ProductionRecord } from "@/types/production";
import { compactYieldNote } from "@/lib/data-foundation";
import type { Season } from "@/lib/data-foundation";
import { Gauge, LandPlot, PackageCheck, Target, TrendingUp, Wheat } from "lucide-react";

const fmt = (value: number, decimals = 0) => value.toLocaleString("id-ID", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });

export function ProductionSummaryCards({ total, season }: { total: ProductionRecord; season: Season | null }) {
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  const cards = [
    { Icon: Wheat, label: "Produksi GKG", value: fmt(total.gkg), unit: "ton", note: `Realisasi ${season?.display_name ?? ""}` },
    { Icon: PackageCheck, label: "Estimasi Beras", value: fmt(total.rice), unit: "ton", note: compactYieldNote },
    { Icon: Gauge, label: "Produktivitas", value: fmt(total.yieldRate, 2), unit: "ton/ha", note: "Rata-rata" },
    { Icon: LandPlot, label: "Luas Panen", value: fmt(total.harvested), unit: "ha", note: `Realisasi ${season?.display_name ?? ""}` },
    { Icon: Target, label: "Target Produksi GKG", value: fmt(total.target), unit: "ton", note: season?.name ?? "" },
    { Icon: TrendingUp, label: "Capaian Target", value: fmt(achievement, 1), unit: "%", note: `vs Target ${season?.name ?? ""}` },
  ];
  return <section className="production-kpis">{cards.map(({ Icon, label, value, unit, note }, index) => <article className={`card ${index > 3 ? "accent" : ""}`} key={label}><span><Icon size={20} aria-hidden="true"/></span><div><small>{label}</small><strong>{value} <em>{unit}</em></strong><p>{note}</p></div></article>)}</section>;
}
