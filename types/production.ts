export type ProductionGroup = {
  name: string;
  harvested: number;
  yieldRate: number;
  target: number;
  validation: number;
  trend: number[];
};

export type ProductionVillage = {
  name: string;
  groups: ProductionGroup[];
};

export type ProductionDistrict = {
  name: string;
  villages: ProductionVillage[];
};

export type ProductionRecord = {
  id: string;
  name: string;
  level: "Distrik" | "Kampung" | "Kelompok Tani";
  harvested: number;
  yieldRate: number;
  gkg: number;
  rice: number;
  loss: number;
  target: number;
  validation: number;
  trend: number[];
};
