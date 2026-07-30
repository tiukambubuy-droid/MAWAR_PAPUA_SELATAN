export type ProductionGroup = {
  name: string;
  harvested: number;
  yieldRate: number;
  target: number;
  validation: number;
  trend: number[];
};

export type ProductionVillage = {
  id?: string;
  name: string;
  administrativeType?: "kampung" | "kelurahan";
  groups: ProductionGroup[];
};

export type ProductionDistrict = {
  id?: string;
  name: string;
  villages: ProductionVillage[];
};

export type ProductionRecord = {
  id: string;
  name: string;
  level: "Distrik" | "Kampung" | "Kelurahan" | "Kelompok Tani";
  harvested: number;
  yieldRate: number;
  gkg: number;
  rice: number;
  loss: number;
  target: number;
  validation: number;
  trend: number[];
};
