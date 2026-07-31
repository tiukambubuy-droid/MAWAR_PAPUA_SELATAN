"use client";

import { createPortal } from "react-dom";
import {
  Activity, AlertTriangle, BarChart3, CalendarDays, CheckCircle2,
  Download, Eye, FileCheck2, Gauge, MapPinned, PackageCheck,
  Printer, Scale, Sprout, Target, TrendingDown, TrendingUp, Wheat, X,
} from "lucide-react";
import type { ProductionRecord } from "@/types/production";
import type { Season } from "@/lib/data-foundation";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";

const number = (value: number, decimals = 0) =>
  value.toLocaleString("id-ID", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function hasSupportedCause(record: ProductionRecord, causeType: string) {
  const causes = (record as ProductionRecord & { causes?: Record<string, unknown> }).causes;
  return Boolean(causes && Object.prototype.hasOwnProperty.call(causes, causeType) && causes[causeType]);
}

export function ProductionDetailModal({ row, recordId, seasonId, regionId, context, district, village, season, onClose }: {
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
  const achievement = row.gkg / row.target * 100;
  const condition = row.validation <= 83
    ? { label: "Perlu Validasi", tone: "danger", Icon: AlertTriangle, explanation: "Tingkat validasi record memerlukan verifikasi lanjutan." }
    : achievement < 86
      ? { label: "Produksi Turun", tone: "down", Icon: TrendingDown, explanation: "Produksi berada di bawah musim sebelumnya dan target berjalan." }
      : achievement < 92
        ? { label: "Waspada", tone: "warning", Icon: AlertTriangle, explanation: "Capaian masih dapat ditingkatkan melalui penguatan pengendalian lapangan." }
        : { label: "Baik", tone: "good", Icon: CheckCircle2, explanation: "Produksi sesuai target dan produktivitas berada pada tingkat yang baik." };
  const ConditionIcon = condition.Icon;
  const causes = [
    `Capaian produksi tercatat ${number(achievement, 1)}% dari target.`,
    `Tingkat validasi record sebesar ${row.validation}%.`,
    `Produktivitas terukur ${number(row.yieldRate, 2)} ton/ha.`,
  ];
  const previous = [0.84, 0.89, 0.93, 1].map(factor => Math.round(row.gkg * factor));
  const comparisonLabels = ["MT I 2025", "MT II 2025", "Musim sebelumnya", season?.display_name ?? "Musim aktif"];
  const maxComparison = Math.max(...previous);
  const change = (previous[3] - previous[2]) / previous[2] * 100;
  const selectedVillage = row.level === "Kampung" || row.level === "Kelurahan" ? row.name : village === "Semua Kampung" ? row.name : village;
  const selectedDistrict = row.level === "Distrik" ? row.name : district;

  useAccessibleModal(onClose);

  if (row.id !== recordId || row.id !== regionId || season?.season_id !== seasonId || context !== "production") return null;

  const handlePrint = () => {
    document.body.classList.add("production-detail-printing");
    const cleanup = () => document.body.classList.remove("production-detail-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1000);
  };

  return createPortal(
    <div className="production-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="production-detail-modal" role="dialog" aria-modal="true" aria-labelledby="production-detail-title">
        <header className="production-detail-header">
          <div className="production-detail-identity">
            <small>DETAIL PRODUKSI PER KAMPUNG</small>
            <h2 id="production-detail-title">{selectedVillage}</h2>
            <div>
              <span><MapPinned size={14} /> Distrik {selectedDistrict}</span>
              <span>Kabupaten Merauke</span>
              <span><Sprout size={14} /> {season?.name}</span>
              <span><CalendarDays size={14} /> {season?.year}</span>
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
              <div className="production-detail-card-title"><BarChart3 size={17} /> Perbandingan Produksi</div>
              <div className="production-period-bars">{previous.map((value, index) =>
                <div key={comparisonLabels[index]}><span>{comparisonLabels[index]}</span><i><em style={{ width: `${value / maxComparison * 100}%` }} /></i><b>{number(value)} ton</b></div>
              )}</div>
              <div className={`production-change ${change >= 0 ? "up" : "down"}`}>
                {change >= 0 ? <TrendingUp size={19} /> : <TrendingDown size={19} />}
                <span><b>{change >= 0 ? "Naik" : "Turun"} {number(Math.abs(change), 1)}%</b><small>Selisih {number(Math.abs(previous[3] - previous[2]))} ton dibanding MT I 2026</small></span>
              </div>
            </article>

            <article className="production-detail-card production-condition-card">
              <div className="production-detail-card-title"><Activity size={17} /> Kondisi Produksi</div>
              <span className={`production-condition-badge large ${condition.tone}`}><ConditionIcon size={19} /> {condition.label}</span>
              <p>{condition.explanation}</p>
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
              <dl><div><dt>Update terakhir</dt><dd>24 Juli 2026</dd></div><div><dt>Tingkat validasi</dt><dd>{row.validation}%</dd></div><div><dt>Sumber data</dt><dd>Petugas Lapangan (PPL)</dd></div><div><dt>Metode estimasi</dt><dd>Sampling ubinan & rendemen</dd></div></dl>
            </article>
          </section>

          <section className="production-detail-card production-detail-insight">
            <div className="production-detail-card-title"><TrendingUp size={17} /> Insight Produksi</div>
            <div>
              <p><TrendingUp size={16} />Produksi meningkat {number(change, 1)}% dibanding MT sebelumnya.</p>
              <p><Gauge size={16} />Produktivitas {row.yieldRate >= 5.5 ? "di atas" : "mendekati"} rata-rata distrik.</p>
              <p><PackageCheck size={16} />Estimasi beras mencapai {number(row.rice)} ton.</p>
              <p><Target size={16} />Target {achievement >= 90 ? "diperkirakan tercapai apabila tren tetap stabil" : "memerlukan percepatan dukungan lapangan"}.</p>
              <p><AlertTriangle size={16} />{condition.tone === "good" ? "Capaian produksi berada pada kategori Baik." : `Capaian ${number(achievement, 1)}% masih memerlukan pemantauan sampai akhir musim.`}</p>
            </div>
          </section>
        </div>

        <footer className="production-detail-footer">
          <span>Data demonstrasi · diperbarui 24 Juli 2026</span>
          <div><button aria-label="Tutup detail produksi" onClick={onClose}><X size={16} /> Tutup</button><button aria-label="Cetak detail produksi" onClick={handlePrint}><Printer size={16} /> Cetak</button><button className="primary" aria-label="Export detail produksi ke PDF" onClick={handlePrint}><Download size={16} /> Export PDF</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
