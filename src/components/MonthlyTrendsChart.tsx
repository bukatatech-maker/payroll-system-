import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { formatZmw } from '../lib/roles.ts';
import type { MonthlyTrendPoint } from '../types/payroll.ts';

interface MonthlyTrendsChartProps {
  data: MonthlyTrendPoint[];
}

type SeriesMode = 'both' | 'variance' | 'cases';

export function MonthlyTrendsChart({ data }: MonthlyTrendsChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(760);
  const [mode, setMode] = useState<SeriesMode>('both');
  const [hovered, setHovered] = useState<{
    point: MonthlyTrendPoint;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.max(320, Math.floor(el.clientWidth));
      setWidth(next);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || data.length === 0) return;

    const height = 270;
    const margin = {
      top: 18,
      right: mode === 'cases' ? 24 : 64,
      bottom: 34,
      left: mode === 'variance' ? 64 : 46,
    };
    const innerWidth = Math.max(180, width - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', width).attr('height', height);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.label))
      .range([0, innerWidth])
      .padding(0.25);

    const maxCases = Math.max(10, d3.max(data, (d) => d.exception_cases) ?? 20);
    const yCases = d3
      .scaleLinear()
      .domain([0, Math.ceil(maxCases * 1.2)])
      .nice()
      .range([innerHeight, 0]);

    const maxVariance = Math.max(100000, d3.max(data, (d) => d.payroll_variance_zmw) ?? 450000);
    const yVariance = d3
      .scaleLinear()
      .domain([0, Math.ceil((maxVariance * 1.15) / 50000) * 50000])
      .nice()
      .range([innerHeight, 0]);

    // Subtle horizontal gridlines
    const gridScale = mode === 'variance' ? yVariance : yCases;
    g.append('g')
      .attr('class', 'grid-lines')
      .call(
        d3
          .axisLeft(gridScale)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .call((sel) => {
        sel.select('.domain').remove();
        sel.selectAll('line').attr('stroke', '#e2e8f0').attr('stroke-dasharray', '2,3');
      });

    // X Axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickSizeOuter(0))
      .call((sel) => {
        sel.select('.domain').attr('stroke', '#cbd5e1');
        sel.selectAll('.tick line').attr('stroke', '#cbd5e1');
        sel
          .selectAll('text')
          .attr('fill', '#475569')
          .style('font-family', '"IBM Plex Mono", ui-monospace, monospace')
          .style('font-size', '11px');
      });

    // Left Y-Axis (Cases or Variance when single-mode variance)
    if (mode !== 'variance') {
      g.append('g')
        .call(d3.axisLeft(yCases).ticks(5).tickFormat((d) => `${d}`))
        .call((sel) => {
          sel.select('.domain').remove();
          sel.selectAll('.tick line').remove();
          sel
            .selectAll('text')
            .attr('fill', '#b45309')
            .style('font-family', '"IBM Plex Mono", ui-monospace, monospace')
            .style('font-size', '11px');
        });
    } else {
      g.append('g')
        .call(
          d3
            .axisLeft(yVariance)
            .ticks(5)
            .tickFormat((d) => `K${Math.round(Number(d) / 1000)}k`)
        )
        .call((sel) => {
          sel.select('.domain').remove();
          sel.selectAll('.tick line').remove();
          sel
            .selectAll('text')
            .attr('fill', '#047857')
            .style('font-family', '"IBM Plex Mono", ui-monospace, monospace')
            .style('font-size', '11px');
        });
    }

    // Right Y-Axis (Payroll Variance in ZMW when showing both)
    if (mode === 'both') {
      g.append('g')
        .attr('transform', `translate(${innerWidth},0)`)
        .call(
          d3
            .axisRight(yVariance)
            .ticks(5)
            .tickFormat((d) => `K${Math.round(Number(d) / 1000)}k`)
        )
        .call((sel) => {
          sel.select('.domain').remove();
          sel.selectAll('.tick line').remove();
          sel
            .selectAll('text')
            .attr('fill', '#047857')
            .style('font-family', '"IBM Plex Mono", ui-monospace, monospace')
            .style('font-size', '11px');
        });
    }

    // Series 1: Payroll Variance (ZMW)
    if (mode === 'both' || mode === 'variance') {
      const areaVariance = d3
        .area<MonthlyTrendPoint>()
        .x((d) => xScale(d.label) ?? 0)
        .y0(innerHeight)
        .y1((d) => yVariance(d.payroll_variance_zmw))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(data)
        .attr('fill', '#047857')
        .attr('fill-opacity', 0.06)
        .attr('d', areaVariance);

      const lineVariance = d3
        .line<MonthlyTrendPoint>()
        .x((d) => xScale(d.label) ?? 0)
        .y((d) => yVariance(d.payroll_variance_zmw))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#047857')
        .attr('stroke-width', 2.25)
        .attr('d', lineVariance);

      g.selectAll('.dot-variance')
        .data(data)
        .enter()
        .append('circle')
        .attr('class', 'dot-variance')
        .attr('cx', (d) => xScale(d.label) ?? 0)
        .attr('cy', (d) => yVariance(d.payroll_variance_zmw))
        .attr('r', 4)
        .attr('fill', '#ffffff')
        .attr('stroke', '#047857')
        .attr('stroke-width', 2);
    }

    // Series 2: Exception Cases (Count) — dashed stroke + square markers for dual-cue accessibility
    if (mode === 'both' || mode === 'cases') {
      const lineCases = d3
        .line<MonthlyTrendPoint>()
        .x((d) => xScale(d.label) ?? 0)
        .y((d) => yCases(d.exception_cases))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#d97706')
        .attr('stroke-width', 2.25)
        .attr('stroke-dasharray', mode === 'both' ? '5,4' : 'none')
        .attr('d', lineCases);

      g.selectAll('.dot-cases')
        .data(data)
        .enter()
        .append('rect')
        .attr('class', 'dot-cases')
        .attr('x', (d) => (xScale(d.label) ?? 0) - 3.5)
        .attr('y', (d) => yCases(d.exception_cases) - 3.5)
        .attr('width', 7)
        .attr('height', 7)
        .attr('fill', '#ffffff')
        .attr('stroke', '#d97706')
        .attr('stroke-width', 2);
    }

    // Hover crosshair guide line + interactive hit columns
    const guideLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3')
      .style('opacity', 0);

    const stepWidth = innerWidth / Math.max(1, data.length);
    g.selectAll('.hover-band')
      .data(data)
      .enter()
      .append('rect')
      .attr('x', (d) => (xScale(d.label) ?? 0) - stepWidth / 2)
      .attr('y', 0)
      .attr('width', stepWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => {
        const cx = xScale(d.label) ?? 0;
        const cy =
          mode === 'cases' ? yCases(d.exception_cases) : yVariance(d.payroll_variance_zmw);
        guideLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
        setHovered({
          point: d,
          x: cx + margin.left,
          y: cy + margin.top,
        });
      })
      .on('mouseleave', () => {
        guideLine.style('opacity', 0);
        setHovered(null);
      });
  }, [data, width, mode]);

  const first = data[0];
  const last = data[data.length - 1];
  const varianceDeltaPct =
    first && last && data.length > 1 && first.payroll_variance_zmw > 0
      ? Math.round(
          ((last.payroll_variance_zmw - first.payroll_variance_zmw) / first.payroll_variance_zmw) *
            100
        )
      : null;

  const periodRangeLabel =
    first && last
      ? first.month === last.month
        ? `Selected period: ${first.label}`
        : `Selected period: ${first.label} – ${last.label}`
      : 'No months in range';

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-6 py-4 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Payroll Variance &amp; Exception Case Trend ({data.length}{' '}
            {data.length === 1 ? 'Month' : 'Months'})
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {periodRangeLabel}
            {varianceDeltaPct !== null && first
              ? ` · Variance ${varianceDeltaPct >= 0 ? `+${varianceDeltaPct}%` : `${varianceDeltaPct}%`} since ${first.label}`
              : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Unboxed Legend */}
          <div className="flex items-center gap-4 text-xs text-slate-600">
            {(mode === 'both' || mode === 'variance') && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-0.5 w-4 bg-emerald-700" aria-hidden="true" />
                <span>Payroll Variance (ZMW)</span>
              </span>
            )}
            {(mode === 'both' || mode === 'cases') && (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className="inline-block h-0.5 w-4 border-t-2 border-dashed border-amber-600"
                  aria-hidden="true"
                />
                <span>Exception Cases</span>
              </span>
            )}
          </div>

          {/* Series Filter Control */}
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode('both')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                mode === 'both' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Both
            </button>
            <button
              type="button"
              onClick={() => setMode('variance')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                mode === 'variance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Variances
            </button>
            <button
              type="button"
              onClick={() => setMode('cases')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                mode === 'cases' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Cases
            </button>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="relative px-4 py-5">
        {data.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-xs text-slate-500">
            No monthly trend records available.
          </div>
        ) : (
          <svg
            ref={svgRef}
            data-chart="monthly-trends"
            className="block w-full overflow-visible"
            role="img"
            aria-label="D3 line chart of monthly payroll variances and exception cases over the last 6 months"
          />
        )}

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 w-52 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-sm"
            style={{
              left: Math.min(Math.max(16, hovered.x - 104), Math.max(16, width - 224)),
              top: 14,
            }}
          >
            <div className="font-display font-semibold text-slate-900">
              {hovered.point.label}
            </div>
            <div className="mt-1.5 space-y-1 font-mono tabular-nums">
              <div className="flex items-center justify-between text-emerald-700">
                <span>Variance:</span>
                <span className="font-medium">{formatZmw(hovered.point.payroll_variance_zmw)}</span>
              </div>
              <div className="flex items-center justify-between text-amber-700">
                <span>Open Cases:</span>
                <span className="font-medium">{hovered.point.exception_cases}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Resolved:</span>
                <span>{hovered.point.resolved_cases}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
