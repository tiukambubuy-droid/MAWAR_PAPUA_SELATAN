import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFile } from "node:fs/promises";

const regions=[
 {id:"93.01",name:"Merauke",administrative_type:"regency",parent_id:"93",monitoring_status:"active"},
 ...["Semangga","Tanah Miring","Kurik","Malind","Jagebob","Sota"].map((name,index)=>({id:`93.01.${String(index+1).padStart(2,"0")}`,name,administrative_type:"district",parent_id:"93.01",monitoring_status:"active"})),
 ...Array.from({length:16},(_,index)=>({id:`93.01.${String(index+7).padStart(2,"0")}`,name:`Belum ${index}`,administrative_type:"district",parent_id:"93.01",monitoring_status:"not_monitored"})),
 {id:"93.01.01.2001",name:"Kuper",administrative_type:"kampung",parent_id:"93.01.01",monitoring_status:"active"},
];
const productionRecords=[
 {season_id:"MT1-2026",region_id:"93.01.01.2001",updated_at:"2026-03-31T07:00:00Z",source_type:"government_prototype",data_type:"simulation"},
 {season_id:"MT2-2026",region_id:"93.01.01.2001",updated_at:"2026-07-24T13:42:00Z",source_type:"government_prototype",data_type:"simulation"},
];
const formatMonitoringStatus=value=>({government_prototype:"Prototipe pemerintah",simulation:"Simulasi"}[value]??String(value));
const formatMonitoringSourceType=value=>({government_prototype:"Prototipe pemerintah",prototype:"Prototipe"}[value]??"Belum tersedia");
const formatMonitoringTimestamp=value=>value?"24 Juli 2026 · 22.42 WIT":"Belum tersedia";
const latestMonitoringTimestamp=values=>values.filter(Boolean).at(-1)??null;
const getRegionById=id=>regions.find(item=>item.id===id);
let source=await readFile("lib/public-presentation.ts","utf8");
source=source.replace(/import[^;]+;\r?\n/g,"");
const prelude=`const regions=${JSON.stringify(regions)},productionRecords=${JSON.stringify(productionRecords)};const getRegionById=id=>regions.find(item=>item.id===id);const formatMonitoringStatus=${formatMonitoringStatus.toString()},formatMonitoringSourceType=${formatMonitoringSourceType.toString()},formatMonitoringTimestamp=${formatMonitoringTimestamp.toString()},latestMonitoringTimestamp=${latestMonitoringTimestamp.toString()};`;
const output=ts.transpileModule(prelude+source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const presentation=await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

const json=async path=>JSON.parse(await readFile(path,"utf8"));
const [referenceJson,regionsJson,landJson,seasonJson,productionJson]=await Promise.all([
 json("data/master/data-foundation.json"),json("data/master/regions.json"),json("data/monitoring/land-monitoring.json"),json("data/monitoring/season-monitoring.json"),json("data/monitoring/production-monitoring.json"),
]);
const transpileSource=async path=>ts.transpileModule((await readFile(path,"utf8")).replace(/import[^;]+;\r?\n/g,""),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const productionOutput=`const referenceJson=${JSON.stringify(referenceJson)},regionsJson=${JSON.stringify(regionsJson)},landJson=${JSON.stringify(landJson)},seasonJson=${JSON.stringify(seasonJson)},productionJson=${JSON.stringify(productionJson)};${await transpileSource("lib/data-foundation.ts")}${await transpileSource("lib/production-data.ts")}`;
const production=await import(`data:text/javascript;base64,${Buffer.from(productionOutput).toString("base64")}`);

const row=(id,level="Distrik")=>({id,name:getRegionById(id)?.name??"",level,validation:91});
test("production modal presentation is scope-aware and rejects not monitored records",()=>{
 const regencyMt1=presentation.buildProductionModalPresentation(row("93.01","Kabupaten"),"MT1-2026","2026-03-31");
 const regency=presentation.buildProductionModalPresentation(row("93.01","Kabupaten"),"MT2-2026","2026-07-24");
 const district=presentation.buildProductionModalPresentation(row("93.01.01"),"MT2-2026","2026-07-24");
 assert.deepEqual([regency.scope,regency.title,regency.parentRegency],["regency","Detail Produksi Kabupaten",null]);
 assert.deepEqual([regencyMt1.regionId,regencyMt1.sourceType,regencyMt1.dataType],["93.01","Prototipe pemerintah","Simulasi"]);
 assert.deepEqual([district.scope,district.title,district.regionId,district.parentRegency,district.updatedAt],["district","Detail Produksi Distrik","93.01.01","Kabupaten Merauke","24 Juli 2026 · 22.42 WIT"]);
 assert.equal(presentation.buildProductionModalPresentation(row("93.01.07"),"MT2-2026","2026-07-24"),null);
 assert.notDeepEqual(regency,district);assert.deepEqual(presentation.buildProductionModalPresentation(row("93.01","Kabupaten"),"MT2-2026","2026-07-24"),regency);
});
test("monitoring labels and district coverage come from master status",()=>{
 assert.equal(presentation.monitoredRegionOption(regions[1]),"Semangga");
 assert.match(presentation.monitoredRegionOption(regions[7]),/— Belum dipantau$/);
 assert.deepEqual(presentation.districtMonitoringCoverage(),{total:22,monitored:6,label:"6 distrik terpantau dari 22 distrik"});
});
test("actual production helpers return all six county KPI values for both seasons",()=>{
 const source=structuredClone(productionJson.records);
 const expected={
  "MT1-2026":{harvested:33470,yieldRate:183420/33470,gkg:183420,rice:116270,target:185000,achievement:183420/185000*100},
  "MT2-2026":{harvested:31854,yieldRate:174577/31854,gkg:174577,rice:110664,target:197220,achievement:174577/197220*100},
 };
 for(const seasonId of Object.keys(expected)){
  const records=production.recordsForRegionIds(seasonId,null,null),aggregate=production.aggregateProduction(records),actual={harvested:aggregate.harvested,yieldRate:aggregate.yieldRate,gkg:aggregate.gkg,rice:Math.round(aggregate.rice),target:aggregate.target,achievement:aggregate.gkg/aggregate.target*100};
  assert.deepEqual(actual,expected[seasonId]);assert.deepEqual(production.aggregateProduction(production.recordsForRegionIds(seasonId,null,null)),aggregate);
  const semangga=production.recordsForRegionIds(seasonId,null,null).find(item=>item.id==="93.01.05");assert.ok(semangga);assert.notDeepEqual(aggregate,semangga);
 }
 assert.deepEqual(productionJson.records,source);
});
test("active public UI contains no fabricated comparison or relative time",async()=>{
 const files=["components/production/ProductionDetailModal.tsx","components/season/SeasonCalendar.tsx","app/page.tsx","components/risk/RiskClimatePage.tsx","components/collaboration/CollaborationPage.tsx"];
 const ui=(await Promise.all(files.map(file=>readFile(file,"utf8")))).join("\n");
 assert.doesNotMatch(ui,/MT I 2025|MT II 2025|Naik 7,5%|Produksi meningkat|Data diperbarui 1 jam lalu|DETAIL PRODUKSI PER KAMPUNG/);
 assert.match(ui,/Pembanding 2025 belum tersedia/);assert.match(ui,/Kualitas data: Tinggi/);assert.match(ui,/monitoredRegionOption/);
});
