"use client";
import { useMemo, useState } from "react";
import { aggregateProduction, recordsForRegionIds } from "@/lib/production-data";
import type { ProductionRecord } from "@/types/production";
import { ProductionFilters } from "./ProductionFilters";
import { ProductionSummaryCards } from "./ProductionSummaryCards";
import { ProductionTrendChart } from "./ProductionTrendChart";
import { ProductionRegionChart } from "./ProductionRegionChart";
import { ProductionComposition } from "./ProductionComposition";
import { ProductionTable } from "./ProductionTable";
import { ProductionInsight } from "./ProductionInsight";
import { ProductionDetailModal } from "./ProductionDetailModal";
import { getRegionById, getSeasonById } from "@/lib/data-foundation";
import { useDashboardFilters } from "@/components/DashboardFilterProvider";

export default function ProductionPage() {
  const { filters, setSeason, setDistrict, setVillage } = useDashboardFilters();
  const { seasonId, districtId, villageId } = filters;
  const [detail,setDetail]=useState<ProductionRecord|null>(null);
  const records=useMemo(()=>recordsForRegionIds(seasonId,districtId,villageId),[seasonId,districtId,villageId]);
  const total=useMemo(()=>aggregateProduction(records),[records]);
  const season=getSeasonById(seasonId);
  const district=getRegionById(districtId ?? ""); const village=getRegionById(villageId ?? "");
  const scope=village?`${village.administrative_type === "kelurahan" ? "Kelurahan" : "Kampung"} ${village.name}`:district?`Distrik ${district.name}`:"Kabupaten Merauke";
  const unavailable = (district && district.monitoring_status !== "active") || (village && village.monitoring_status !== "active");
  return <div className="subpage page-enter production-page">
    <section className="production-heading"><div><h1>PRODUKSI</h1><p>Pemantauan produksi padi Papua Selatan</p><span className="prototype-scope">Cakupan data aktif: Kabupaten Merauke</span></div><span><i/>Data simulasi aktif</span></section>
    <ProductionFilters seasonId={seasonId} districtId={districtId} villageId={villageId} onSeason={value=>{setSeason(value);setDetail(null);}} onDistrict={value=>{setDistrict(value);setDetail(null);}} onVillage={value=>{setVillage(value);setDetail(null);}}/>
    <div className="production-breadcrumb">Papua Selatan <b>›</b> Kabupaten Merauke {district&&<><b>›</b><strong>Distrik {district.name}</strong></>} {village&&<><b>›</b><strong>{village.name}</strong></>}</div>
    {unavailable && <section className="card">Belum dipantau — belum tersedia data terverifikasi untuk wilayah ini.</section>}
    {!unavailable && <>
    <ProductionSummaryCards total={total} season={season}/>
    <section className="production-visual-grid"><ProductionTrendChart total={total} season={season}/><ProductionRegionChart records={records}/><ProductionComposition total={total} season={season}/></section>
    <section className="production-bottom"><ProductionTable key={`${seasonId}:${districtId}:${villageId}`} records={records} scope={scope} seasonName={season?.name ?? ""} onSelect={setDetail}/><ProductionInsight total={total} records={records} scope={scope} season={season}/></section>
    {detail&&<ProductionDetailModal row={detail} recordId={detail.id} regionId={detail.id} seasonId={seasonId} context="production" district={district?.name ?? "Semua Distrik"} village={village?.name ?? "Semua Kampung"} season={season} onClose={()=>setDetail(null)}/>}
    </>}
  </div>;
}
