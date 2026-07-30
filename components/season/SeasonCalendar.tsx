import { phasePalette } from "@/lib/season-aggregations";
import type { MonthObservation } from "@/types/planting-season";

export function SeasonCalendar({ title, months, active, onSelect }: { title: string; months: MonthObservation[]; active: number; onSelect: (index: number) => void }) {
  const selected = months[active] ?? months[0];
  return <article className="card season-calendar">
    <div className="season-section-title">KALENDER TANAM & PANEN — {title}</div>
    <div className="season-months">{months.map((month, index) => <button key={month.key} className={index === active ? "active" : ""} onClick={() => onSelect(index)} title={`${month.activity} · ${month.realized.toLocaleString("id-ID")} ha · Validasi ${month.validation}%`}>
      <strong>{month.label}</strong><span>{month.year}</span><small>{month.activity}</small><i><em style={{ width: `${month.progress}%`, background: phasePalette[month.activity] }} /></i>
    </button>)}</div>
    <div className="season-calendar-focus"><span>Fokus {selected.label} {selected.year}</span><strong>{selected.focus}</strong><em>Data diperbarui 1 jam lalu · Validasi {selected.validation}%</em></div>
  </article>;
}
