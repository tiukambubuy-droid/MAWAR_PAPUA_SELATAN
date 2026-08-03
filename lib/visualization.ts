import type { ChartDataPoint } from "@/lib/chart-data";

export type Point = [number, number];

export function fitToBounds(points: Point[], width: number, height: number, padding: number) {
  const viewportWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const viewportHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const maximumPadding = Math.max(0, Math.min(viewportWidth, viewportHeight) / 2 - Number.EPSILON);
  const safePadding = Number.isFinite(padding) && padding > 0 ? Math.min(padding, maximumPadding) : 0;
  const validPoints = points.filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));

  if (!validPoints.length) {
    return { scale: 1, offsetX: viewportWidth / 2, offsetY: viewportHeight / 2, bounds: null };
  }

  const xs = validPoints.map(point => point[0]);
  const ys = validPoints.map(point => point[1]);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const availableWidth = Math.max(Number.EPSILON, viewportWidth - safePadding * 2);
  const availableHeight = Math.max(Number.EPSILON, viewportHeight - safePadding * 2);
  const scaleCandidates = [
    spanX > 0 ? availableWidth / spanX : null,
    spanY > 0 ? availableHeight / spanY : null,
  ].filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const scale = scaleCandidates.length ? Math.min(...scaleCandidates) : 1;
  return {
    scale,
    offsetX: (viewportWidth - spanX * scale) / 2,
    offsetY: (viewportHeight - spanY * scale) / 2,
    bounds,
  };
}

export function clampZoom(value: number, min = 1, max = 3) {
  return Math.min(max, Math.max(min, value));
}

export function clampPan(value: Point, zoom: number, extent: Point = [250, 250]): Point {
  const limitX = extent[0] * Math.max(0, zoom - 1);
  const limitY = extent[1] * Math.max(0, zoom - 1);
  return [Math.max(-limitX, Math.min(limitX, value[0])), Math.max(-limitY, Math.min(limitY, value[1]))];
}

export function resetMapCamera() {
  return { zoom: 1, pan: [0, 0] as Point };
}

export function isMapDrag(deltaX: number, deltaY: number, threshold = 5) {
  return Math.abs(deltaX) + Math.abs(deltaY) > threshold;
}

export function chartDomain(data: ChartDataPoint[]) {
  const values = data.flatMap(point => [point.target, point.actual, point.projection])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const maximum = Math.max(0, ...values);
  const rawMaximum = maximum === 0 ? 1 : maximum * 1.12;
  const roughStep = rawMaximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return { min: 0, max: Math.ceil(rawMaximum / niceStep) * niceStep };
}

export function chartSeries(data: ChartDataPoint[], field: "target" | "actual" | "projection") {
  const points = data.filter(point => point[field] !== null);
  if (field !== "projection" || !points.length) return points;
  const cutoff = data.find(point => point.isCutoff && point.actual !== null);
  return cutoff ? [{ ...cutoff, projection: cutoff.actual }, ...points] : points;
}

export type ChartValueLabel = {
  point: ChartDataPoint;
  field: "target" | "actual" | "projection";
  value: number;
};

export function chartValueLabels(data: ChartDataPoint[]): ChartValueLabel[] {
  const byLastStage = (field: "target" | "actual" | "projection", cutoffOnly = false) => data
    .filter(point => (!cutoffOnly || point.isCutoff) && Number.isFinite(point[field]))
    .reduce<ChartDataPoint | null>((latest, point) => !latest || point.stageIndex > latest.stageIndex ? point : latest, null);
  const cutoff = byLastStage("actual", true);
  const finalTarget = byLastStage("target");
  const finalProjection = byLastStage("projection");
  return [
    cutoff && { point: cutoff, field: "actual" as const, value: cutoff.actual! },
    finalTarget && { point: finalTarget, field: "target" as const, value: finalTarget.target! },
    finalProjection && { point: finalProjection, field: "projection" as const, value: finalProjection.projection! },
  ].filter((label): label is ChartValueLabel => Boolean(label)).slice(0, 3);
}

export type PositionedChartValueLabel = ChartValueLabel & {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ChartLabelBounds = { left: number; right: number; top: number; bottom: number };
export type ChartCollisionRect = { x: number; y: number; width: number; height: number };

export function positionChartValueLabels(
  labels: Array<ChartValueLabel & { text: string; anchorX: number; anchorY: number }>,
  bounds: ChartLabelBounds,
  exclusionZones: ChartCollisionRect[] = [],
): PositionedChartValueLabel[] {
  const overlaps = (left: ChartCollisionRect, right: ChartCollisionRect) =>
    left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y;
  const safeGap = 8;
  const zones = exclusionZones
    .filter(zone => [zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) && zone.width >= 0 && zone.height >= 0)
    .map(zone => ({ x: zone.x - safeGap, y: zone.y - safeGap, width: zone.width + safeGap * 2, height: zone.height + safeGap * 2 }));
  const prioritized = labels.slice(0, 3);

  const attempt = (candidates: typeof prioritized) => {
    const placed: PositionedChartValueLabel[] = [];
    for (const label of candidates) {
      const width = Math.min(180, Math.max(88, label.text.length * 7.2 + 18));
      const height = 24;
      const positions = [
        [label.anchorX - width - 10, label.anchorY - height - 10],
        [label.anchorX - width - 10, label.anchorY + 10],
        [label.anchorX + 10, label.anchorY - height - 10],
        [label.anchorX + 10, label.anchorY + 10],
        [label.anchorX - width / 2, label.anchorY - height - 18],
        [label.anchorX - width / 2, label.anchorY + 18],
      ];
      for (let candidateY = bounds.top; candidateY <= bounds.bottom - height; candidateY += 8) {
        for (let candidateX = bounds.left; candidateX <= bounds.right - width; candidateX += 12) {
          positions.push([candidateX, candidateY]);
        }
      }
      let selected: PositionedChartValueLabel | null = null;
      for (const [candidateX, candidateY] of positions) {
        const next = {
          ...label,
          width,
          height,
          x: Math.min(bounds.right - width, Math.max(bounds.left, candidateX)),
          y: Math.min(bounds.bottom - height, Math.max(bounds.top, candidateY)),
        };
        if (!placed.some(other => overlaps(next, other)) && !zones.some(zone => overlaps(next, zone))) {
          selected = next;
          break;
        }
      }
      if (!selected) return null;
      placed.push(selected);
    }
    return placed;
  }

  for (let count = prioritized.length; count >= 0; count--) {
    const placed = attempt(prioritized.slice(0, count));
    if (placed) return placed;
  }
  return [];
}

export function responsiveLabelStep(width: number, count: number) {
  if (width < 430 && count > 4) return 2;
  return 1;
}

export function prioritizedMapLabels<T extends { name: string; center: Point; selected?: boolean; active?: boolean }>(items: T[], minimumSpacing = 46, maximum = 14) {
  const ordered = [...items].sort((left, right) =>
    Number(Boolean(right.selected)) - Number(Boolean(left.selected)) ||
    Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
    left.name.localeCompare(right.name, "id"),
  );
  const accepted: T[] = [];
  for (const item of ordered) {
    if (!item.selected && accepted.some(other => Math.hypot(item.center[0] - other.center[0], item.center[1] - other.center[1]) < minimumSpacing)) continue;
    if (!item.selected && accepted.length >= maximum) continue;
    accepted.push(item);
  }
  return new Set(accepted.map(item => item.name));
}

export function formatCompactId(value: number) {
  return new Intl.NumberFormat("id-ID", { notation: value >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
