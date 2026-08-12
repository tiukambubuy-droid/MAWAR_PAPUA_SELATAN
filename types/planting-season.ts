export type SeasonStatus = "Selesai" | "Berjalan" | "Terjadwal" | "Draft";
export type PlantingPhase = "Persiapan" | "Persemaian" | "Vegetatif" | "Generatif" | "Pematangan" | "Siap Panen" | "Pascapanen";

export type PlantingSeason = {
  id: string;
  name: string;
  displayName?: string;
  year: number;
  order: number;
  commodity: string;
  commodityId?: string;
  regencyId?: string;
  startDate: string;
  endDate: string;
  reportingCutoff?: string;
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
  administrativeType?: "kampung" | "kelurahan";
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
  farmers: number | null;
  groups: number | null;
  monitoringStatus: "active";
  plantedAt: string;
  updatedAt: string;
  trend: number[];
};
