"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { phasePalette } from "@/lib/season-aggregations";
import type { MonitoringRow } from "@/types/planting-season";

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values), min = Math.min(...values);
  const points = values.map((value, index) => `${index * 10},${24 - ((value - min) / Math.max(1, max - min)) * 20}`).join(" ");
  return <svg className="season-spark" viewBox="0 0 70 28" aria-hidden="true"><polyline points={points} /></svg>;
}

export function SeasonMonitoringTable({ title, rows, entityLabel, onSelect, onDetail }: {
  title: string; rows: MonitoringRow[]; entityLabel: string; onSelect: (name: string) => void; onDetail: (row: MonitoringRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("Semua");
  const [sort, setSort] = useState<"name" | "achievement">("name");
  const [direction, setDirection] = useState<"ascending" | "descending">("ascending");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const next = rows.filter(row => row.name.toLowerCase().includes(query.toLowerCase()) && (phase === "Semua" || row.phase === phase));
    return next.map((row, index) => ({ row, index })).sort((left, right) => {
      const comparison = sort === "achievement"
        ? left.row.realized / left.row.target - right.row.realized / right.row.target
        : left.row.name.localeCompare(right.row.name, "id");
      return (direction === "ascending" ? comparison : -comparison) || left.index - right.index;
    }).map(item => item.row);
  }, [rows, query, phase, sort, direction]);
  const pages = Math.max(1, Math.ceil(filtered.length / 5));
  const visible = filtered.slice((page - 1) * 5, page * 5);
  const changeSort = (next: "name" | "achievement") => {
    setPage(1);
    if (sort === next) setDirection(current => current === "ascending" ? "descending" : "ascending");
    else { setSort(next); setDirection("ascending"); }
  };
  return <article className="card season-table-card"><div className="season-section-title">{title}</div>
    <div className="season-table-tools"><input aria-label={`Cari ${entityLabel}`} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder={`Cari ${entityLabel.toLowerCase()}…`} /><select aria-label="Filter fase" value={phase} onChange={event => { setPhase(event.target.value); setPage(1); }}><option>Semua</option>{Object.keys(phasePalette).map(item => <option key={item}>{item}</option>)}</select></div>
    <p className="season-monitoring-note">{entityLabel === "Distrik" ? "16 distrik lainnya belum dipantau pada data prototipe." : "Tabel hanya memuat wilayah yang mempunyai record pemantauan."}</p>
    <div className="table-scroll"><table><thead><tr>
      <th aria-sort={sort === "name" ? direction : "none"}><button type="button" onClick={() => changeSort("name")}>{entityLabel}</button></th>
      <th>Fase Dominan</th><th>Realisasi / Target</th>
      <th aria-sort={sort === "achievement" ? direction : "none"}><button type="button" onClick={() => changeSort("achievement")}>Capaian</button></th>
      <th>Tren 4 Minggu</th><th>Estimasi Panen</th><th>Validasi</th><th>Aksi</th>
    </tr></thead><tbody>{!visible.length && <tr><td colSpan={8}>Tidak ada data sesuai filter.<small>Ubah pencarian atau filter untuk melihat data lainnya.</small></td></tr>}{visible.map(row => { const pct = row.target > 0 ? Math.round(row.realized / row.target * 100) : 0; return <tr key={row.id} onDoubleClick={() => onSelect(row.name)}><td><button className="season-row-link" onClick={() => onSelect(row.name)}>{row.name}</button><small>{row.groups === null ? "Kelompok tani belum tersedia" : `${row.groups} kelompok`} · {row.farmers === null ? "Petani belum tersedia" : `${row.farmers} petani`}</small></td><td><span className="season-phase" style={{ color: phasePalette[row.phase], background: `${phasePalette[row.phase]}18` }}>{row.phase}</span></td><td><strong>{row.realized.toLocaleString("id-ID")} ha</strong><i className="thin-progress"><em style={{ width: `${pct}%` }} /></i><small>dari {row.target.toLocaleString("id-ID")} ha</small></td><td><b className={pct < 82 ? "low" : ""}>{pct}%</b></td><td><Sparkline values={row.trend} /></td><td>{row.harvest}</td><td><b>{row.validation}%</b></td><td><button className="season-eye" onClick={() => onDetail(row)} aria-label={`Lihat detail ${row.name}`}><Eye size={16} aria-hidden="true"/></button></td></tr>; })}</tbody></table></div>
    <div className="season-table-footer"><span>Menampilkan {filtered.length ? (page - 1) * 5 + 1 : 0}–{Math.min(page * 5, filtered.length)} dari {filtered.length} data</span>{filtered.length > 0 && <div><button disabled={page === 1} aria-disabled={page === 1} aria-label="Halaman sebelumnya" onClick={() => setPage(current => current - 1)}><ChevronLeft size={16} aria-hidden="true"/></button>{Array.from({ length: pages }, (_, index) => <button className={page === index + 1 ? "active" : ""} aria-label={`Buka halaman ${index + 1}`} aria-current={page === index + 1 ? "page" : undefined} onClick={() => setPage(index + 1)} key={index}>{index + 1}</button>)}<button disabled={page === pages} aria-disabled={page === pages} aria-label="Halaman berikutnya" onClick={() => setPage(current => current + 1)}><ChevronRight size={16} aria-hidden="true"/></button></div>}</div>
  </article>;
}
