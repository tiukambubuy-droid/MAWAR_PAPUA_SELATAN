import type { ProductionRecord } from "@/types/production";

export function ProductionRegionChart({ records }: { records: ProductionRecord[] }) {
  const rows = [...records].sort((a,b)=>b.gkg-a.gkg).slice(0,6);
  const max = rows[0]?.gkg || 1;
  return <article className="card production-region"><div className="production-card-title">PRODUKSI GKG PER {records[0]?.level.toUpperCase() ?? "WILAYAH"} — HINGGA JULI</div><div className="region-bars">{rows.map(row=><div key={row.id}><span title={row.name}>{row.name}</span><i><em style={{width:`${row.gkg/max*100}%`}} /></i><b>{Math.round(row.gkg).toLocaleString("id-ID")}</b></div>)}</div><p>▧ Kontribusi total: <b>{Math.round(records.reduce((sum,row)=>sum+row.gkg,0)).toLocaleString("id-ID")} ton GKG</b></p></article>;
}
