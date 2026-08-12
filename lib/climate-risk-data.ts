import raw from "@/data/monitoring/climate-risk-monitoring.json";
import { alertStatus, riskLevel, riskRecommendations } from "@/lib/early-warning-rules";
type RawClimateRiskRecord = (typeof raw.records)[number];
export type ClimateRiskRecord = RawClimateRiskRecord & { risk_score: number; risk_level: string; alert_status: string; recommendations: string[] };
export const climateRiskMetadata = raw.metadata;
export const climateRiskRecords = raw.records;
export const climateRiskTypeOptions = [...new Set(climateRiskRecords.map(record => record.risk_type))];
export const climateRiskIndicatorDefinition = {
  id: "early_warning_affected_area",
  label: "Luas terdampak early warning",
  description: "Jumlah luas terdampak pada record early warning terpantau dalam konteks aktif; bukan seluruh luas tanam.",
  formula: "Jumlah affected_area_ha dari record early warning terpantau.",
  unit: "ha",
} as const;
export function enrichRisk(r: RawClimateRiskRecord): ClimateRiskRecord { const score = r.likelihood * r.impact, level = riskLevel(r.likelihood, r.impact); return { ...r, risk_score: score, risk_level: level, alert_status: alertStatus(level, r.valid_until, raw.metadata.cutoff_date), recommendations: riskRecommendations(r) }; }
export function aggregateClimateRiskMetrics(records: readonly ClimateRiskRecord[]) {
  const monitored = records.filter(r => r.monitoring_status !== "not_monitored");
  const composition = ["Rendah", "Sedang", "Tinggi", "Kritis"].map(level => ({ level, count: monitored.filter(r => r.risk_level === level).length }));
  const byType = new Map<string, { score: number; area: number; firstId: string }>();
  for (const record of monitored) { const current = byType.get(record.risk_type) ?? { score: 0, area: 0, firstId: record.id }; current.score += record.risk_score; current.area += record.affected_area_ha ?? 0; if (record.id < current.firstId) current.firstId = record.id; byType.set(record.risk_type, current); }
  const dominantRisk = [...byType].sort((a, b) => b[1].score - a[1].score || b[1].area - a[1].area || a[1].firstId.localeCompare(b[1].firstId))[0]?.[0] ?? "Belum tersedia";
  const approvedRecordCount = monitored.filter(r => r.validation_status === "approved").length;
  const latestUpdate = monitored.map(r => r.updated_at).sort().at(-1) ?? null;
  return { activeAlertCount: monitored.filter(r => !["Normal", "Selesai/Kedaluwarsa", "Belum tersedia"].includes(r.alert_status)).length,
    severeRegionCount: new Set(monitored.filter(r => ["Tinggi", "Kritis"].includes(r.risk_level)).map(r => r.region_id)).size,
    affectedAreaHa: monitored.reduce((sum, r) => sum + (r.affected_area_ha ?? 0), 0), dominantRisk,
    dominantRiskMethod: "Jumlah risk_score; tie-break luas terdampak lalu ID", validationPercent: monitored.length ? approvedRecordCount / monitored.length * 100 : null,
    monitoredRecordCount: monitored.length, approvedRecordCount, latestUpdate, riskComposition: composition,
    climateSummary: "Indikator iklim tersedia per record dan tidak dirata-ratakan lintas jenis risiko." };
}
export function selectClimateRisks(seasonId: string, regionId = "93.01") { const items = climateRiskRecords.filter(r => r.season_id === seasonId && (regionId === "93.01" || r.region_id === regionId)).map(enrichRisk); return { monitored: items.length > 0, items, aggregate: items.length ? aggregateClimateRiskMetrics(items) : null }; }
