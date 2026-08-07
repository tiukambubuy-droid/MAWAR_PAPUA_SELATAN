import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const readJson = async file => JSON.parse(await readFile(file,"utf8"));
const [foodJson,irrigationJson,inputsJson,regionsJson,master,productionJson] = await Promise.all([
  readJson("data/monitoring/food-security-monitoring.json"), readJson("data/monitoring/irrigation-monitoring.json"),
  readJson("data/monitoring/production-inputs-monitoring.json"), readJson("data/master/regions.json"),
  readJson("data/master/data-foundation.json"), readJson("data/monitoring/production-monitoring.json"),
]);

async function load(file,preamble) {
  const source=await readFile(file,"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;$/gm,"");
  return import(`data:text/javascript;base64,${Buffer.from(`${preamble}\n${output}`).toString("base64")}`);
}
const descendants=id=>{const direct=regionsJson.regions.filter(row=>row.parent_id===id);return [...direct,...direct.flatMap(row=>descendants(row.id))]};
const aggregateRegion=(regionId,seasonId)=>{
  const ids=new Set([regionId,...descendants(regionId).map(row=>row.id)]);
  return productionJson.records.filter(row=>row.season_id===seasonId&&ids.has(row.region_id)&&row.validation_status==="approved").reduce((sum,row)=>({gkg_production_ton:sum.gkg_production_ton+row.gkg_production_ton,gkg_production_target_ton:sum.gkg_production_target_ton+row.gkg_production_target_ton}),{gkg_production_ton:0,gkg_production_target_ton:0});
};
const food=await load("lib/food-security-data.ts",`const foodSecurityJson=${JSON.stringify(foodJson)};const regions=${JSON.stringify(regionsJson.regions)};const millingYield=${JSON.stringify(master.milling_yield)};const seasons=${JSON.stringify(master.seasons)};const getSeasonById=id=>seasons.find(row=>row.season_id===id)||null;const aggregateRegion=${aggregateRegion.toString()};const descendants=${descendants.toString()};const productionJson=${JSON.stringify(productionJson)};const regionsJson=${JSON.stringify(regionsJson)};`);
const infra=await load("lib/infrastructure-data.ts",`const irrigationJson=${JSON.stringify(irrigationJson)};const inputsJson=${JSON.stringify(inputsJson)};const regions=${JSON.stringify(regionsJson.regions)};`);

async function actualResilience(seasonId,regionId="93.01") {
  const foodSelected=food.selectFoodSecurity(seasonId,regionId);
  const irrigationSelected=infra.selectIrrigation(seasonId,regionId);
  const inputSelected=infra.selectProductionInputs(seasonId,regionId);
  const production=aggregateRegion(regionId,seasonId);
  const preamble=`const resilienceWeights=${JSON.stringify(food.resilienceWeights)};const millingYield=${JSON.stringify(master.milling_yield)};const foodSelected=${JSON.stringify(foodSelected)};const irrigationSelected=${JSON.stringify(irrigationSelected)};const inputSelected=${JSON.stringify(inputSelected)};const production=${JSON.stringify(production)};const selectFoodSecurity=()=>foodSelected;const selectIrrigation=()=>irrigationSelected;const selectProductionInputs=()=>inputSelected;const aggregateRegion=()=>production;const foodAvailabilityScore=metrics=>!metrics||metrics.seasonNeedTon<=0?null:Math.max(0,Math.min(100,metrics.balanceAvailabilityTon/metrics.seasonNeedTon*100));const calculateEstimatedRice=value=>value*(millingYield.rate/100);`;
  const resilienceModule=await load("lib/resilience-data.ts",preamble);
  return { result:resilienceModule.selectOperationalResilience(seasonId,regionId), resilienceModule, foodSelected, irrigationSelected, inputSelected, production };
}

test("resilience facade reconciles full-precision canonical production and five displayed components",async()=>{
  const mt1=await actualResilience("MT1-2026"),mt2=await actualResilience("MT2-2026"),semangga=await actualResilience("MT2-2026","93.01.05");
  assert.equal(Number(mt1.result.components.productionAchievement.toFixed(1)),99.1);
  assert.equal(Number(mt2.result.components.productionAchievement.toFixed(1)),88.5);
  assert.equal(Number(semangga.result.components.productionAchievement.toFixed(1)),88.3);
  assert.equal(Number(mt1.result.score.toFixed(1)),94.3);
  assert.equal(Number(mt2.result.score.toFixed(1)),91.5);
  assert.equal(Number(semangga.result.score.toFixed(1)),94.2);
  for(const context of [mt1,mt2,semangga]) assert.equal(context.result.score,context.resilienceModule.calculateResilienceScore(context.result.components));
  assert.equal(mt2.result.production.gkgProductionTon,174577);
  assert.equal(mt2.result.production.estimatedRiceTon,174577*0.6339);
  assert.equal(mt2.result.production.millingYieldPct,63.39);
});

test("irrigation readiness is service-area weighted functional level, separate from water adequacy",async()=>{
  const county=await actualResilience("MT2-2026"),semangga=await actualResilience("MT2-2026","93.01.05");
  assert.equal(semangga.result.components.irrigationReadiness,91);
  assert.equal(semangga.result.irrigation.waterAdequacyPct,87);
  assert.notEqual(semangga.result.components.irrigationReadiness,semangga.result.irrigation.waterAdequacyPct);
  const rows=county.irrigationSelected.items,totalArea=rows.reduce((sum,row)=>sum+row.service_area_ha,0);
  const weighted=rows.reduce((sum,row)=>sum+row.functional_pct*row.service_area_ha,0)/totalArea;
  assert.equal(county.result.components.irrigationReadiness,weighted);
});

test("food, irrigation, and inputs reconcile district records to county without mixing units",async()=>{
  for(const seasonId of ["MT1-2026","MT2-2026"]){
    const context=await actualResilience(seasonId),foodItems=context.foodSelected.items,irrigationItems=context.irrigationSelected.items;
    for(const field of ["physicalStockTon","estimatedRiceProductionTon","seasonNeedTon","balanceAvailabilityTon","surplusDeficitTon"])
      assert.ok(Math.abs(foodItems.reduce((sum,row)=>sum+row[field],0)-context.foodSelected.aggregate[field])<1e-9);
    const mappings={networkLengthKm:"network_length_km",serviceAreaHa:"service_area_ha",goodKm:"good_condition_km",lightDamageKm:"light_damage_km",heavyDamageKm:"heavy_damage_km"};
    for(const [aggregateField,rowField] of Object.entries(mappings)) assert.equal(irrigationItems.reduce((sum,row)=>sum+row[rowField],0),context.irrigationSelected.aggregate[aggregateField]);
    assert.equal(Object.hasOwn(context.inputSelected.aggregate,"totalQuantity"),false);
  }
  const mt2=await actualResilience("MT2-2026"),mt1=await actualResilience("MT1-2026");
  assert.deepEqual([mt2.result.irrigation.serviceAreaHa,mt2.result.irrigation.networkLengthKm,mt2.result.irrigation.goodKm,mt2.result.irrigation.lightDamageKm,mt2.result.irrigation.heavyDamageKm],[42000,367,245,85,37]);
  assert.deepEqual([mt1.result.irrigation.networkLengthKm,mt1.result.irrigation.goodKm,mt1.result.irrigation.lightDamageKm,mt1.result.irrigation.heavyDamageKm],[367,239,85,43]);
  assert.equal(Number(mt2.result.components.productionInputFulfillment.toFixed(1)),90.5);
  assert.equal(Number(mt2.result.components.validation.toFixed(1)),83.3);
});

test("not-monitored and missing mandatory components stay unavailable rather than verified zero",async()=>{
  const muting=await actualResilience("MT2-2026","93.01.02");
  assert.equal(muting.result.monitored,false);assert.equal(muting.result.complete,false);assert.equal(muting.result.score,null);
  assert.equal(muting.result.components.availability,null);assert.equal(muting.result.components.irrigationReadiness,null);assert.equal(muting.result.components.productionInputFulfillment,null);
  assert.equal(muting.resilienceModule.calculateResilienceScore({...muting.result.components,availability:0}),null);
  assert.equal(muting.resilienceModule.productionAchievementScore(NaN,100),null);
});
