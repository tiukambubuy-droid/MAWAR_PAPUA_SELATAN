"use client";

import { createPortal } from "react-dom";
import { useRef } from "react";
import {
  Activity, AlertTriangle, CalendarDays, CheckCircle2,
  Download, Eye, FileCheck2, Gauge, MapPinned, PackageCheck,
  Printer, Scale, Sprout, Target, Wheat, X,
} from "lucide-react";
import type { ProductionRecord } from "@/types/production";
import type { Season } from "@/lib/data-foundation";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { mawarReportSlug, printWithMawarTitle } from "@/lib/report-branding";
import { buildProductionModalPresentation } from "@/lib/public-presentation";
import { formatMonitoringDate, formatMonitoringSeason } from "@/lib/monitoring-presentation";

const number = (value: number, decimals = 0) =>
  value.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function hasSupportedCause(record: ProductionRecord, causeType: string) {
  const causes = (record as ProductionRecord & { causes?: Record<string, unknown> }).causes;
  return Boolean(causes && Object.prototype.hasOwnProperty.call(causes, causeType) && causes[causeType]);
}

export function ProductionDetailModal({ row, recordId, seasonId, regionId, context, village, season, onClose }: {
  row: ProductionRecord;
  recordId: string;
  seasonId: string;
  regionId: string;
  context: "production";
  district: string;
  village: string;
  season: Season | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const achievement = row.gkg / row.target * 100;
  const condition = row.validation <= 83
    ? { label: "Perlu Validasi", tone: "danger", Icon: AlertTriangle, explanation: "Tingkat validasi record memerlukan verifikasi lanjutan." }
    : achievement < 86
      ? { label: "Di bawah target", tone: "down", Icon: AlertTriangle, explanation: "Capaian produksi masih berada di bawah target berjalan." }
      : achievement < 92
        ? { label: "Waspada", tone: "warning", Icon: AlertTriangle, explanation: "Capaian masih dapat ditingkatkan melalui penguatan pengendalian lapangan." }
        : { label: "Baik", tone: "good", Icon: CheckCircle2, explanation: "Produksi sesuai target dan produktivitas berada pada tingkat yang baik." };
  const ConditionIcon = condition.Icon;
  const causes = [
    `Capaian produksi tercatat ${number(achievement, 1)}% dari target.`,
    `Tingkat validasi record sebesar ${row.validation}%.`,
    `Produktivitas terukur ${number(row.yieldRate, 2)} ton/ha.`,
  ];
  const presentation = buildProductionModalPresentation(row, seasonId, season?.reporting_cutoff ?? "");
  const selectedVillage = presentation?.regionName ?? village;

  useAccessibleModal(onClose, dialogRef);

  if (!presentation || row.id !== recordId || row.id !== regionId || season?.season_id !== seasonId || context !== "production") return null;

  const handlePrint = () => {
    document.body.classList.add("production-detail-printing");
    printWithMawarTitle(
      mawarReportSlug("produksi", selectedVillage, season?.display_name),
      () => document.body.classList.remove("production-detail-printing"),
    );
  };

  return createPortal(
    <div className="production-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="production-detail-modal" role="dialog" aria-modal="true" aria-labelledby="production-detail-title" tabIndex={-1}>
        <header className="production-detail-header">
          <div className="production-detail-identity">
            <small>MAWAR PAPUA SELATAN</small>
            <h2 id="production-detail-title">{presentation.title}</h2>
            <div>
              <span><MapPinned size={14} /> {presentation.title.replace("Detail Produksi ", "")} {presentation.regionName}</span>
              <span>ID {presentation.regionId}</span><span>{presentation.parentRegency}</span>
              <span><Sprout size={14} /> {formatMonitoringSeason(presentation.seasonId)}</span>
              <span><CalendarDays size={14} /> Cut-off {formatMonitoringDate(presentation.cutoff)}</span>
            </div>
          </div>
          <div className="production-detail-header-actions">
            <span className={`production-condition-badge ${condition.tone}`}><ConditionIcon size={17} /> {condition.label}</span>
            <button aria-label="Tutup detail produksi" onClick={onClose}><X size={20} /></button>
          </div>
        </header>

        <div className="production-detail-scroll">
          <section className="production-detail-kpis" aria-label="Ringkasan KPI produksi">
            {[
              [Wheat, "Produksi GKG", number(row.gkg), "ton"],
              [PackageCheck, "Estimasi Beras", number(row.rice), "ton"],
              [Gauge, "Produktivitas", number(row.yieldRate, 2), "ton/ha"],
              [Scale, "Luas Panen", number(row.harvested), "ha"],
              [Target, "Target Produksi", number(row.target), "ton"],
              [Activity, "Persentase Capaian", number(achievement, 1), "%"],
            ].map(([Icon, label, value, unit]) => {
              const KpiIcon = Icon as typeof Wheat;
              return <article key={String(label)}><KpiIcon size={22} /><div><span>{String(label)}</span><strong>{String(value)} <small>{String(unit)}</small></strong></div></article>;
            })}
          </section>

          <section className="production-detail-grid-main">
            <article className="production-detail-card production-period-card">
              <div className="production-detail-card-title"><Activity size={17} /> Perbandingan Produksi</div>
              <div className="production-comparison-unavailable" role="status">Pembanding 2025 belum tersedia</div>
            </article>

            <article className="production-detail-card production-condition-card">
              <div className="production-detail-card-title"><Activity size={17} /> Kondisi Produksi</div>
              <span className={`production-condition-badge large ${condition.tone}`}><ConditionIcon size={19} /> {condition.label}</span>
              <p>{condition.tone === "down" ? "Capaian produksi masih berada di bawah target berjalan." : condition.explanation}</p>
              <div className="production-condition-meter"><i><em style={{ width: `${Math.min(100, achievement)}%` }} /></i><span>Capaian {number(achievement, 1)}%</span></div>
            </article>
          </section>

          <section className="production-detail-grid-secondary">
            <article className="production-detail-card">
              <div className="production-detail-card-title"><Eye size={17} /> Analisis Penyebab</div>
              <ul>{causes.map(cause => <li key={cause}><CheckCircle2 size={15} /> {cause}</li>)}</ul>
            </article>
            <article className="production-detail-card production-puso-card no-puso">
              <div className="production-detail-card-title"><AlertTriangle size={17} /> Informasi Penyebab Khusus</div>
              <div className="production-puso-clear"><CheckCircle2 size={30} /><strong>Tidak terdapat informasi penyebab khusus</strong><span>pada data prototipe ini.</span></div>
            </article>
            <article className="production-detail-card">
              <div className="production-detail-card-title"><FileCheck2 size={17} /> Informasi Validasi</div>
              <dl><div><dt>Scope</dt><dd>{presentation.scope}</dd></div><div><dt>Status monitoring</dt><dd>{presentation.monitoringStatus}</dd></div><div><dt>Update terakhir</dt><dd>{presentation.updatedAt}</dd></div><div><dt>Tingkat validasi</dt><dd>{presentation.validation}</dd></div><div><dt>Tipe sumber</dt><dd>{presentation.sourceType}</dd></div><div><dt>Tipe data</dt><dd>{presentation.dataType}</dd></div></dl>
            </article>
          </section>

          <section className="production-detail-card production-detail-insight">
            <div className="production-detail-card-title"><Activity size={17} /> Insight Produksi</div>
            <div>
              <p><Activity size={16} />Pembanding 2025 belum tersedia.</p>
              <p><Gauge size={16} />Produktivitas {row.yieldRate >= 5.5 ? "di atas" : "mendekati"} rata-rata distrik.</p>
              <p><PackageCheck size={16} />Estimasi beras mencapai {number(row.rice)} ton.</p>
              <p><Target size={16} />Target {achievement >= 90 ? "diperkirakan tercapai apabila tren tetap stabil" : "memerlukan percepatan dukungan lapangan"}.</p>
              <p><AlertTriangle size={16} />{condition.tone === "good" ? "Capaian produksi berada pada kategori Baik." : `Capaian ${number(achievement, 1)}% masih memerlukan pemantauan sampai akhir musim.`}</p>
            </div>
          </section>
        </div>

        <footer className="production-detail-footer">
          <span>MAWAR Papua Selatan · Data demonstrasi · diperbarui {presentation.updatedAt}</span>
          <div><button aria-label="Tutup detail produksi" onClick={onClose}><X size={16} /> Tutup</button><button aria-label="Cetak detail produksi" onClick={handlePrint}><Printer size={16} /> Cetak</button><button className="primary" aria-label="Export detail produksi ke PDF" onClick={handlePrint}><Download size={16} /> Export PDF</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
