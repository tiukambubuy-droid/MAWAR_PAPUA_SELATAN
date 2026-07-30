"use client";
import { useMemo, useState } from "react";
import { aggregateProduction, recordsForScope } from "@/lib/production-data";
import type { ProductionRecord } from "@/types/production";
import { ProductionFilters } from "./ProductionFilters";
import { ProductionSummaryCards } from "./ProductionSummaryCards";
import { ProductionTrendChart } from "./ProductionTrendChart";
import { ProductionRegionChart } from "./ProductionRegionChart";
import { ProductionComposition } from "./ProductionComposition";
import { ProductionTable } from "./ProductionTable";
import { ProductionInsight } from "./ProductionInsight";
import { ProductionDetailModal } from "./ProductionDetailModal";

export default function ProductionPage() {
  const [district,setDistrict]=useState("Malind"); const [village,setVillage]=useState("Semua Kampung"); const [detail,setDetail]=useState<ProductionRecord|null>(null);
  const records=useMemo(()=>recordsForScope(district,village),[district,village]);
  const total=useMemo(()=>aggregateProduction(records),[records]);
  const scope=district==="Semua Distrik"?"Kabupaten Merauke":village==="Semua Kampung"?`Distrik ${district}`:`Kampung ${village}`;
  return <div className="subpage page-enter production-page">
    <section className="production-heading"><div><h1>PRODUKSI</h1><p>Pemantauan Produksi Padi - Kabupaten Merauke</p></div><span><i/>Data simulasi aktif</span></section>
    <ProductionFilters district={district} village={village} onDistrict={setDistrict} onVillage={setVillage}/>
    <div className="production-breadcrumb">Papua Selatan <b>›</b> Kabupaten Merauke {district!=="Semua Distrik"&&<><b>›</b><strong>Distrik {district}</strong></>} {village!=="Semua Kampung"&&<><b>›</b><strong>{village}</strong></>}</div>
    <ProductionSummaryCards total={total}/>
    <section className="production-visual-grid"><ProductionTrendChart total={total}/><ProductionRegionChart records={records}/><ProductionComposition total={total}/></section>
    <section className="production-bottom"><ProductionTable records={records} scope={scope} onSelect={setDetail}/><ProductionInsight total={total} records={records} scope={scope}/></section>
    {detail&&<ProductionDetailModal row={detail} district={district} village={village} onClose={()=>setDetail(null)}/>}
  </div>;
}
