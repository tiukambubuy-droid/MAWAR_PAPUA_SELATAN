export type LandAreaValues = {
  potentialHa: number;
  mappedHa: number;
  verifiedHa: number;
  activeHa: number;
  plantedHa: number;
  harvestedHa: number;
  failedHarvestHa: number;
  fallowHa: number;
};

export type LandMonitoringRecord = {
  id: string;
  recordCode: string;
  villageId: string;
  monitoringDate: string;
  areas: LandAreaValues;
  phase: {
    phaseId: string;
    progressPercent: number;
    plantingDate: string;
    estimatedHarvestStart: string;
    estimatedHarvestEnd: string;
  };
  condition: {
    landStatusId: string;
    score: number;
    reasons: string[];
    fieldNotes: string;
  };
  risk: {
    riskLevelId: string;
    score: number;
    threatIds: string[];
    affectedAreaHa: number;
    description: string;
    recommendation: string;
  };
  participation: {
    farmerGroupIds: string[];
    registeredFarmers: number;
    activeFarmers: number;
  };
  geometry: {
    geometryType: string;
    geometryId: string;
    boundaryReference: string;
    mapAccuracy: string;
  };
  validation: {
    validationStatusId: string;
    validationPercent: number;
    verifiedAreaPercent: number;
    notes: string;
    validatedAt: string;
    validatedBy: string;
  };
  audit: {
    recordedBy: string;
    recordedAt: string;
    updatedBy: string;
    updatedAt: string;
  };
};

export type LandScopeLevel = "province" | "regency" | "district" | "village";

export type LandAggregate = {
  scopeId: string;
  scopeName: string;
  scopeLevel: LandScopeLevel;
  recordCount: number;
  districtCount: number;
  villageCount: number;
  areas: LandAreaValues;
  affectedAreaHa: number;
  registeredFarmers: number;
  activeFarmers: number;
  validationPercent: number;
  verifiedAreaPercent: number;
  conditionComposition: Record<string, number>;
  phaseComposition: Record<string, number>;
  riskComposition: Record<string, number>;
  dominantConditionId: string | null;
  dominantPhaseId: string | null;
  dominantRiskLevelId: string | null;
  latestUpdate: string | null;
};
