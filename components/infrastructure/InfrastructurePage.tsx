"use client";

import { useMemo, useState } from "react";
import { Droplets, Tractor, Wrench, X } from "lucide-react";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";
import { useAccessibleModal } from "@/components/ui/useAccessibleModal";
import { getRegionById, regions } from "@/lib/data-foundation";
import { formatInfrastructureValue, inputFulfillment, selectIrrigation, selectProductionInputs, type IrrigationRecord, type ProductionInputRecord } from "@/lib/infrastructure-data";

const districts = regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district");
type Detail = { kind: "irrigation"; item: IrrigationRecord } | { kind: "input"; item: ProductionInputRecord };

function InfrastructureDetail({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  useAccessibleModal(onClose);
  const item = detail.item;
  return <div className="monitoring-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="monitoring-modal" role="dialog" aria-modal="true" aria-labelledby="infra-detail-title">
    <header><div><span>Infrastruktur &amp; Sarana</span><h2 id="infra-detail-title">{detail.kind === "irrigation" ? detail.item.network_name : detail.item.item_name}</h2></div><button onClick={onClose} aria-label="Tutup detail infrastruktur"><X size={20} aria-hidden="true" /></button></header>
    <div className="monitoring-modal-body"><p>Wilayah: <b>{getRegionById(item.region_id)?.name}</b></p><p>Status: <b>{item.validation_status}</b></p><p>Sumber: {item.source_reference}</p><p>Data simulasi prototipe tingkat distrik; penyebab kondisi tidak difabrikasi.</p></div><footer><button onClick={onClose}>Tutup</button></footer>
  </div></div>;
}

export default function InfrastructurePage() {
  const { filters, setSeason, setDistrict } = useDashboardFilters();
  const [tab, setTab] = useState<"irrigation"|"inputs">("irrigation");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const irrigation = useMemo(() => selectIrrigation(filters.seasonId, filters.districtId ?? "93.01"), [filters.seasonId, filters.districtId]);
  const inputs = useMemo(() => selectProductionInputs(filters.seasonId, filters.districtId ?? "93.01", category), [filters.seasonId, filters.districtId, category]);
  const irrigationRows = irrigation.items.filter(item => `${item.network_name} ${getRegionById(item.region_id)?.name}`.toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID")));
  const inputRows = inputs.items.filter(item => `${item.item_name} ${item.category} ${getRegionById(item.region_id)?.name}`.toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID")));
  const i = irrigation.aggregate, p = inputs.aggregate;
  const irrigationKpis = [["Luas Layanan",i?.serviceAreaHa??null,"ha"],["Total Jaringan",i?.networkLengthKm??null,"km"],["Kondisi Baik",i?.goodKm??null,"km"],["Rusak Ringan",i?.lightDamageKm??null,"km"],["Rusak Berat",i?.heavyDamageKm??null,"km"],["Kecukupan Air",i?.waterAdequacyPct??null,"%"],["Validasi",i?i.approved/i.total*100:null,"%"]] as const;
  const inputKpis = [["Kategori Dipantau",p?.categoryCount??null,"kategori"],["Kategori Terpenuhi",p?.fulfilledCategories??null,"kategori"],["Rata-rata Pemenuhan",p?.averageFulfillmentPct??null,"%"],["Alsintan Siap Pakai",p?.equipmentReady??null,"unit"],["Perlu Perbaikan",p?.equipmentNeedsRepair??null,"unit"],["Wilayah Kekurangan",p?.shortageRegions??null,"wilayah"],["Validasi",p?p.approved/p.total*100:null,"%"]] as const;
  return <div className="monitoring-page infrastructure-page">
    <header className="monitoring-heading"><div><span>SIMULASI PROTOTIPE · KABUPATEN MERAUKE</span><h1>INFRASTRUKTUR &amp; SARANA</h1><p>Pemantauan Irigasi dan Sarana Produksi Pertanian</p></div><Wrench size={34} aria-hidden="true" /></header>
    <section className="monitoring-filters"><label>Musim<select value={filters.seasonId} onChange={event=>setSeason(event.target.value)}><option value="MT2-2026">MT II 2026</option><option value="MT1-2026">MT I 2026</option></select></label><label>Kabupaten<select disabled><option>Kabupaten Merauke</option></select></label><label>Distrik<select value={filters.districtId??""} onChange={event=>setDistrict(event.target.value||null)}><option value="">Semua distrik terpantau</option>{districts.map(region=><option value={region.id} key={region.id}>{region.name}{region.monitoring_status!=="active"?" — Belum dipantau":""}</option>)}</select></label><label>Pencarian<input className="monitoring-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Cari wilayah atau item" /></label></section>
    <div className="monitoring-tabs" role="tablist" aria-label="Jenis pemantauan"><button role="tab" aria-selected={tab==="irrigation"} onClick={()=>setTab("irrigation")}><Droplets size={18}/> Irigasi</button><button role="tab" aria-selected={tab==="inputs"} onClick={()=>setTab("inputs")}><Tractor size={18}/> Sarana Produksi</button></div>
    {tab === "irrigation" ? <>
      <section className="monitoring-kpis seven">{irrigationKpis.map(([label,value,unit])=><article key={label}><i><Droplets size={19}/></i><span>{label}</span><strong>{formatInfrastructureValue(value,unit)}</strong></article>)}</section>
      {!irrigation.monitored?<div className="monitoring-empty">Belum dipantau</div>:<><section className="monitoring-grid two"><article className="monitoring-card"><h2>Komposisi Kondisi Irigasi</h2><div className="condition-stack"><i style={{width:`${i!.goodKm/i!.networkLengthKm*100}%`}}/><i className="light" style={{width:`${i!.lightDamageKm/i!.networkLengthKm*100}%`}}/><i className="heavy" style={{width:`${i!.heavyDamageKm/i!.networkLengthKm*100}%`}}/></div><p className="card-copy">Baik {formatInfrastructureValue(i!.goodKm,"km")} · Ringan {formatInfrastructureValue(i!.lightDamageKm,"km")} · Berat {formatInfrastructureValue(i!.heavyDamageKm,"km")}</p></article><article className="monitoring-card"><h2>Layanan dan Kecukupan Air</h2><p className="large-stat">{formatInfrastructureValue(i!.serviceAreaHa,"ha")}</p><p className="card-copy">Kecukupan air {formatInfrastructureValue(i!.waterAdequacyPct,"%")}</p></article></section>
      <section className="monitoring-card monitoring-table"><h2>Daftar Jaringan Irigasi</h2><div className="table-scroll"><table><thead><tr><th>Jaringan</th><th>Wilayah</th><th>Panjang</th><th>Layanan</th><th>Fungsional</th><th>Validasi</th><th>Detail</th></tr></thead><tbody>{irrigationRows.map(item=><tr key={item.id}><td>{item.network_name}</td><td>{getRegionById(item.region_id)?.name}</td><td>{formatInfrastructureValue(item.network_length_km,"km")}</td><td>{formatInfrastructureValue(item.service_area_ha,"ha")}</td><td>{formatInfrastructureValue(item.functional_pct,"%")}</td><td>{item.validation_status}</td><td><button onClick={()=>setDetail({kind:"irrigation",item})}>Detail</button></td></tr>)}</tbody></table></div></section></>}
    </> : <>
      <div className="local-filter"><label>Kategori <select value={category} onChange={event=>setCategory(event.target.value)}><option value="all">Semua kategori</option>{["Benih","Pupuk","Pestisida","Traktor","Combine Harvester","Pompa Air"].map(value=><option key={value}>{value}</option>)}</select></label></div>
      <section className="monitoring-kpis seven">{inputKpis.map(([label,value,unit])=><article key={label}><i><Tractor size={19}/></i><span>{label}</span><strong>{formatInfrastructureValue(value,unit)}</strong></article>)}</section>
      {!inputs.monitored?<div className="monitoring-empty">Belum dipantau</div>:<><section className="monitoring-grid two"><article className="monitoring-card"><h2>Kebutuhan vs Ketersediaan</h2><p className="large-stat">{formatInfrastructureValue(p!.averageFulfillmentPct,"%")}</p><p className="card-copy">Rata-rata persentase kategori; kuantitas berbeda unit tidak dijumlahkan.</p></article><article className="monitoring-card"><h2>Status Alsintan</h2><p className="large-stat">{formatInfrastructureValue(p!.equipmentReady,"unit")}</p><p className="card-copy">Perlu perbaikan {formatInfrastructureValue(p!.equipmentNeedsRepair,"unit")}</p></article></section>
      <section className="monitoring-card monitoring-table"><h2>Daftar Sarana Produksi</h2><div className="table-scroll"><table><thead><tr><th>Kategori</th><th>Item</th><th>Wilayah</th><th>Kebutuhan</th><th>Tersedia</th><th>Pemenuhan</th><th>Validasi</th><th>Detail</th></tr></thead><tbody>{inputRows.map(item=><tr key={item.id}><td>{item.category}</td><td>{item.item_name}</td><td>{getRegionById(item.region_id)?.name}</td><td>{formatInfrastructureValue(item.required_quantity,item.unit)}</td><td>{formatInfrastructureValue(item.available_quantity,item.unit)}</td><td>{formatInfrastructureValue(inputFulfillment(item)?.presentationPct??null,"%")}</td><td>{item.validation_status}</td><td><button onClick={()=>setDetail({kind:"input",item})}>Detail</button></td></tr>)}</tbody></table></div></section></>}
    </>}
    <section className="monitoring-card monitoring-insight"><h2>Prioritas dan insight</h2><p>{tab==="irrigation"?"Prioritas ditentukan dari panjang kerusakan dan kecukupan air yang tercatat.":"Wilayah kekurangan ditentukan dari pemenuhan per kategori di bawah 100%."}</p><small>Insight berbasis aturan data tersedia, bukan AI generatif.</small></section>
    {detail&&<InfrastructureDetail detail={detail} onClose={()=>setDetail(null)}/>}
  </div>;
}
