"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChartDataPoint } from "@/lib/chart-data";
import { chartDomain, chartSeries, chartSummaryItems, chartValueLabels, formatCompactId, positionChartValueLabels, type ChartCollisionRect } from "@/lib/visualization";

type Series = "target" | "actual" | "projection";

export function MonitoringLineChart({ data, unit, ariaLabel, selectedId, showSummaryStrip = false, summaryStatus, showPersistentValueLabels = true, presentation = "default" }: {
  data: ChartDataPoint[];
  unit: "ha" | "ton";
  ariaLabel: string;
  selectedId?: string;
  showSummaryStrip?: boolean;
  summaryStatus?: "completed" | "in_progress";
  showPersistentValueLabels?: boolean;
  presentation?: "default" | "production";
}) {
  const renderPersistentValueLabels = showPersistentValueLabels && !showSummaryStrip;
  const [activeId, setActiveId] = useState<string | null>(renderPersistentValueLabels ? selectedId ?? data.find(point => point.isCutoff)?.id ?? null : null);
  const [tooltipExclusion, setTooltipExclusion] = useState<ChartCollisionRect | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const width = 760, height = 330;
  const plot = { left: 72, right: 26, top: 28, bottom: 52 };
  const domain = useMemo(() => chartDomain(data), [data]);
  const x = (index: number) => plot.left + index * ((width - plot.left - plot.right) / Math.max(1, data.length - 1));
  const y = (value: number) => height - plot.bottom - ((value - domain.min) / (domain.max - domain.min)) * (height - plot.top - plot.bottom);
  const path = (field: Series) => chartSeries(data, field).map((point, index) => `${index ? "L" : "M"}${x(point.stageIndex - 1).toFixed(1)},${y(point[field]!).toFixed(1)}`).join(" ");
  const active = data.find(point => point.id === activeId) ?? null;
  const cutoff = data.find(point => point.isCutoff);
  const ticks = Array.from({ length: 5 }, (_, index) => domain.max * index / 4);
  const importantValues = chartValueLabels(data);
  const summaryItems = useMemo(() => chartSummaryItems(data, summaryStatus), [data, summaryStatus]);
  const valueLabels = renderPersistentValueLabels ? positionChartValueLabels(importantValues.map(label => ({
    ...label,
    text: `${label.field === "actual" ? "Realisasi" : label.field === "target" ? "Target" : "Proyeksi"} ${formatCompactId(label.value)} ${unit}`,
    anchorX: x(label.point.stageIndex - 1),
    anchorY: y(label.value),
  })), { left: plot.left, right: width - plot.right, top: plot.top, bottom: height - plot.bottom }, tooltipExclusion ? [tooltipExclusion] : []) : [];
  const availableSeries = (["target", "actual", "projection"] as Series[]).filter(field => data.some(point => point[field] !== null));
  const closeTooltip = () => { setActiveId(null); setTooltipExclusion(null); };
  const openTooltip = (pointId: string) => {
    if (activeId === pointId) return;
    setTooltipExclusion(null);
    setActiveId(pointId);
  };

  useLayoutEffect(() => {
    if (!activeId) return;
    const measure = () => {
      const svgRect = svgRef.current?.getBoundingClientRect();
      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      if (!svgRect || !tooltipRect || svgRect.width <= 0 || svgRect.height <= 0) return;
      const viewBoxScale = Math.min(svgRect.width / width, svgRect.height / height);
      if (!Number.isFinite(viewBoxScale) || viewBoxScale <= 0) return;
      const viewBoxLeft = svgRect.left + (svgRect.width - width * viewBoxScale) / 2;
      const viewBoxTop = svgRect.top + (svgRect.height - height * viewBoxScale) / 2;
      const next = {
        x: (tooltipRect.left - viewBoxLeft) / viewBoxScale,
        y: (tooltipRect.top - viewBoxTop) / viewBoxScale,
        width: tooltipRect.width / viewBoxScale,
        height: tooltipRect.height / viewBoxScale,
      };
      setTooltipExclusion(current => current && Object.keys(next).every(key => Math.abs(current[key as keyof ChartCollisionRect] - next[key as keyof ChartCollisionRect]) < 0.25) ? current : next);
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, [activeId]);

  const summaryStrip = showSummaryStrip ? <dl className={`monitoring-chart-summary count-${summaryItems.length}`} aria-label="Ringkasan nilai grafik">
    {summaryItems.map(item => <div className={`monitoring-chart-summary-item ${item.field}`} key={item.field}>
      <i aria-hidden="true" />
      <dt>{item.label}</dt>
      <dd>{item.value === null ? "Belum tersedia" : `${item.value.toLocaleString("id-ID")} ${unit}`}</dd>
    </div>)}
  </dl> : null;

  if (!data.length) return <div className="monitoring-chart" data-presentation={presentation}>{summaryStrip}<div className="monitoring-chart-empty" role="status">Tidak ada data sesuai filter.</div></div>;

  return <div className={`monitoring-chart ${presentation === "production" ? "monitoring-chart-production" : ""}`} data-reduced-motion="supported" data-presentation={presentation}>
    {summaryStrip}
    <div className="monitoring-chart-legend" aria-label="Legenda grafik">
      {availableSeries.map(field => <span key={field} className={field}><i />{field === "target" ? "Target" : field === "actual" ? "Realisasi" : "Proyeksi"}</span>)}
      <em>Satuan: {unit}</em>
    </div>
    <div className="monitoring-chart-stage" ref={stageRef} onMouseLeave={closeTooltip} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeTooltip(); }} onKeyDown={event => { if (event.key === "Escape") closeTooltip(); }}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        <title>{ariaLabel}</title>
        <desc>Grafik target, realisasi, proyeksi, dan cut-off berdasarkan data musim aktif.</desc>
        {ticks.map(value => <g key={value} className="chart-axis-row"><line x1={plot.left} x2={width - plot.right} y1={y(value)} y2={y(value)} /><text x={plot.left - 12} y={y(value) + 4} textAnchor="end">{formatCompactId(value)}</text></g>)}
        {cutoff && <g className="chart-cutoff"><line x1={x(cutoff.stageIndex - 1)} x2={x(cutoff.stageIndex - 1)} y1={plot.top} y2={height - plot.bottom} /><text x={Math.min(width - 92, x(cutoff.stageIndex - 1) + 7)} y={plot.top + 13}>Cut-off data</text></g>}
        {availableSeries.map(field => <path key={field} className={`chart-series ${field}`} d={path(field)} />)}
        {valueLabels.map(({ point, field, text, x: labelX, y: labelY, width: labelWidth, height: labelHeight }) => <g
          key={`${point.id}:${field}`}
          className={`chart-value-label ${field}`}
          data-series={field}
          aria-hidden="true"
          transform={`translate(${labelX.toFixed(1)} ${labelY.toFixed(1)})`}
        ><rect width={labelWidth.toFixed(1)} height={labelHeight} rx="7" /><text x="8" y="16">{text}</text></g>)}
        {data.map((point, index) => <g key={point.id}>
          <text className={`chart-x-label ${index % 2 ? "mobile-secondary" : ""}`} x={x(index)} y={height - 20} textAnchor="middle">{point.label.split(" ")[0]}</text>
          {(["actual", "projection"] as Series[]).map(field => point[field] === null ? null : <circle
            key={field}
            className={`chart-point ${field}`}
            cx={x(index)} cy={y(point[field]!)} r={active?.id === point.id ? 6 : 4}
            tabIndex={0}
            aria-label={`${point.label}, ${field === "actual" ? "realisasi" : "proyeksi"} ${point[field]!.toLocaleString("id-ID")} ${unit}`}
            onFocus={() => openTooltip(point.id)} onMouseEnter={() => openTooltip(point.id)} onClick={() => activeId === point.id ? closeTooltip() : openTooltip(point.id)}
          />)}
        </g>)}
      </svg>
      {active && <div ref={tooltipRef} className={`monitoring-chart-tooltip ${active.stageIndex > data.length / 2 ? "tooltip-corner-left" : "tooltip-corner-right"}`}>
        <strong>{active.label}</strong>
        {active.target !== null && <span>Target <b>{active.target.toLocaleString("id-ID")} {unit}</b></span>}
        {active.actual !== null && <span>Realisasi <b>{active.actual.toLocaleString("id-ID")} {unit}</b></span>}
        {active.projection !== null && <span>Proyeksi <b>{active.projection.toLocaleString("id-ID")} {unit}</b></span>}
        {active.isCutoff && <em>Cut-off data</em>}
      </div>}
    </div>
    {!showSummaryStrip && <p className="sr-only">{importantValues.map(label => `${label.field === "actual" ? "Realisasi pada cut-off" : label.field === "target" ? "Target akhir" : "Proyeksi akhir"} ${label.value.toLocaleString("id-ID")} ${unit}.`).join(" ")}</p>}
  </div>;
}
