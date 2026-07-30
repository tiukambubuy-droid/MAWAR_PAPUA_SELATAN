export type SeasonStatus = "Selesai" | "Berjalan" | "Terjadwal" | "Draft";
export type PlantingPhase = "Persiapan" | "Persemaian" | "Vegetatif" | "Generatif" | "Pematangan" | "Siap Panen" | "Pascapanen";

export type PlantingSeason = {
  id: string;
  name: string;
  year: number;
  order: number;
  commodity: string;
  startDate: string;
  endDate: string;
  status: SeasonStatus;
  target: number;
  realized: number;
  production: number;
};

export type RegionNode = {
  id: string;
  name: string;
  type: "regency" | "district" | "village" | "field";
  parentId?: string;
};

export type MonthObservation = {
  key: string;
  label: string;
  year: number;
  activity: PlantingPhase;
  progress: number;
  focus: string;
  target: number;
  realized: number;
  projected: number;
  validation: number;
};

export type MonitoringRow = {
  id: string;
  name: string;
  phase: PlantingPhase;
  target: number;
  realized: number;
  validation: number;
  harvest: string;
  farmers: number;
  groups: number;
  plantedAt: string;
  updatedAt: string;
  trend: number[];
};
