import type { ProductionRecord } from "@/types/production";
import type { Season } from "@/lib/data-foundation";

export function ProductionTrendChart({ total, season }: { total: ProductionRecord; season: Season | null }) {
  const actual = [0.08, 0.24, 0.41, 0.62, 0.79, 1].map(value => total.gkg * value);
  const projection = [total.gkg, total.gkg * 1.07, total.gkg * 1.145, total.gkg * 1.19];
  const target = [0.1, 0.3, 0.5, 0.68, 0.82, 0.94, 1].map(value => total.target * value);
  const max = Math.max(total.target, projection.at(-1) ?? 1, 1) * 1.08;
  const point = (value: number, index: number, count: number) => `${35 + index * (490 / (count - 1))},${210 - value / max * 170}`;
  const months = season?.status === "completed" ? ["Okt","Nov","Des","Jan","Feb","Mar","Apr"] : ["Apr","Mei","Jun","Jul","Agu","Sep","Okt"];
  const achievement = total.target ? total.gkg / total.target * 100 : 0;
  return <article className="card production-trend"><div className="production-card-title">TREN PRODUKSI GKG (KUMULATIF) — {season?.name.toUpperCase()}</div><div className="production-chart-legend"><span className="target">Target</span><span className="actual">Realisasi</span><span className="projection">Proyeksi</span></div>
    <svg viewBox="0 0 560 245" role="img" aria-label="Grafik kumulatif target, realisasi, dan proyeksi produksi GKG">
      {[40,80,120,160,200].map(y => <line key={y} x1="35" x2="530" y1={y} y2={y} className="grid" />)}
      <polyline points={target.map((v,i)=>point(v,i,target.length)).join(" ")} className="target-line" />
      <polyline points={actual.map((v,i)=>point(v,i,actual.length+3)).join(" ")} className="actual-line" />
      {season?.status !== "completed" && <polyline points={projection.map((v,i)=>point(v,i+5,9)).join(" ")} className="projection-line" />}
      {actual.map((v,i)=><circle key={i} cx={Number(point(v,i,9).split(",")[0])} cy={Number(point(v,i,9).split(",")[1])} r="4" />)}
      <line x1="341" x2="341" y1="31" y2="220" className="today-line" />
      <text x="326" y="237" className="today-label">{season?.status === "completed" ? "Selesai" : "Cut-off"}</text>
      {months.map((m,i)=><text key={m} x={35+i*82} y="228">{m}</text>)}
    </svg>
    <p>◴ Capaian {season?.display_name}: <b>{achievement.toLocaleString("id-ID",{maximumFractionDigits:1})}%</b> dari target produksi GKG {season?.name}</p>
  </article>;
}
