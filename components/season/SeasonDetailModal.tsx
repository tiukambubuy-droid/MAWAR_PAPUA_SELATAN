"use client";
import { createPortal } from "react-dom";
import { useRef } from "react";
import { phasePalette } from "@/lib/season-aggregations";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { X } from "lucide-react";
import type { MonitoringRow } from "@/types/planting-season";

export function SeasonDetailModal({ row, onClose }: { row: MonitoringRow; onClose: () => void }) {
  const pct = row.target > 0 ? Math.round(row.realized / row.target * 100) : 0;
  const dialogRef = useRef<HTMLElement>(null);
  useAccessibleModal(onClose, dialogRef);
  return createPortal(
    <div className="detail-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="season-detail-title" tabIndex={-1}>
        <header><div><span>DETAIL PEMANTAUAN MUSIM TANAM</span><h2 id="season-detail-title">{row.name}</h2><small>Data demonstrasi · diperbarui {row.updatedAt}</small></div><button aria-label="Tutup detail pemantauan" onClick={onClose}><X size={18} aria-hidden="true"/></button></header>
        <div className="detail-modal-body">
          <div className="detail-status-strip"><span>Fase dominan</span><strong style={{ color: phasePalette[row.phase], borderColor: phasePalette[row.phase], background: `${phasePalette[row.phase]}18` }}>{row.phase}</strong></div>
          <div className="detail-metrics">
            <div><span>Realisasi</span><b>{row.realized.toLocaleString("id-ID")} ha</b></div>
            <div><span>Target</span><b>{row.target.toLocaleString("id-ID")} ha</b></div>
            <div><span>Capaian</span><b>{pct}%</b></div>
            <div><span>Kelompok Tani</span><b>{row.groups ?? "Belum tersedia"}</b></div>
            <div><span>Petani</span><b>{row.farmers ?? "Belum tersedia"}</b></div>
            <div><span>Validasi</span><b>{row.validation}%</b></div>
          </div>
          <article><span>RINGKASAN KONDISI</span><p>Realisasi tanam berada pada fase {row.phase} dengan capaian {pct}% dari target. Estimasi panen {row.harvest}.</p></article>
          <article className="detail-reason"><span>ALASAN STATUS</span><p>Status dibentuk dari capaian luas, fase dominan, konsistensi tren empat minggu, serta tingkat validasi data lapangan.</p></article>
          <article className="detail-recommendation"><span>REKOMENDASI</span><p>{pct < 82 ? "Percepat pendampingan, verifikasi luas, dan pemeriksaan kebutuhan air." : "Pertahankan pemantauan mingguan dan siapkan dukungan panen sesuai estimasi."}</p></article>
        </div>
        <footer><small>Simulasi prototipe</small><button onClick={onClose}>Tutup</button></footer>
      </section>
    </div>,
    document.body,
  );
}
