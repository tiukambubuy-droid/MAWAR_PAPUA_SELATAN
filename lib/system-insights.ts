export type SystemInsight = {
  rule_id: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  description: string;
  source_metrics: string[];
  is_simulation: true;
};
export function achievementCategory(value: number) {
  if (value >= 95) return { label: "Sangat Baik", severity: "success" as const };
  if (value >= 85) return { label: "Baik/Terpantau", severity: "info" as const };
  if (value >= 70) return { label: "Waspada", severity: "warning" as const };
  return { label: "Perlu Intervensi", severity: "danger" as const };
}
export function buildAchievementInsight(metric: "planting" | "production", value: number): SystemInsight {
  const category = achievementCategory(value);
  return {
    rule_id: `${metric}-achievement-${category.severity}`,
    severity: category.severity,
    title: `Capaian ${metric === "planting" ? "tanam" : "produksi"}: ${category.label}`,
    description: `Capaian terukur sebesar ${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% berdasarkan data prototipe terpilih.`,
    source_metrics: [`${metric}-achievement-percent`],
    is_simulation: true,
  };
}
export const insightDisclaimer = "Insight dihasilkan otomatis berdasarkan aturan data prototipe, bukan menggunakan AI generatif.";
