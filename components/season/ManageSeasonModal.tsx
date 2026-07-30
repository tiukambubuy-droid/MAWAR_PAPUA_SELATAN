"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { PlantingSeason } from "@/types/planting-season";

export function ManageSeasonModal({ onClose, onAdd }: { onClose: () => void; onAdd: (season: PlantingSeason) => void }) {
  const [name, setName] = useState("MT V 2026");
  const [start, setStart] = useState("2026-12-01");
  const [end, setEnd] = useState("2027-04-30");
  return createPortal(<div className="detail-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="manage-season-title" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="manage-season-modal"><header><div><span>PERENCANAAN MUSIM TANAM</span><h2 id="manage-season-title">Kelola Musim</h2><small>Tambah musim tanpa batas urutan dan boleh melewati tahun.</small></div><button aria-label="Tutup kelola musim" onClick={onClose}>×</button></header><div className="manage-form">
    <label>Nama musim<input value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Tahun / label periode<input value="2026/2027" readOnly /></label>
    <label>Nomor urutan<input type="number" defaultValue={5} min={1} /></label>
    <label>Komoditas<select><option>Padi</option></select></label>
    <label>Tanggal mulai<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
    <label>Tanggal selesai panen<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
    <label>Status<select><option>Draft</option><option>Terjadwal</option><option>Berjalan</option></select></label>
    <label>Target luas tanam<input type="number" defaultValue={18000} /></label>
  </div><footer><small>Data baru hanya tersimpan selama sesi prototipe.</small><button onClick={onClose}>Batal</button><button className="primary" onClick={() => { onAdd({ id: `custom-${Date.now()}`, name, year: 2026, order: 5, commodity: "Padi", startDate: start, endDate: end, status: "Draft", target: 18000, realized: 0, production: 0 }); onClose(); }}>Simpan Musim</button></footer></section></div>, document.body);
}
