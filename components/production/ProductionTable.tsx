"use client";

import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import type { ProductionRecord } from "@/types/production";

export function ProductionTable({
  records,
  scope,
  onSelect,
}: {
  records: ProductionRecord[];
  scope: string;
  onSelect: (row: ProductionRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("gkg");
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () =>
      [...records]
        .filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) =>
          sort === "name"
            ? a.name.localeCompare(b.name)
            : sort === "achievement"
              ? b.gkg / b.target - a.gkg / a.target
              : b.gkg - a.gkg,
        ),
    [records, query, sort],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / 6));
  const visible = filtered.slice((page - 1) * 6, page * 6);

  return (
    <article className="card production-table-card">
      <div className="production-card-title">
        PRODUKSI PER {records[0]?.level.toUpperCase() ?? "WILAYAH"} — {scope.toUpperCase()} — MT II 2026
      </div>
      <div className="production-table-tools">
        <input
          aria-label="Cari data produksi"
          placeholder="Cari wilayah…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Urutkan data produksi"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="gkg">Produksi terbesar</option>
          <option value="achievement">Capaian tertinggi</option>
          <option value="name">Urut nama</option>
        </select>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Wilayah</th>
              <th>Luas Panen (ha)</th>
              <th>Produktivitas</th>
              <th>Produksi GKG</th>
              <th>Estimasi Beras</th>
              <th>Target GKG</th>
              <th>Capaian</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const percentage = (row.gkg / row.target) * 100;
              return (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <small>{row.level} · validasi {row.validation}%</small>
                  </td>
                  <td>{Math.round(row.harvested).toLocaleString("id-ID")}</td>
                  <td>{row.yieldRate.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ton/ha</td>
                  <td>{Math.round(row.gkg).toLocaleString("id-ID")} ton</td>
                  <td>{Math.round(row.rice).toLocaleString("id-ID")} ton</td>
                  <td>{Math.round(row.target).toLocaleString("id-ID")} ton</td>
                  <td>
                    <b className={percentage < 85 ? "low" : ""}>
                      {percentage.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
                    </b>
                  </td>
                  <td>
                    <button
                      className="production-detail-button"
                      aria-label={`Lihat detail ${row.name}`}
                      onClick={() => onSelect(row)}
                    >
                      <Eye size={15} /> Detail
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="production-table-footer">
        <span>
          Menampilkan {filtered.length ? (page - 1) * 6 + 1 : 0}–
          {Math.min(page * 6, filtered.length)} dari {filtered.length} data
        </span>
        <div>
          <button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>‹</button>
          {Array.from({ length: pages }, (_, index) => (
            <button
              className={page === index + 1 ? "active" : ""}
              key={index}
              onClick={() => setPage(index + 1)}
            >
              {index + 1}
            </button>
          ))}
          <button disabled={page === pages} onClick={() => setPage((current) => current + 1)}>›</button>
        </div>
      </div>
    </article>
  );
}
