import foodSecurityJson from "@/data/monitoring/food-security-monitoring.json";
import { aggregateRegion, getSeasonById, millingYield, regions } from "@/lib/data-foundation";
import type { ChartDataPoint } from "@/lib/chart-data";

export type FoodSecurityRecord = (typeof foodSecurityJson.records)[number];
export type FoodSecurityMonthlySnapshot = {
  id: string;
  season_id: string;
  region_id: string;
  period: string;
  stage_index: number;
  status: "actual" | "not_available";
  availability_balance_ton: number | null;
  period_need_ton: number | null;
  physical_stock_ton: number | null;
  surplus_deficit_ton: number | null;
  data_type: "simulation";
  monitoring_status: "monitored";
  validation_status: string;
  updated_at: string;
  source_type: "prototype";
};
export type FoodSecurityMetrics = {
  record: FoodSecurityRecord;
  productionGkgTon: number;
  physicalStockTon: number;
  estimatedRiceProductionTon: number;
  annualNeedTon: number;
  seasonNeedTon: number;
  balanceAvailabilityTon: number;
  surplusDeficitTon: number;
  dailyNeedTon: number | null;
  stockResilienceDays: number | null;
};
export type FoodSecurityDetailModel = {
  scopeType: "regency" | "district";
  regionId: string;
  regionName: string;
  seasonId: string;
  seasonLabel: string;
  cutoff: string;
  monitoringStatus: "monitored";
  validationStatus: "approved" | "pending" | "mixed";
  sourceType: "prototype";
  dataType: "simulation";
  sourceReference: string;
  updatedAt: string;
  bulogStockTon: number;
  governmentReserveTon: number;
  localWarehouseStockTon: number;
  physicalStockTon: number;
  productionGkgTon: number;
  estimatedRiceProductionTon: number;
  inboundSupplyTon: number;
  outboundSupplyTon: number;
  operationalLossTon: number;
  netSupplyTon: number;
  balanceAvailabilityTon: number;
  seasonNeedTon: number;
  surplusDeficitTon: number;
  dailyNeedTon: number | null;
  stockResilienceDays: number | null;
};

export const foodSecurityFormula = {
  physicalStock: "Stok fisik = stok Bulog + cadangan pemerintah + stok gudang lokal.",
  riceProduction: `Estimasi beras = produksi GKG × rendemen ${millingYield.rate.toLocaleString("id-ID")}% (presisi penuh).`,
  availability: "Ketersediaan = stok fisik + estimasi beras + pasokan masuk − pasokan keluar − susut operasional.",
  requirement: "Kebutuhan periode = populasi × konsumsi 92,4 kg/kapita/tahun × jumlah hari periode ÷ 365 ÷ 1.000.",
  surplus: "Surplus/defisit = ketersediaan − kebutuhan periode.",
  stockResilience: "Ketahanan stok = stok fisik ÷ kebutuhan harian.",
  rounding: "Perhitungan dan agregasi memakai presisi penuh; pembulatan hanya dilakukan saat nilai ditampilkan.",
} as const;

export const foodSecurityMetadata = foodSecurityJson.metadata;
export const foodSecurityRecords = foodSecurityJson.records as FoodSecurityRecord[];
export const resilienceWeights = {
  availability: 0.30,
  productionAchievement: 0.25,
  irrigationReadiness: 0.20,
  productionInputFulfillment: 0.15,
  validation: 0.10,
} as const;
export const resilienceDisclaimer = "Simulasi Prototipe — bukan IKP resmi Badan Pangan Nasional";

const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
const durationDays = (seasonId: string) => {
  const season = getSeasonById(seasonId);
  if (!season) return null;
  const days = Math.floor((Date.parse(season.end_date) - Date.parse(season.start_date)) / 86400000) + 1;
  return Number.isFinite(days) && days > 0 ? days : null;
};

export function calculateFoodSecurity(record: FoodSecurityRecord): FoodSecurityMetrics | null {
  const required = [record.population, record.annual_consumption_kg_per_capita, record.bulog_stock_ton, record.government_reserve_ton, record.local_warehouse_stock_ton, record.inbound_supply_ton, record.outbound_supply_ton, record.operational_loss_ton];
  const days = durationDays(record.season_id);
  if (record.monitoring_status !== "monitored" || !required.every(finiteNonNegative) || !days) return null;
  const production = aggregateRegion(record.region_id, record.season_id);
  const physicalStockTon = record.bulog_stock_ton + record.government_reserve_ton + record.local_warehouse_stock_ton;
  const estimatedRiceProductionTon = production.gkg_production_ton * (millingYield.rate / 100);
  const annualNeedTon = record.population * record.annual_consumption_kg_per_capita / 1000;
  const seasonNeedTon = annualNeedTon * days / 365;
  const balanceAvailabilityTon = physicalStockTon + estimatedRiceProductionTon + record.inbound_supply_ton - record.outbound_supply_ton - record.operational_loss_ton;
  const dailyNeedTon = annualNeedTon > 0 ? annualNeedTon / 365 : null;
  return {
    record, productionGkgTon: production.gkg_production_ton, physicalStockTon, estimatedRiceProductionTon, annualNeedTon, seasonNeedTon,
    balanceAvailabilityTon, surplusDeficitTon: balanceAvailabilityTon - seasonNeedTon,
    dailyNeedTon, stockResilienceDays: dailyNeedTon ? physicalStockTon / dailyNeedTon : null,
  };
}

