import { formatNumber, formatPercent } from "@/lib/season-formatters";
import { compactYieldNote } from "@/lib/data-foundation";
import type { MonthObservation } from "@/types/planting-season";

export function SeasonSummaryCards({ title, month, scale, scope, production, rice }: {
  title: string;
  month: MonthObservation;
  scale: number;
  scope: string;
  production: number;
  rice: number;
}) {
  const target = Math.round(month.target * scale);
  const realized = Math.round(month.realized * scale);
  const percent = target ? realized / target * 100 : 0;
  const cards = [
    ["Target Luas Tanam", `${formatNumber(target)} ha`, "100% dari target akhir"],
    ["Realisasi Luas Tanam", `${formatNumber(realized)} ha`, `${formatPercent(percent)} dari target`],
    ["Persentase Capaian", formatPercent(percent), "dari target tanam"],
    ["Estimasi Panen", month.activity === "Pascapanen" ? "Selesai" : "28 Jul – 8 Agu 2026", "Puncak panen"],
    ["Perkiraan Produksi GKG", `${formatNumber(production)} ton`, "Agregasi produksi musim aktif"],
    ["Estimasi Beras", `${formatNumber(rice)} ton`, compactYieldNote],
    ["Target Petani", formatNumber(Math.max(24, Math.round(target / 14))), "Petani"],
    ["Petani Aktif", formatNumber(Math.max(20, Math.round(realized / 15))), `${formatPercent(Math.min(100, percent + 1))} dari target`],
    ["Luas Tervalidasi", `${formatNumber(Math.round(realized * month.validation / 100))} ha`, `Validasi ${month.validation}%`],
  ];
  return <article className="card season-kpi-card"><div className="season-section-title">RINGKASAN {title.toUpperCase()} — {scope.toUpperCase()} — HINGGA {month.label.toUpperCase()} {month.year}</div><div className="season-kpi-grid">{cards.map((item, i) => <div className={`${i < 4 ? "primary " : ""}season-kpi-item season-kpi-item-${i + 1}`} key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></div>)}</div></article>;
}
