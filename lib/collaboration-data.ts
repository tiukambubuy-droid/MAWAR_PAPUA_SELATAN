import raw from "@/data/monitoring/collaboration-monitoring.json";
import climateRisk from "@/data/monitoring/climate-risk-monitoring.json";
import type { RelatedRecordReference } from "@/lib/monitoring-record-resolver";
export const institutions = raw.institutions;
type RawActivity = (typeof raw.activities)[number] | (typeof raw.activities_mt1)[number];
export type CollaborationActivity = Omit<RawActivity, "related_records"> & { related_records: RelatedRecordReference[] };
export const collaborationActivities = [...raw.activities, ...raw.activities_mt1] as CollaborationActivity[];
export const collaborationCutoff = raw.metadata.cutoff_date;
const monthNames = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
export function formatCollaborationDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number), days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= days ? `${day} ${monthNames[month-1]} ${year}` : null;
}
export function institution(id: string) { return institutions.find(x => x.id === id) ?? null; }
export type CollaborationMetrics = ReturnType<typeof aggregateCollaborationMetrics>;
export function aggregateCollaborationMetrics(activities: readonly CollaborationActivity[]) {
  const monitored = activities.filter(x => x.monitoring_status !== "not_monitored");
  const involved = new Set(monitored.flatMap(x => [x.coordinator_institution_id, ...x.participant_institution_ids]));
  const approvedRecordCount = monitored.filter(x => x.validation_status === "approved").length;
  return { involvedInstitutionCount: involved.size, activeProgramCount: monitored.filter(x => ["Berjalan", "Tertunda"].includes(x.status)).length,
    completedProgramCount: monitored.filter(x => x.status === "Selesai").length,
    averageProgress: monitored.length ? monitored.reduce((sum, x) => sum + x.progress_percent, 0) / monitored.length : null,
    highCriticalPriorityCount: monitored.filter(x => ["Tinggi", "Kritis"].includes(x.priority)).length,
    validationPercent: monitored.length ? approvedRecordCount / monitored.length * 100 : null,
    latestUpdate: monitored.map(x => x.updated_at).sort().at(-1) ?? null, monitoredRecordCount: monitored.length, approvedRecordCount };
}
export function selectCollaborations(seasonId: string, regionId = "93.01") {
  const items = collaborationActivities.filter(x => x.season_id === seasonId && (regionId === "93.01" || x.region_id === regionId));
  const monitored = regionId === "93.01" || climateRisk.records.some(x => x.season_id === seasonId && x.region_id === regionId && x.monitoring_status !== "not_monitored");
  return { monitored, items, aggregate: aggregateCollaborationMetrics(items) };
}
export type CollaborationNode = { id: string; label: string; role: string; institutionType: string; activityCount: number; status: string };
export type CollaborationEdge = { id: string; sourceInstitutionId: string; targetInstitutionId: string; activityIds: string[]; activityCount: number; domains: string[]; statuses: string[] };
export function buildCollaborationNetwork(activities: readonly CollaborationActivity[]) {
  const edgeMap = new Map<string, CollaborationEdge>();
  const counts = new Map<string, number>();
  for (const activity of activities) for (const participant of activity.participant_institution_ids) {
    if (participant === activity.coordinator_institution_id) continue;
    const key = `${activity.coordinator_institution_id}->${participant}`;
    const edge = edgeMap.get(key) ?? { id: key, sourceInstitutionId: activity.coordinator_institution_id, targetInstitutionId: participant, activityIds: [], activityCount: 0, domains: [], statuses: [] };
    edge.activityIds.push(activity.id); edge.activityCount++; if (!edge.domains.includes(activity.domain)) edge.domains.push(activity.domain); if (!edge.statuses.includes(activity.status)) edge.statuses.push(activity.status); edgeMap.set(key, edge);
    counts.set(activity.coordinator_institution_id, (counts.get(activity.coordinator_institution_id) ?? 0) + 1); counts.set(participant, (counts.get(participant) ?? 0) + 1);
  }
  const edges = [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  const involved = new Set(edges.flatMap(e => [e.sourceInstitutionId, e.targetInstitutionId]));
  const nodes = institutions.filter(i => involved.has(i.id)).map(i => ({ id: i.id, label: i.name, role: i.role, institutionType: i.institution_type, activityCount: counts.get(i.id) ?? 0, status: i.monitoring_status })).sort((a, b) => a.id.localeCompare(b.id));
  const accessibleSummary = edges.length ? edges.map(e => `${institution(e.sourceInstitutionId)?.name} berkoordinasi dengan ${institution(e.targetInstitutionId)?.name} dalam ${e.activityCount} kegiatan: ${e.domains.join(", ")}.`).join(" ") : "Belum ada hubungan kegiatan pada konteks terpilih.";
  return { nodes, edges, accessibleSummary };
}
export function layoutCollaborationNetwork(nodes: readonly CollaborationNode[], width: number, height: number) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 640, safeHeight = Number.isFinite(height) && height > 0 ? height : 360;
  const padding = 62, centerX = safeWidth / 2, centerY = safeHeight / 2;
  if (!nodes.length) return [];
  const sorted = [...nodes].sort((a, b) => b.activityCount - a.activityCount || a.id.localeCompare(b.id));
  const radius = Math.max(0, Math.min(safeWidth / 2 - padding, safeHeight / 2 - padding));
  return sorted.map((node, index) => index === 0 ? { ...node, x: centerX, y: centerY } : (() => { const angle = -Math.PI / 2 + (index - 1) * Math.PI * 2 / Math.max(1, sorted.length - 1); return { ...node, x: Math.min(safeWidth - padding, Math.max(padding, centerX + Math.cos(angle) * radius)), y: Math.min(safeHeight - padding, Math.max(padding, centerY + Math.sin(angle) * radius)) }; })());
}