export function selectFoodSecurity(seasonId: string, regionId = "93.01", validation = "all") {
  const districtIds = regionId === "93.01"
    ? new Set(regions.filter(region => region.parent_id === "93.01" && region.administrative_type === "district").map(region => region.id))
    : new Set([regionId]);
  const records = foodSecurityRecords.filter(record => record.season_id === seasonId && districtIds.has(record.region_id) && (validation === "all" || record.validation_status === validation));
  const items = records.map(calculateFoodSecurity).filter((item): item is FoodSecurityMetrics => item !== null);
  if (!items.length) return { monitored: false, items: [], aggregate: null };
  const total = (field: keyof Omit<FoodSecurityMetrics, "record">) => items.reduce((sum, item) => sum + (typeof item[field] === "number" ? item[field] : 0), 0);
  const annualNeedTon = total("annualNeedTon");
  const physicalStockTon = total("physicalStockTon");
  const aggregate = {
    bulogStockTon: items.reduce((sum, item) => sum + item.record.bulog_stock_ton, 0),
    governmentReserveTon: items.reduce((sum, item) => sum + item.record.government_reserve_ton, 0),
    localWarehouseStockTon: items.reduce((sum, item) => sum + item.record.local_warehouse_stock_ton, 0),
    physicalStockTon,
    productionGkgTon: total("productionGkgTon"),
    estimatedRiceProductionTon: total("estimatedRiceProductionTon"),
    inboundSupplyTon: items.reduce((sum, item) => sum + item.record.inbound_supply_ton, 0),
    outboundSupplyTon: items.reduce((sum, item) => sum + item.record.outbound_supply_ton, 0),
    operationalLossTon: items.reduce((sum, item) => sum + item.record.operational_loss_ton, 0),
    population: items.reduce((sum, item) => sum + item.record.population, 0),
    annualNeedTon,
    seasonNeedTon: total("seasonNeedTon"),
    balanceAvailabilityTon: total("balanceAvailabilityTon"),
    surplusDeficitTon: total("surplusDeficitTon"),
    stockResilienceDays: annualNeedTon > 0 ? physicalStockTon / (annualNeedTon / 365) : null,
    approved: records.filter(record => record.validation_status === "approved").length,
    total: records.length,
  };
  return { monitored: true, items, aggregate };
}

export function buildFoodSecurityDetailModel(seasonId: string, regionId = "93.01"): FoodSecurityDetailModel | null {
  const selected = selectFoodSecurity(seasonId, regionId);
  if (!selected.monitored || !selected.aggregate) return null;
  const season = getSeasonById(seasonId);
  const region = regions.find(item => item.id === regionId);
  if (!season || !region) return null;
  const records = selected.items.map(item => item.record);
  const district = regionId === "93.01" ? null : selected.items[0];
  if (regionId !== "93.01" && !district) return null;
  const aggregate = selected.aggregate;
  const validationStatus = aggregate.approved === aggregate.total ? "approved" : aggregate.approved === 0 ? "pending" : "mixed";
  const sourceReference = [...new Set(records.map(record => record.source_reference))].join("; ");
  return {
    scopeType: regionId === "93.01" ? "regency" : "district",
    regionId,
    regionName: regionId === "93.01" ? "Kabupaten Merauke" : region.name,
    seasonId,
    seasonLabel: seasonId === "MT1-2026" ? "MT I 2026" : "MT II 2026",
    cutoff: records.map(record => record.monitoring_date).sort().at(-1) ?? season.end_date,
    monitoringStatus: "monitored",
    validationStatus,
    sourceType: "prototype",
    dataType: "simulation",
    sourceReference,
    updatedAt: records.map(record => record.updated_at).sort().at(-1) ?? "",
    bulogStockTon: aggregate.bulogStockTon,
    governmentReserveTon: aggregate.governmentReserveTon,
    localWarehouseStockTon: aggregate.localWarehouseStockTon,
    physicalStockTon: aggregate.physicalStockTon,
    productionGkgTon: aggregate.productionGkgTon,
    estimatedRiceProductionTon: aggregate.estimatedRiceProductionTon,
    inboundSupplyTon: aggregate.inboundSupplyTon,
    outboundSupplyTon: aggregate.outboundSupplyTon,
    operationalLossTon: aggregate.operationalLossTon,
    netSupplyTon: aggregate.inboundSupplyTon - aggregate.outboundSupplyTon - aggregate.operationalLossTon,
    balanceAvailabilityTon: aggregate.balanceAvailabilityTon,
    seasonNeedTon: aggregate.seasonNeedTon,
    surplusDeficitTon: aggregate.surplusDeficitTon,
    dailyNeedTon: aggregate.annualNeedTon > 0 ? aggregate.annualNeedTon / 365 : null,
    stockResilienceDays: aggregate.stockResilienceDays,
  };
}

