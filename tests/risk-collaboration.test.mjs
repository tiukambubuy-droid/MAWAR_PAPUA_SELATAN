import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const json = async path => JSON.parse(await readFile(path, "utf8"));
const datasets = {
  climateRisk: await json("data/monitoring/climate-risk-monitoring.json"),
  foodSecurity: await json("data/monitoring/food-security-monitoring.json"),
  irrigation: await json("data/monitoring/irrigation-monitoring.json"),
  productionInputs: await json("data/monitoring/production-inputs-monitoring.json"),
  production: await json("data/monitoring/production-monitoring.json"),
};
const collab = await json("data/monitoring/collaboration-monitoring.json");
const allActivities = [...collab.activities, ...collab.activities_mt1];
async function moduleFrom(path, preamble = "") {
  const source = await readFile(path, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^import .*;$/gm, "");
  return import(`data:text/javascript;base64,${Buffer.from(`${preamble}\n${output}`).toString("base64")}`);
}
const rules = await moduleFrom("lib/early-warning-rules.ts");
const presentation = await moduleFrom("lib/monitoring-presentation.ts");
globalThis.__monitoringPresentation = presentation;
const resolver = await moduleFrom("lib/monitoring-record-resolver.ts", `${Object.entries(datasets).map(([key,value])=>`const ${key}=${JSON.stringify(value)};`).join("\n")}const getRegionById=id=>({name:id});`);
const collaboration = await moduleFrom("lib/collaboration-data.ts", `const raw=${JSON.stringify(collab)};const climateRisk=${JSON.stringify(datasets.climateRisk)};const {formatMonitoringDate,formatMonitoringSources,latestMonitoringTimestamp}=globalThis.__monitoringPresentation;`);
globalThis.__riskRules = rules;
const riskData = await moduleFrom("lib/climate-risk-data.ts", `const raw=${JSON.stringify(datasets.climateRisk)};const {alertStatus,riskLevel,riskRecommendations}=globalThis.__riskRules;`);
const table = await moduleFrom("lib/monitoring-table.ts");

test("rule engine covers thresholds, cutoff equality, invalid and null valid_until", () => {
  assert.deepEqual([1,5,6,10,11,15,16,25].map(score=>rules.riskThresholds.find(x=>score>=x.min&&score<=x.max).level), ["Rendah","Rendah","Sedang","Sedang","Tinggi","Tinggi","Kritis","Kritis"]);
  assert.equal(rules.alertStatus("Kritis",null,"2026-07-24"),"Belum tersedia");
  assert.equal(rules.alertStatus("Kritis","invalid","2026-07-24"),"Belum tersedia");
  assert.equal(rules.alertStatus("Kritis","2026-07-23","2026-07-24"),"Selesai/Kedaluwarsa");
  assert.equal(rules.alertStatus("Kritis","2026-07-24","2026-07-24"),"Kritis");
  assert.equal(rules.alertStatus("Tinggi","2026-07-25","2026-07-24"),"Siaga");
});

test("resolver safely rejects untrusted boundaries and resolves all five domains", () => {
  const invalid = [[undefined,"INVALID_REFERENCE"],[null,"INVALID_REFERENCE"],["x","INVALID_REFERENCE"],[[],"INVALID_REFERENCE"],[{},"INVALID_REFERENCE"],[{record_id:"x"},"INVALID_REFERENCE"],[{domain:null,record_id:"x"},"INVALID_REFERENCE"],[{domain:"unknown",record_id:"x"},"UNSUPPORTED_DOMAIN"],[{domain:"climate_risk"},"MISSING_RECORD_ID"],[{domain:"climate_risk",record_id:""},"MISSING_RECORD_ID"],[{domain:"climate_risk",record_id:"UNKNOWN"},"RECORD_NOT_FOUND"]];
  for (const [input,error] of invalid) assert.deepEqual(resolver.resolveMonitoringRecord(input), {ok:false,error});
  const refs = [["climate_risk","CR-MT2-0105"],["food_security","FS-MT2-0105"],["irrigation","IR-MT2-0105"],["production_inputs","PI-MT2-BENIH"],["production",datasets.production.records.find(x=>x.season_id==="MT2-2026").id]];
  for (const [domain,record_id] of refs) { const input={domain,record_id}, before=structuredClone(input), result=resolver.resolveMonitoringRecord(input); assert.equal(result.ok,true); assert.equal(result.record.domain,domain); assert.equal(result.record.record_id,record_id); assert.ok(result.record.label.includes("—")); assert.deepEqual(input,before); }
  assert.equal(resolver.resolveMonitoringRecord({domain:"irrigation",record_id:"CR-MT2-0105"}).error,"RECORD_NOT_FOUND");
  assert.equal(resolver.resolveMonitoringRecord({domain:"climate_risk",record_id:"CR-MT2-0105"},{season_id:"MT1-2026"}).error,"SEASON_MISMATCH");
  assert.equal(resolver.resolveMonitoringRecord({domain:"climate_risk",record_id:"CR-MT2-0105"},{region_id:"93.01.06"}).error,"REGION_MISMATCH");
});

