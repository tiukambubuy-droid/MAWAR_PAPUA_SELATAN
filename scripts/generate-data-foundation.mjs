import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const REGION_SERVICE =
  "https://geoportal.pertanian.go.id/arcgis/rest/services/Hosted/Batas_Desa_Merauke/FeatureServer/0/query?where=1%3D1&outFields=namobj%2Cwadmkc%2Ckdepum%2Ctipadm&returnGeometry=false&f=json";
const REGION_METADATA_URL =
  "https://geoportal.pertanian.go.id/arcgis/rest/services/Hosted/Batas_Desa_Merauke/FeatureServer/0";
const BPS_MERAUKE_2025_URL =
  "https://meraukekab.bps.go.id/id/publication/2025/02/28/4c4c27605545e3d5264503a3/kabupaten-merauke-dalam-angka-2025.html";

const districtCodes = {
  Merauke: "93.01.01",
  Muting: "93.01.02",
  Okaba: "93.01.03",
  Kimaam: "93.01.04",
  Semangga: "93.01.05",
  "Tanah Miring": "93.01.06",
  Jagebob: "93.01.07",
  Sota: "93.01.08",
  Ulilin: "93.01.09",
  Elikobal: "93.01.10",
  Kurik: "93.01.11",
  Naukenjerai: "93.01.12",
  Animha: "93.01.13",
  Malind: "93.01.14",
  Tubang: "93.01.15",
  Ngguti: "93.01.16",
  Kaptel: "93.01.17",
  Tabonji: "93.01.18",
  Waan: "93.01.19",
  Ilwayab: "93.01.20",
  Padua: "93.01.21",
  Kontuar: "93.01.22",
};

const monitoredDistricts = new Set([
  "Semangga",
  "Tanah Miring",
  "Jagebob",
  "Kurik",
  "Malind",
  "Merauke",
]);

const riceCenters = new Set([
  "Muram Sari",
  "Sidomulyo",
  "Wananggab Kai",
  "Yasa Mulya",
  "Amunkay",
  "Hidup Baru",
  "Harapan Makmur",
  "Sumber Mulya",
  "Candra Jaya",
  "Salor Indah",
  "Rawa Sari",
  "Suka Maju",
  "Kartini",
  "Angger Permegi",
]);

const seasons = [
  {
    season_id: "MT1-2026",
    name: "MT I 2026",
    display_name: "MT I 2026 (Selesai)",
    sequence: 1,
    year: 2026,
    status: "completed",
    commodity_id: "PADI",
    regency_id: "93.01",
    start_date: "2025-10-01",
    end_date: "2026-03-31",
    reporting_cutoff: "2026-03-31",
    data_type: "simulation",
    validation_status: "approved",
    validation_rate: 93,
  },
  {
    season_id: "MT2-2026",
    name: "MT II 2026",
    display_name: "MT II 2026 (Berjalan)",
    sequence: 2,
    year: 2026,
    status: "in_progress",
    commodity_id: "PADI",
    regency_id: "93.01",
    start_date: "2026-04-01",
    end_date: "2026-09-30",
    reporting_cutoff: "2026-07-24",
    data_type: "simulation",
    validation_status: "approved",
    validation_rate: 91,
  },
];

const canonical = {
  "MT1-2026": {
    mapped_land_ha: 48920,
    active_land_ha: 37800,
    planting_target_ha: 36500,
    planting_realization_ha: 35120,
    harvested_area_ha: 33470,
    gkg_production_ton: 183420,
    gkg_production_target_ton: 185000,
    loss_rate: 4.5,
  },
  "MT2-2026": {
    mapped_land_ha: 48920,
    active_land_ha: 42680,
    planting_target_ha: 42680,
    planting_realization_ha: 38180,
    harvested_area_ha: 31854,
    gkg_production_ton: 174577,
    gkg_production_target_ton: 197220,
    loss_rate: 4.5,
  },
};

const snapshots = {
  "MT1-2026": [
    ["2025-10", 4200, 0, 0],
    ["2025-11", 12650, 0, 0],
    ["2025-12", 23900, 2100, 11100],
    ["2026-01", 31600, 9850, 53800],
    ["2026-02", 34700, 22100, 120900],
    ["2026-03", 35120, 33470, 183420],
  ],
  "MT2-2026": [
    ["2026-04", 8400, 0, 0],
    ["2026-05", 22150, 4200, 22850],
    ["2026-06", 33040, 18500, 101380],
    ["2026-07", 38180, 31854, 174577],
  ],
};

const hash = (value) =>
  [...value].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 17);

