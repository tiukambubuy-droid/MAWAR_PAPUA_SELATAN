import { phasePalette } from "@/lib/season-aggregations";
import { formatNumber, formatPercent } from "@/lib/season-formatters";
import type { PlantingPhase } from "@/types/planting-season";
import { getDominantPhase } from "@/lib/presentation-selectors";
import { CircleHelp, Clock3, Info, Sprout, Star } from "lucide-react";

export function PhaseCompositionChart({ values, total, label, validation }: {
  values: { phase: PlantingPhase; value: number }[];
  total: number;
  label: string;
  validation: number;
}) {
  const gradient = values.map((item, index) => {
    const start = values.slice(0, index).reduce((sum, value) => sum + value.value, 0);
    return `${phasePalette[item.phase]} ${start}% ${start + item.value}%`;
  }).join(",");
  const enriched = values.map(item => ({ ...item, area: Math.round(total * item.value / 100) }));
  const dominantDetail = getDominantPhase(enriched.map(item => ({ id: item.phase, label: item.phase, area: item.area, color: phasePalette[item.phase], monitoringStatus: "active" })));
  const dominant = enriched.find(item => item.phase === dominantDetail.phaseId) ?? enriched[0];
  const ripening = enriched.find(item => item.phase === "Pematangan");
  const ready = enriched.find(item => item.phase === "Siap Panen");
  const harvestArea = (ripening?.area ?? 0) + (ready?.area ?? 0);
  const harvestPercent = (ripening?.value ?? 0) + (ready?.value ?? 0);
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
            <span className="phase-percent"><em><b style={{ width: `${item.value}%`, background: phasePalette[item.phase] }} /></em><strong>{formatPercent(item.value)}</strong></span>
            <strong>{formatNumber(item.area)}</strong>
          </div>)}
        </div>
        <div className="phase-data-note"><span><Clock3 size={15} aria-hidden="true"/></span> Data diperbarui 1 jam yang lalu · Validasi {validation}% <b><Info size={15} aria-hidden="true"/></b></div>
      </section>

      <aside className="phase-insight-panel" aria-label="Insight komposisi fase">
        <div className="phase-insight">
          <i className="dominant"><Star size={18} aria-hidden="true"/></i>
          <div><span>FASE DOMINAN</span><strong>{dominant.phase}</strong><small>{formatNumber(dominant.area)} ha · {formatPercent(dominant.value)}</small></div>
        </div>
        <div className="phase-insight">
          <i className="harvest"><Sprout size={18} aria-hidden="true"/></i>
          <div><span>MENUJU PANEN</span><strong>{formatNumber(harvestArea)} ha</strong><small>{formatPercent(harvestPercent)} dari luas dipantau</small></div>
        </div>
        <div className="phase-insight">
          <i className="change"><CircleHelp size={18} aria-hidden="true"/></i>
          <div><span>PERBANDINGAN BULANAN</span><strong>Data pembanding komposisi bulan sebelumnya belum tersedia pada data prototipe.</strong><small>Komposisi yang tampil merupakan data terbaru musim aktif.</small></div>
        </div>
      </aside>
    </div>
  </article>;
}