test("activity validator consumes safe resolver and fails one malformed reference", () => {
  for (const activity of allActivities) { const result=resolver.validateCollaborationRelatedRecords(activity); assert.equal(result.valid,true,activity.id); assert.equal(result.resolvedCount,result.totalCount); if(activity.domain==="Irigasi") assert.ok(activity.related_records.some(x=>x.domain==="irrigation")); }
  for (const activity of [{...allActivities[0],season_id:"MT1-2026"},{...allActivities[0],region_id:"93.01.06"},{...allActivities[0],related_records:[null]}]) assert.equal(resolver.validateCollaborationRelatedRecords(activity).valid,false);
});

test("production resolver core executes NOT_MONITORED without mutating controlled sources", () => {
  const base={season_id:"MT2-2026",region_id:"93.01.05",validation_status:"approved",source_type:"prototype",data_type:"simulation",risk_type:"Kekeringan"};
  const registry={climate_risk:[{...base,id:"CR-MONITORED",monitoring_status:"monitored"},{...base,id:"CR-NOT-MONITORED",monitoring_status:"not_monitored"}],food_security:[],irrigation:[],production_inputs:[],production:[]},before=structuredClone(registry);
  const reference={domain:"climate_risk",record_id:"CR-NOT-MONITORED"},first=resolver.resolveMonitoringRecordWithSources(reference,registry),second=resolver.resolveMonitoringRecordWithSources(reference,registry);
  assert.deepEqual(first,{ok:false,error:"NOT_MONITORED"});assert.deepEqual(second,first);assert.deepEqual(registry,before);
  const activity={domain:"Risiko & Iklim",season_id:"MT2-2026",region_id:"93.01.05",related_records:[{domain:"climate_risk",record_id:"CR-MONITORED"},reference]},resolved=resolver.resolveCollaborationRelatedRecords(activity,registry),validation=resolver.validateCollaborationRelatedRecords(activity,registry);
  assert.deepEqual(resolved.map(x=>x.result.ok),[true,false]);assert.equal(validation.valid,false);assert.equal(validation.resolvedCount,1);assert.equal(validation.totalCount,2);
});

test("network builds deduplicated real edges and changes with context", () => {
  const repeated=[allActivities[0],{...allActivities[0],id:"COPY"}], network=collaboration.buildCollaborationNetwork(repeated);
  assert.equal(network.edges.length,2); assert.ok(network.edges.every(x=>x.activityCount===2&&x.activityIds.length===2)); assert.equal(network.nodes.length,3); assert.ok(!network.edges.some(x=>x.sourceInstitutionId===x.targetInstitutionId)); assert.match(network.accessibleSummary,/berkoordinasi dengan/);
  const mt1=collaboration.buildCollaborationNetwork(collaboration.selectCollaborations("MT1-2026","93.01.01").items), mt2=collaboration.buildCollaborationNetwork(collaboration.selectCollaborations("MT2-2026","93.01.05").items); assert.notDeepEqual(mt1.edges,mt2.edges); assert.deepEqual(collaboration.buildCollaborationNetwork([]),{nodes:[],edges:[],accessibleSummary:"Belum ada hubungan kegiatan pada konteks terpilih."});
});