function allocate(total, entries, weightFor) {
  const weights = entries.map(weightFor);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const values = exact.map(Math.floor);
  let remainder = total - values.reduce((sum, value) => sum + value, 0);
  exact
    .map((value, index) => ({ index, fraction: value - values[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .slice(0, remainder)
    .forEach(({ index }) => values[index]++);
  return values;
}

function dataSource() {
  return {
    institution: "Kemendagri",
    document: "Kepmendagri 050-145 Tahun 2022 / pemutakhiran kode Papua Selatan",
    reference_year: 2025,
    url: REGION_METADATA_URL,
    accessed_at: "2026-07-31T00:00:00+09:00",
    verification_source: "BPS Kabupaten Merauke, Kabupaten Merauke Dalam Angka 2025",
    verification_url: BPS_MERAUKE_2025_URL,
    verification_status: "verified",
  };
}

async function fetchOfficialVillages() {
  const response = await fetch(REGION_SERVICE);
  if (!response.ok) throw new Error(`Official region service failed: ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.features) || payload.features.length !== 190) {
    throw new Error(`Expected 190 official villages/kelurahan, received ${payload.features?.length}`);
  }
  return payload.features.map(({ attributes }) => attributes);
}

function currentCode(oldCode) {
  return oldCode.replace(/^91\.01/, "93.01");
}

function makeRegions(sourceRows) {
  const districts = Object.entries(districtCodes).map(([name, code]) => ({
    id: code,
    code,
    legacy_code: code.replace(/^93\.01/, "91.01"),
    name,
    canonical_name: name,
    aliases: [],
    administrative_type: "district",
    parent_id: "93.01",
    monitoring_status: monitoredDistricts.has(name) ? "active" : "not_monitored",
    agricultural_role: monitoredDistricts.has(name) ? "rice_center" : "unknown",
    is_active: true,
    source: dataSource(),
  }));
  const villages = sourceRows
    .map((row) => {
      const administrativeType = row.tipadm === 2 ? "kelurahan" : "kampung";
      const code = currentCode(row.kdepum);
      return {
        id: code,
        code,
        legacy_code: row.kdepum,
        name: row.namobj,
        canonical_name: row.namobj,
        aliases: row.namobj === "Waninggap Kai" ? ["Waniggap Kai", "Wanringgap Kai", "Wananggab Kai"] : [],
        administrative_type: administrativeType,
        parent_id: districtCodes[row.wadmkc],
        monitoring_status: monitoredDistricts.has(row.wadmkc) ? "active" : "not_monitored",
        agricultural_role: riceCenters.has(row.namobj) ? "rice_center" : monitoredDistricts.has(row.wadmkc) ? "supporting" : "unknown",
        is_active: true,
        source: dataSource(),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, "id", { numeric: true }));
  if (villages.some((region) => !region.parent_id)) {
    throw new Error("Official service returned an unknown district");
  }
  return {
    schema_version: "2.0.0",
    scope: "Kabupaten Merauke",
    source_conflicts: [
      {
        field: "code_prefix",
        source_value: "91.01",
        canonical_value: "93.01",
        resolution: "Kode 91.01 dari geodatabase 2022 disimpan sebagai legacy_code; kode 93.01 Papua Selatan digunakan sebagai kode kanonis.",
      },
    ],
    regions: [
      {
        id: "93",
        code: "93",
        legacy_code: null,
        name: "Papua Selatan",
        canonical_name: "Papua Selatan",
        aliases: [],
        administrative_type: "province",
        parent_id: null,
        monitoring_status: "context",
        agricultural_role: "unknown",
        data_type: "official_reference",
        is_active: true,
        source: dataSource(),
      },
      {
        id: "93.01",
        code: "93.01",
        legacy_code: "91.01",
        name: "Merauke",
        canonical_name: "Merauke",
        aliases: [],
        administrative_type: "regency",
        parent_id: "93",
        monitoring_status: "active",
        agricultural_role: "rice_center",
        data_type: "official_reference",
        is_active: true,
        source: dataSource(),
      },
      ...districts,
      ...villages,
    ],
  };
}

function recordWeights(villages, seasonId) {
  return villages.map((region) => {
    const district = Object.keys(districtCodes).find((name) => districtCodes[name] === region.parent_id);
    const districtBoost = ["Kurik", "Tanah Miring", "Semangga", "Malind", "Jagebob", "Merauke"].indexOf(district);
    return 80 + (5 - districtBoost) * 17 + (region.agricultural_role === "rice_center" ? 110 : 0) + (hash(`${seasonId}:${region.id}`) % 41);
  });
}

function makeDomainRecords(regions, season) {
  const villages = regions.filter(
    (region) =>
      (region.administrative_type === "kampung" || region.administrative_type === "kelurahan") &&
      region.monitoring_status === "active",
  );
  const totals = canonical[season.season_id];
  const weights = recordWeights(villages, season.season_id);
  const byWeight = (total) => allocate(total, villages, (_, index) => weights[index]);
  const mapped = byWeight(totals.mapped_land_ha);
  const active = byWeight(totals.active_land_ha);
  const target = byWeight(totals.planting_target_ha);
  const planted = byWeight(totals.planting_realization_ha);
  const harvested = byWeight(totals.harvested_area_ha);
  const production = allocate(
    totals.gkg_production_ton,
    villages,
    (_, index) => harvested[index] * (5.25 + (hash(villages[index].id) % 47) / 100),
  );
  const productionTarget = byWeight(totals.gkg_production_target_ton);
  const phases = ["Persiapan", "Persemaian", "Vegetatif", "Generatif", "Pematangan", "Siap Panen", "Pascapanen"];
  const risks = ["Rendah", "Waspada", "Sedang", "Tinggi/Kritis"];

  return villages.map((region, index) => {
    const common = {
      id: `${season.season_id}:${region.id}`,
      season_id: season.season_id,
      region_id: region.id,
      region_level: region.administrative_type,
      commodity_id: "PADI",
      monitoring_status: "active",
      validation_status: "approved",
      validation_rate: season.validation_rate,
      updated_at: season.season_id === "MT2-2026" ? "2026-07-24T20:15:00+09:00" : "2026-03-31T20:15:00+09:00",
      source_type: "government_prototype",
      data_type: "simulation",
    };
    return {
      common,
      land: {
        ...common,
        mapped_land_ha: mapped[index],
        active_land_ha: active[index],
        phase: phases[(hash(`${region.id}:phase`) + season.sequence) % phases.length],
        risk: risks[hash(`${region.id}:risk`) % risks.length],
      },
      season: {
        ...common,
        planting_target_ha: target[index],
        planting_realization_ha: planted[index],
        phase: phases[(hash(`${region.id}:phase`) + season.sequence) % phases.length],
        risk: risks[hash(`${region.id}:risk`) % risks.length],
      },
      production: {
        ...common,
        harvested_area_ha: harvested[index],
        gkg_production_ton: production[index],
        gkg_production_target_ton: productionTarget[index],
        loss_rate: totals.loss_rate,
      },
    };
  });
}

async function main() {
  const sourceRows = await fetchOfficialVillages();
  const regionDocument = makeRegions(sourceRows);
  const allRecords = seasons.flatMap((season) => makeDomainRecords(regionDocument.regions, season));
  const reference = {
    schema_version: "2.0.0",
    commodities: [{ id: "PADI", name: "Padi", is_active: true }],
    seasons,
    milling_yield: {
      rate: 63.39,
      type: "standard_reference",
      source: "BPS - Survei Konversi Gabah ke Beras 2018",
      reference_region: "Papua",
      effective_from: "2018-01-01",
      is_verified: true,
    },
    canonical_totals: canonical,
  };
  const seasonDocument = {
    schema_version: "2.0.0",
    snapshots: Object.entries(snapshots).flatMap(([seasonId, rows]) =>
      rows.map(([period, planting, harvested, production]) => ({
        id: `${seasonId}:${period}`,
        season_id: seasonId,
        period,
        period_end: new Date(
          Number(period.slice(0, 4)),
          Number(period.slice(5, 7)),
          0,
        ).toISOString().slice(0, 10),
        kind: "actual",
        planting_realization_ha: planting,
        harvested_area_ha: harvested,
        gkg_production_ton: production,
      })),
    ),
    future_targets_and_projections: [
      { id: "MT2-2026:2026-08:target", season_id: "MT2-2026", period: "2026-08", kind: "target", planting_target_ha: 42680, gkg_production_target_ton: 197220 },
      { id: "MT2-2026:2026-08:projection", season_id: "MT2-2026", period: "2026-08", kind: "projection", gkg_production_ton: 187500 },
      { id: "MT2-2026:2026-09:target", season_id: "MT2-2026", period: "2026-09", kind: "target", planting_target_ha: 42680, gkg_production_target_ton: 197220 },
      { id: "MT2-2026:2026-09:projection", season_id: "MT2-2026", period: "2026-09", kind: "projection", gkg_production_ton: 197220 },
    ],
    records: allRecords.map((record) => record.season),
  };
  const landDocument = {
    schema_version: "2.0.0",
    records: allRecords.map((record) => record.land),
  };
  const productionDocument = {
    schema_version: "2.0.0",
    records: allRecords.map((record) => record.production),
  };

  await mkdir(new URL("data/master/", ROOT), { recursive: true });
  await mkdir(new URL("data/monitoring/", ROOT), { recursive: true });
  const documents = [
    ["data/master/regions.json", regionDocument],
    ["data/master/data-foundation.json", reference],
    ["data/monitoring/land-monitoring.json", landDocument],
    ["data/monitoring/season-monitoring.json", seasonDocument],
    ["data/monitoring/production-monitoring.json", productionDocument],
  ];
  for (const [path, document] of documents) {
    await writeFile(new URL(path, ROOT), `${JSON.stringify(document, null, 2)}\n`);
  }
  const packageJson = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));
  console.log(`Generated ${regionDocument.regions.length} regions and ${allRecords.length} seasonal village records for ${packageJson.name}.`);
}

await main();
