import { formatNumber, formatPercent } from "@/lib/season-formatters";
import type { MonthObservation } from "@/types/planting-season";

const points = (values: number[], max: number) => values.map((v, i) => `${36 + i * (430 / Math.max(1, values.length - 1))},${210 - (v / max) * 170}`).join(" ");

export function SeasonProgressChart({ months, active, title, scale }: { months: MonthObservation[]; active: number; title: string; scale: number }) {
  const target = months.map(m => Math.round(m.target * scale));
  const realized = months.map(m => Math.round(m.realized * scale));
  const projected = months.map(m => Math.round(m.projected * scale));
  const max = Math.max(...target, ...projected, 1) * 1.12;
  const selected = months[active] ?? months[0];
  const selectedTarget = target[active] ?? 0, selectedRealized = realized[active] ?? 0;
  const x = 36 + active * (430 / Math.max(1, months.length - 1));
  return <article className="card season-line-card">
    <div className="season-section-title">PERKEMBANGAN REALISASI TANAM — {title.toUpperCase()}</div>
    <div className="line-legend"><span className="target">Target Tanam</span><span className="actual">Realisasi Tanam</span><span className="projection">Proyeksi Realisasi</span></div>
    <svg viewBox="0 0 500 245" role="img" aria-label="Grafik perkembangan realisasi tanam">
      {[40,80,120,160,200].map(y => <line key={y} x1="36" x2="466" y1={y} y2={y} className="grid" />)}
      <line x1={x} x2={x} y1="27" y2="217" className="active-line" />
      <polyline points={points(target, max)} className="season-target-line" />
      <polyline points={points(realized, max)} className="season-actual-line" />
      <polyline points={points(projected, max)} className="season-projection-line" />
      {realized.map((v, i) => <circle key={i} cx={36 + i * (430 / Math.max(1, months.length - 1))} cy={210 - (v / max) * 170} r={i === active ? 5 : 3} className="actual-dot"><title>{months[i].label}: {formatNumber(v)} ha</title></circle>)}
      {months.map((m, i) => <text key={m.key} x={36 + i * (430 / Math.max(1, months.length - 1))} y="235" textAnchor="middle">{m.label}</text>)}
      <g transform={`translate(${Math.min(395, Math.max(15, x - 35))},20)`}><rect width="72" height="22" rx="5" /><text x="36" y="14" textAnchor="middle" className="value-label">{formatNumber(selectedRealized)} ha</text></g>
      <g transform={`translate(${Math.min(410, Math.max(20, x - 23))},203)`}><rect width="48" height="20" rx="10" className="today" /><text x="24" y="13" textAnchor="middle" className="today-label">Aktif</text></g>
    </svg>
    <div className="season-chart-note">◉ Capaian hingga {selected.label} {selected.year}: <strong>{formatPercent(selectedTarget ? selectedRealized / selectedTarget * 100 : 0)}</strong> dari target kumulatif</div>
  </article>;
}
