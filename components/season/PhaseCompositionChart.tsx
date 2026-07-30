import { phasePalette } from "@/lib/season-aggregations";
import { formatNumber } from "@/lib/season-formatters";
import type { PlantingPhase } from "@/types/planting-season";

export function PhaseCompositionChart({ values, previousValues, total, label, validation, previousLabel }: {
  values: { phase: PlantingPhase; value: number }[];
  previousValues: { phase: PlantingPhase; value: number }[];
  total: number;
  label: string;
  validation: number;
  previousLabel?: string;
}) {
  let cursor = 0;
  const gradient = values.map(item => { const start = cursor; cursor += item.value; return `${phasePalette[item.phase]} ${start}% ${cursor}%`; }).join(",");
  const enriched = values.map(item => ({ ...item, area: Math.round(total * item.value / 100) }));
  const dominant = enriched.reduce((best, item) => item.value > best.value ? item : best, enriched[0]);
  const ripening = enriched.find(item => item.phase === "Pematangan");
  const ready = enriched.find(item => item.phase === "Siap Panen");
  const harvestArea = (ripening?.area ?? 0) + (ready?.area ?? 0);
  const harvestPercent = (ripening?.value ?? 0) + (ready?.value ?? 0);
  const previousDominant = previousValues.find(item => item.phase === dominant.phase)?.value ?? dominant.value;
  const monthlyDelta = dominant.value - previousDominant;
  const monthlyChange = Math.abs(monthlyDelta).toLocaleString("id-ID", { maximumFractionDigits: 1 });
  const monthlyDirection = monthlyDelta > 0 ? "naik" : monthlyDelta < 0 ? "turun" : "tetap";
  const directionIcon = monthlyDelta > 0 ? "↗" : monthlyDelta < 0 ? "↘" : "→";
  const aria = `Komposisi fase tanaman ${label}. Total luas dipantau ${formatNumber(total)} hektare. ${enriched.map(item => `${item.phase} ${item.value} persen`).join(", ")}.`;

  return <article className="card phase-composition">
    <div className="season-section-title">KOMPOSISI FASE TANAMAN — {label.toUpperCase()}</div>
    <div className="phase-composition-layout">
      <section className="phase-chart-panel" aria-label="Ringkasan visual komposisi">
        <div className="season-donut phase-donut-large" role="img" aria-label={aria} style={{ background: `conic-gradient(${gradient})` }}>
          <div className="phase-donut-center"><strong>{formatNumber(total)}</strong><b>ha</b><span>Luas Dipantau</span></div>
        </div>
        <small>{values.length} fase terpantau</small>
      </section>

      <section className="phase-legend-panel" aria-label="Rincian komposisi fase">
        <div className="phase-table-head"><span>Fase Tanaman</span><span>Persentase</span><span>Luas (ha)</span></div>
        <div className="phase-list">
          {enriched.map(item => <div key={item.phase}>
            <span className="phase-name"><i style={{ background: phasePalette[item.phase] }} />{item.phase}</span>
            <span className="phase-percent"><em><b style={{ width: `${item.value}%`, background: phasePalette[item.phase] }} /></em><strong>{item.value}%</strong></span>
            <strong>{formatNumber(item.area)}</strong>
          </div>)}
        </div>
        <div className="phase-data-note"><span>♧</span> Data diperbarui 1 jam yang lalu · Validasi {validation}% <b aria-hidden="true">ⓘ</b></div>
      </section>

      <aside className="phase-insight-panel" aria-label="Insight komposisi fase">
        <div className="phase-insight">
          <i className="dominant" aria-hidden="true">★</i>
          <div><span>FASE DOMINAN</span><strong>{dominant.phase}</strong><small>{formatNumber(dominant.area)} ha · {dominant.value}%</small></div>
        </div>
        <div className="phase-insight">
          <i className="harvest" aria-hidden="true">♨</i>
          <div><span>MENUJU PANEN</span><strong>{formatNumber(harvestArea)} ha</strong><small>{harvestPercent}% dari luas dipantau</small></div>
        </div>
        <div className="phase-insight">
          <i className="change" aria-hidden="true">↗</i>
          <div><span>PERUBAHAN BULANAN</span><strong>{dominant.phase} {monthlyDirection} {monthlyChange}% <b>{directionIcon}</b></strong><small>{previousLabel ? `dibanding ${previousLabel}` : "bulan awal pemantauan"}</small></div>
        </div>
      </aside>
    </div>
  </article>;
}
