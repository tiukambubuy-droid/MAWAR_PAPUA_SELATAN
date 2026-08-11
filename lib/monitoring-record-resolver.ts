import climateRisk from "@/data/monitoring/climate-risk-monitoring.json";
import foodSecurity from "@/data/monitoring/food-security-monitoring.json";
import irrigation from "@/data/monitoring/irrigation-monitoring.json";
import productionInputs from "@/data/monitoring/production-inputs-monitoring.json";
import production from "@/data/monitoring/production-monitoring.json";
import { getRegionById } from "@/lib/data-foundation";

export type MonitoringDomain = "climate_risk" | "food_security" | "irrigation" | "production_inputs" | "production";
export type RelatedRecordReference = { domain: MonitoringDomain; record_id: string; parent_scope?: boolean };
export type ResolvedMonitoringRecord = {
  domain: MonitoringDomain; record_id: string; label: string; season_id: string; region_id: string;
  regionLabel: string; monitoring_status: string; validation_status: string; source_type: string; data_type: string;
};
export type SourceRecord = { id: string; season_id: string; region_id: string; monitoring_status: string; validation_status: string; source_type: string; data_type: string; [key: string]: unknown };
export type MonitoringSourceRegistry = Record<MonitoringDomain, readonly SourceRecord[]>;

const sources: MonitoringSourceRegistry = {
  climate_risk: climateRisk.records,
  food_security: foodSecurity.records,
  irrigation: irrigation.records,
  production_inputs: productionInputs.records,
  production: production.records,
};
export type ResolveError = "INVALID_REFERENCE" | "UNSUPPORTED_DOMAIN" | "MISSING_RECORD_ID" | "RECORD_NOT_FOUND" | "SEASON_MISMATCH" | "REGION_MISMATCH" | "NOT_MONITORED";
export type ResolveContext = { season_id?: string; region_id?: string; parent_scope?: boolean };
export type ResolveResult = { ok: true; record: ResolvedMonitoringRecord } | { ok: false; error: ResolveError };
export function isMonitoringDomain(value: unknown): value is MonitoringDomain {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(sources, value);
}
export function isRelatedRecordReference(value: unknown): value is RelatedRecordReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isMonitoringDomain(candidate.domain) && typeof candidate.record_id === "string" && candidate.record_id.trim().length > 0;
}
export const monitoringDomainLabels: Record<MonitoringDomain, string> = {
  climate_risk: "Risiko & Iklim", food_security: "Ketahanan Pangan", irrigation: "Irigasi",
  production_inputs: "Sarana Produksi", production: "Produksi",
};
const activityDomains: Record<string, MonitoringDomain | null> = {
  "Risiko & Iklim": "climate_risk", "Ketahanan Pangan": "food_security", Irigasi: "irrigation",
  "Sarana Produksi": "production_inputs", Produksi: "production", "Validasi Data": null,
};
function recordLabel(domain: MonitoringDomain, record: SourceRecord) {
  const detail = domain === "climate_risk" ? record.risk_type
    : domain === "irrigation" ? record.network_name
    : domain === "production_inputs" ? record.item_name
    : domain === "food_security" ? "Snapshot ketahanan pangan"
    : "Realisasi produksi";
  return `${monitoringDomainLabels[domain]} — ${String(detail)} · ${getRegionById(record.region_id)?.name ?? record.region_id} · ${record.season_id.replace("MT1", "MT I").replace("MT2", "MT II")}`;
}
export function resolveMonitoringRecordWithSources(reference: unknown, registry: MonitoringSourceRegistry, context: ResolveContext = {}): ResolveResult {
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) return { ok: false, error: "INVALID_REFERENCE" };
  const candidate = reference as Record<string, unknown>;
  if (!isMonitoringDomain(candidate.domain)) return { ok: false, error: typeof candidate.domain === "string" ? "UNSUPPORTED_DOMAIN" : "INVALID_REFERENCE" };
  if (typeof candidate.record_id !== "string" || candidate.record_id.trim().length === 0) return { ok: false, error: "MISSING_RECORD_ID" };
  const domainSource = registry[candidate.domain];
  if (!Array.isArray(domainSource)) return { ok: false, error: "RECORD_NOT_FOUND" };
  const matches = domainSource.filter(record => record.id === candidate.record_id);
  if (matches.length !== 1) return { ok: false, error: "RECORD_NOT_FOUND" };
  const record = matches[0];
  if (record.monitoring_status === "not_monitored") return { ok: false, error: "NOT_MONITORED" };
  if (context.season_id && record.season_id !== context.season_id) return { ok: false, error: "SEASON_MISMATCH" };
  if (context.region_id && !isRegionCompatible(context.region_id, record.region_id, context.parent_scope)) return { ok: false, error: "REGION_MISMATCH" };
  return { ok: true, record: { domain: candidate.domain, record_id: record.id, label: recordLabel(candidate.domain, record), season_id: record.season_id,
    region_id: record.region_id, regionLabel: getRegionById(record.region_id)?.name ?? record.region_id,
    monitoring_status: record.monitoring_status, validation_status: record.validation_status, source_type: record.source_type, data_type: record.data_type } };
}
export function resolveMonitoringRecord(reference: unknown, context: ResolveContext = {}) { return resolveMonitoringRecordWithSources(reference, sources, context); }
export type CollaborationReferenceActivity = { domain: string; season_id: string; region_id: string; related_records: readonly unknown[] };
export function isRegionCompatible(activityRegion: string, recordRegion: string, parentScope = false) {
  if (activityRegion === recordRegion) return true;
  if (activityRegion === "93.01" && recordRegion.startsWith("93.01.")) return true;
  return parentScope && recordRegion === "93.01" && activityRegion.startsWith("93.01.");
}
export function resolveCollaborationRelatedRecords(activity: CollaborationReferenceActivity, registry: MonitoringSourceRegistry = sources) {
  return activity.related_records.map(rawReference => { const reference = isRelatedRecordReference(rawReference) ? rawReference : null; const result = resolveMonitoringRecordWithSources(rawReference, registry, { season_id: activity.season_id, region_id: activity.region_id, parent_scope: reference?.parent_scope }); return { rawReference, reference, result, record: result.ok ? result.record : null }; });
}
export function validateCollaborationRelatedRecords(activity: CollaborationReferenceActivity, registry: MonitoringSourceRegistry = sources) {
  const resolved = resolveCollaborationRelatedRecords(activity, registry);
  const requiredDomain = activityDomains[activity.domain];
  const valid = resolved.filter(({ result }) => result.ok);
  const hasRequiredDomain = requiredDomain === null || valid.some(item => item.reference?.domain === requiredDomain);
  return { valid: valid.length === resolved.length && hasRequiredDomain, resolvedCount: valid.length, totalCount: resolved.length, items: resolved };
}

export function monitoringRecordCounts() {
  return Object.fromEntries(Object.entries(sources).map(([domain, records]) => [domain, records.length]));
}