test("network contexts and three layout sizes are bounded and non-overlapping", () => {
  const contexts=[["MT2-2026","93.01",7,8],["MT1-2026","93.01",5,4],["MT2-2026","93.01.05",3,2]];
  for(const[season,region,nodeCount,edgeCount]of contexts){const network=collaboration.buildCollaborationNetwork(collaboration.selectCollaborations(season,region).items);assert.equal(network.nodes.length,nodeCount);assert.equal(network.edges.length,edgeCount);for(const[width,height]of[[1000,500],[700,420],[360,500]]){const a=collaboration.layoutCollaborationNetwork(network.nodes,width,height),b=collaboration.layoutCollaborationNetwork(network.nodes,width,height);assert.deepEqual(a,b);for(const node of a)assert.ok(Number.isFinite(node.x)&&Number.isFinite(node.y)&&node.x-58>=0&&node.x+58<=width&&node.y-28>=0&&node.y+28<=height);for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)assert.ok(Math.abs(a[i].x-a[j].x)>=116||Math.abs(a[i].y-a[j].y)>=56,`${season} ${width}x${height}: ${a[i].id}/${a[j].id}`);const positions=new Map(a.map(x=>[x.id,x]));for(const edge of network.edges)assert.ok(edge.sourceInstitutionId!==edge.targetInstitutionId&&positions.has(edge.sourceInstitutionId)&&positions.has(edge.targetInstitutionId));}}
});

test("collaboration and county risk aggregates remain canonical", () => {
  const selected=collaboration.selectCollaborations("MT2-2026"), aggregate=selected.aggregate; assert.equal(aggregate.involvedInstitutionCount,new Set(selected.items.flatMap(x=>[x.coordinator_institution_id,...x.participant_institution_ids])).size); assert.deepEqual([aggregate.activeProgramCount,aggregate.completedProgramCount,aggregate.monitoredRecordCount,aggregate.approvedRecordCount,aggregate.validationPercent,aggregate.averageProgress],[3,1,4,3,75,63.75]); assert.equal(aggregate.latestUpdate,"2026-07-24T22:42:00+09:00");
  const rows=datasets.climateRisk.records.filter(x=>x.season_id==="MT2-2026").map(riskData.enrichRisk), risk=riskData.aggregateClimateRiskMetrics(rows); assert.deepEqual([risk.monitoredRecordCount,risk.approvedRecordCount,risk.affectedAreaHa,risk.dominantRisk],[6,5,2345,"Kekeringan"]); assert.equal(risk.validationPercent,5/6*100); assert.match(risk.dominantRiskMethod,/risk_score/);
});

test("early-warning taxonomy and affected-area definition come from production records", () => {
  const sourceTypes = [...new Set(datasets.climateRisk.records.map(row => row.risk_type))];
  assert.deepEqual(riskData.climateRiskTypeOptions, sourceTypes);
  assert.ok(riskData.climateRiskTypeOptions.includes("Gangguan produksi"));
  assert.equal(riskData.climateRiskIndicatorDefinition.id, "early_warning_affected_area");
  assert.notEqual(riskData.climateRiskIndicatorDefinition.id, "mapped_planting_risk_classification");
  for (const seasonId of ["MT1-2026", "MT2-2026"]) {
    const selected = riskData.selectClimateRisks(seasonId);
    assert.equal(selected.items.filter(row => row.risk_type === "Gangguan produksi").length, 1);
  }
  assert.equal(riskData.selectClimateRisks("MT2-2026").aggregate.affectedAreaHa, 2345);
});