const snapshotCurve = foodSecurityJson.metadata.monthly_snapshot_curve;

export function buildFoodSecurityMonthlySnapshots(validation = "all"): FoodSecurityMonthlySnapshot[] {
  const districts = foodSecurityRecords.filter(record => validation === "all" || record.validation_status === validation);
  const districtSnapshots = districts.flatMap(record => {
    const metrics = calculateFoodSecurity(record);
    if (!metrics) return [];
    const curve = snapshotCurve[record.season_id as keyof typeof snapshotCurve];
    return curve.map(stage => {
      const available = stage.status === "actual" && stage.allocation !== null;
      const availability = available ? metrics.balanceAvailabilityTon * stage.allocation : null;
      const need = available ? metrics.seasonNeedTon * stage.allocation : null;
      return {
        id: `FSMS-${record.region_id.replaceAll(".", "")}-${record.season_id}-${stage.period}`,
        season_id: record.season_id,
        region_id: record.region_id,
        period: stage.period,
        stage_index: stage.stage_index,
        status: stage.status as FoodSecurityMonthlySnapshot["status"],
        availability_balance_ton: availability,
        period_need_ton: need,
        physical_stock_ton: available ? metrics.physicalStockTon * stage.allocation : null,
        surplus_deficit_ton: availability !== null && need !== null ? availability - need : null,
        data_type: "simulation" as const,
        monitoring_status: "monitored" as const,
        validation_status: record.validation_status,
        updated_at: record.updated_at,
        source_type: "prototype" as const,
      };
    });
  });
  const countySnapshots = (Object.keys(snapshotCurve) as Array<keyof typeof snapshotCurve>).flatMap(seasonId =>
    snapshotCurve[seasonId].map(stage => {
      const rows = districtSnapshots.filter(row => row.season_id === seasonId && row.stage_index === stage.stage_index);
      const sum = (field: "availability_balance_ton" | "period_need_ton" | "physical_stock_ton" | "surplus_deficit_ton") =>
        stage.status === "actual" ? rows.reduce((total, row) => total + (row[field] ?? 0), 0) : null;
      return {
        id: `FSMS-9301-${seasonId}-${stage.period}`,
        season_id: seasonId,
        region_id: "93.01",
        period: stage.period,
        stage_index: stage.stage_index,
        status: stage.status as FoodSecurityMonthlySnapshot["status"],
        availability_balance_ton: sum("availability_balance_ton"),
        period_need_ton: sum("period_need_ton"),
        physical_stock_ton: sum("physical_stock_ton"),
        surplus_deficit_ton: sum("surplus_deficit_ton"),
        data_type: "simulation" as const,
        monitoring_status: "monitored" as const,
        validation_status: validation,
        updated_at: foodSecurityRecords[0]?.updated_at ?? "2026-07-24T22:42:00+09:00",
        source_type: "prototype" as const,
      };
    })
  );
  return [...countySnapshots, ...districtSnapshots];
}

export const foodSecurityMonthlySnapshots = buildFoodSecurityMonthlySnapshots();

export function foodAvailabilityScore(metrics: ReturnType<typeof selectFoodSecurity>["aggregate"]) {
  if (!metrics || metrics.seasonNeedTon <= 0) return null;
  return Math.max(0, Math.min(100, metrics.balanceAvailabilityTon / metrics.seasonNeedTon * 100));
}

export function getFoodSecurityChartData(seasonId: string, regionId = "93.01", validation = "all"): ChartDataPoint[] {
  const monthNames = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const snapshots = buildFoodSecurityMonthlySnapshots(validation)
    .filter(row => row.season_id === seasonId && row.region_id === regionId)
    .sort((left, right) => left.stage_index - right.stage_index);
  const lastActualStage = Math.max(0, ...snapshots.filter(row => row.status === "actual").map(row => row.stage_index));
  return snapshots.map(row => ({
    id: row.id,
    period: row.period,
    label: `${monthNames[Number(row.period.slice(5,7))-1]} ${row.period.slice(0,4)}`,
    stageIndex: row.stage_index,
    target: row.period_need_ton,
    actual: row.status === "actual" ? row.availability_balance_ton : null,
    projection: null,
    status: row.status as ChartDataPoint["status"],
    isCutoff: row.stage_index === lastActualStage,
  }));
}

export function formatFoodValue(value: number | null, unit: "ton" | "hari" | "%" = "ton") {
  return value === null || !Number.isFinite(value) ? "Belum tersedia" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${unit}`;
}