test("map and early-warning labels cannot collapse target, realization, and affected area", async () => {
  const [page, riskPage] = await Promise.all([readFile("app/page.tsx", "utf8"), readFile("components/risk/RiskClimatePage.tsx", "utf8")]);
  assert.doesNotMatch(page, /LAHAN AKTIF MT II/);
  assert.match(page, /TARGET LUAS TANAM/);
  assert.match(page, /aggregate\.planting_realization_ha/);
  assert.match(page, /mappedLandRiskDefinition\.description/);
  assert.match(riskPage, /climateRiskIndicatorDefinition\.label/);
  assert.match(riskPage, /climateRiskTypeOptions/);
  assert.doesNotMatch(riskPage, /\["Kekeringan","Banjir\/genangan","Hama dan penyakit"/);
});

test("sorting matrix is stable, immutable and null-last both directions", () => {
  const rows=datasets.climateRisk.records.slice(0,4).map((x,i)=>({...x,risk_type:i===2?null:x.risk_type,affected_area_ha:i===1?null:i===3?Number.NaN:x.affected_area_ha,valid_until:i===1?"invalid":x.valid_until})), before=structuredClone(rows);
  for(const direction of["asc","desc"]){const text=table.stableSort(rows,x=>x.risk_type,direction),number=table.stableSort(rows,x=>x.affected_area_ha,direction),date=table.stableSort(rows,x=>table.dateSortValue(x.valid_until),direction);assert.equal(text.at(-1).risk_type,null);assert.ok(number.at(-1).affected_area_ha===null||!Number.isFinite(number.at(-1).affected_area_ha));assert.equal(table.dateSortValue(date.at(-1).valid_until),null);}
  assert.deepEqual(rows,before); const activities=[...allActivities,{...allActivities[0],id:"stable-copy",title:allActivities[0].title,progress_percent:0,due_date:null}]; assert.deepEqual(table.stableSort(activities,x=>x.title,"asc").filter(x=>x.title===allActivities[0].title).map(x=>x.id),[allActivities[0].id,"stable-copy"]); assert.equal(table.stableSort(activities,x=>x.progress_percent,"asc")[0].progress_percent,0); assert.equal(table.stableSort(activities,x=>table.dateSortValue(x.due_date),"desc").at(-1).due_date,null);
});

test("pagination covers empty, first, middle, last and invalid size", () => {
  const rows=[1,2,3,4,5], first=table.paginate(rows,0,2), middle=table.paginate(rows,2,2), last=table.paginate(rows,99,2), empty=table.paginate([],1,2);
  assert.deepEqual([first.items,first.page,first.pageCount,first.start,first.end,first.hasPrevious,first.hasNext],[[1,2],1,3,1,2,false,true]); assert.deepEqual([middle.items,middle.page,middle.start,middle.end,middle.hasPrevious,middle.hasNext],[[3,4],2,3,4,true,true]); assert.deepEqual([last.items,last.page,last.start,last.end,last.hasPrevious,last.hasNext],[[5],3,5,5,true,false]); assert.deepEqual([empty.items,empty.start,empty.end,empty.pageCount],[[],0,0,1]); assert.equal(table.paginate(rows,1,0).pageSize,1);
});

test("collaboration date formatting is deterministic and modal metadata source is complete", async () => {
  assert.equal(collaboration.formatCollaborationDate("2026-07-24"),"24 Juli 2026"); assert.equal(collaboration.formatCollaborationDate("invalid"),null); assert.equal(collaboration.formatCollaborationDate("2026-02-31"),null);
  const page=await readFile("components/collaboration/CollaborationPage.tsx","utf8"); for(const text of["ID kegiatan","Judul kegiatan","Tanggal mulai","Tenggat","Tanggal selesai","Status monitoring","Status resolusi"]) assert.ok(page.includes(text)); assert.ok(!page.includes("Related records valid"));
});

test("collaboration domain taxonomy and institution sources come from production records", async () => {
  const expected=[...new Set(allActivities.map(item=>item.domain))];
  assert.deepEqual(collaboration.collaborationDomainOptions,expected);
  assert.ok(collaboration.collaborationDomainOptions.includes("Validasi Data"));
  assert.deepEqual(collaboration.selectCollaborations("MT1-2026").items.filter(item=>item.domain==="Validasi Data").map(item=>item.id),["COL-MT1-001"]);
  const sources=collaboration.collaborationActivitySources([allActivities[0],allActivities[0]]);
  assert.equal(sources,"Sekretariat Daerah; Dinas PUPR; Dinas Pertanian");
  const page=await readFile("components/collaboration/CollaborationPage.tsx","utf8");
  assert.match(page,/collaborationDomainOptions\.map/);assert.doesNotMatch(page,/new Set\(selected\.items\.map\(item=>item\.domain\)/);
});
