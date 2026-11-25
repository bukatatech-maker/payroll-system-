import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { ArrowRight, MapPin } from 'lucide-react';
import { formatZmw } from '../lib/roles.ts';
import type { RegionalAnomalyCell, RegionalAnomalyRow } from '../types/payroll.ts';
import type { NavTab } from './OverviewReportView.tsx';

interface RegionalAnomaliesHeatmapProps {
  rows: RegionalAnomalyRow[];
  period: { start_month: string; end_month: string };
  onNavigate: (tab: NavTab) => void;
}

type HeatmapMetric = 'exposure' | 'count';

export function RegionalAnomaliesHeatmap({
  rows,
  period,
  onNavigate,
}: RegionalAnomaliesHeatmapProps) {
  const [metric, setMetric] = useState<HeatmapMetric>('exposure');
  const [hovered, setHovered] = useState<{
    row: RegionalAnomalyRow;
    cell: RegionalAnomalyCell;
  } | null>(null);

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    return rows[0].cells.map((c) => ({
      rule_code: c.rule_code,
      rule_short_label: c.rule_short_label,
    }));
  }, [rows]);

  const maxMetricValue = useMemo(() => {
    let maxVal = 0;
    for (const r of rows) {
      for (const c of r.cells) {
        const val = metric === 'exposure' ? c.exposure_zmw : c.count;
        if (val > maxVal) maxVal = val;
      }
    }
    return Math.max(metric === 'exposure' ? 10000 : 1, maxVal);
  }, [rows, metric]);

  const colorScale = useMemo(() => {
    return d3
      .scaleSequential<string>()
      .domain([0, maxMetricValue])
      .interpolator(
        d3.interpolateRgbBasis(['#fef3c7', '#f59e0b', '#dc2626', '#991b1b'])
      );
  }, [maxMetricValue]);

  const topHotspot = rows.find((r) => r.total_exposure_zmw > 0 || r.total_cases > 0) ?? null;
  const totalExposureAll = rows.reduce((s, r) => s + r.total_exposure_zmw, 0);

  function getCellStyle(value: number): { backgroundColor: string; color: string } {
    if (value <= 0) {
      return { backgroundColor: '#f8fafc', color: '#94a3b8' };
    }
    // Use log-weighted normalization when exposure spans orders of magnitude so moderate hotspots stay distinct
    const normalized =
      metric === 'exposure'
        ? Math.pow(value / maxMetricValue, 0.55) * maxMetricValue
        : value;
    const bg = colorScale(normalized);
    const ratio = normalized / maxMetricValue;
    return {
      backgroundColor: bg,
      color: ratio >= 0.48 ? '#ffffff' : '#0f172a',
    };
  }

  function formatCompactZmw(val: number): string {
    if (val === 0) return '—';
    if (val >= 1000) {
      const k = val / 1000;
      return `K${k >= 10 ? k.toFixed(0) : k.toFixed(1)}k`;
    }
    return `K${val.toLocaleString('en-US')}`;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-6 py-4 lg:flex-row lg:items-center">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-red-700" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Regional Payroll Anomalies Heatmap
            </h2>
            <span className="font-mono text-xs text-slate-500">
              · {period.start_month} to {period.end_month}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Geographic concentration of open validation anomalies by District (Province) and statutory control rule to prioritize district verifications.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMetric('exposure')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                metric === 'exposure'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Exposure (ZMW)
            </button>
            <button
              type="button"
              onClick={() => setMetric('count')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                metric === 'count'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Case Count
            </button>
          </div>
        </div>
      </div>

      {/* Priority Hotspot Summary Bar */}
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200 bg-slate-50 px-6 py-3 text-xs sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {topHotspot ? (
            <>
              <span className="text-slate-600">
                Top Priority Hotspot:{' '}
                <strong className="font-semibold text-slate-900">
                  {topHotspot.district} ({topHotspot.province})
                </strong>
              </span>
              <span className="font-mono font-semibold text-red-700 tabular-nums">
                {formatZmw(topHotspot.total_exposure_zmw)} exposure · {topHotspot.total_cases} open{' '}
                {topHotspot.total_cases === 1 ? 'case' : 'cases'}
              </span>
              {totalExposureAll > 0 && (
                <span className="font-mono text-slate-500 tabular-nums">
                  ({((topHotspot.total_exposure_zmw / totalExposureAll) * 100).toFixed(0)}% of regional total)
                </span>
              )}
            </>
          ) : (
            <span className="text-emerald-700 font-medium">
              All pilot districts show zero open anomalies in this reporting period.
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onNavigate('verify')}
          className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0"
        >
          <span>Dispatch District Verification</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Heatmap Matrix */}
      <div className="p-6">
        {rows.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No regional anomaly data available for the selected reporting period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-separate border-spacing-1.5 text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-2 pr-3 text-left font-medium">District · Province</th>
                  <th className="px-2 py-2 text-center font-medium">Priority</th>
                  {columns.map((col) => (
                    <th key={col.rule_code} className="px-2 py-2 text-center font-medium">
                      {col.rule_short_label}
                    </th>
                  ))}
                  <th className="py-2 pl-3 text-right font-medium">District Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.district}>
                    <td className="py-1 pr-3 align-middle">
                      <div className="font-medium text-slate-900">{row.district}</div>
                      <div className="text-[11px] text-slate-500">
                        {row.province} · {row.station_count}{' '}
                        {row.station_count === 1 ? 'station' : 'stations'}
                      </div>
                    </td>

                    <td className="px-2 py-1 text-center align-middle">
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          row.priority_tier === 'Critical'
                            ? 'text-red-700'
                            : row.priority_tier === 'High'
                              ? 'text-amber-700'
                              : row.priority_tier === 'Moderate'
                                ? 'text-slate-700'
                                : 'text-emerald-700'
                        }`}
                      >
                        {row.priority_tier}
                      </span>
                    </td>

                    {row.cells.map((cell) => {
                      const val = metric === 'exposure' ? cell.exposure_zmw : cell.count;
                      const style = getCellStyle(val);
                      const isActive = val > 0;
                      return (
                        <td key={cell.rule_code} className="p-0 align-middle">
                          <button
                            type="button"
                            onClick={() => onNavigate(isActive ? 'review' : 'validate')}
                            onMouseEnter={() => setHovered({ row, cell })}
                            onMouseLeave={() => setHovered(null)}
                            onFocus={() => setHovered({ row, cell })}
                            onBlur={() => setHovered(null)}
                            style={style}
                            title={`${row.district} (${row.province}) · ${cell.rule_short_label}: ${cell.count} case(s), ${formatZmw(cell.exposure_zmw)}`}
                            className={`flex h-11 w-full flex-col items-center justify-center rounded border px-2 font-mono tabular-nums transition-transform ${
                              isActive
                                ? 'border-slate-300/60 hover:scale-[1.03] hover:border-slate-900'
                                : 'border-slate-200/80 hover:border-slate-300'
                            }`}
                          >
                            <span className="text-xs font-semibold leading-tight">
                              {metric === 'exposure'
                                ? formatCompactZmw(cell.exposure_zmw)
                                : cell.count > 0
                                  ? String(cell.count)
                                  : '—'}
                            </span>
                            {isActive && (
                              <span className="text-[10px] opacity-85 leading-tight">
                                {metric === 'exposure'
                                  ? `${cell.count} ${cell.count === 1 ? 'case' : 'cases'}`
                                  : formatCompactZmw(cell.exposure_zmw)}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}

                    <td className="py-1 pl-3 text-right align-middle font-mono tabular-nums">
                      <div className="font-semibold text-slate-900">
                        {formatZmw(row.total_exposure_zmw)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {row.total_cases} {row.total_cases === 1 ? 'case' : 'cases'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Color Intensity Scale & Live Hover Detail */}
        <div className="mt-4 flex flex-col justify-between gap-3 border-t border-slate-100 pt-3 text-[11px] text-slate-600 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Intensity:</span>
            <span className="font-mono text-slate-500">0</span>
            <div className="flex items-center gap-1">
              {[0, 0.2, 0.45, 0.72, 1].map((step) => {
                const bg =
                  step === 0 ? '#f8fafc' : colorScale(step * maxMetricValue);
                return (
                  <span
                    key={step}
                    style={{ backgroundColor: bg }}
                    className="inline-block h-3.5 w-6 rounded-sm border border-slate-200"
                  />
                );
              })}
            </div>
            <span className="font-mono text-slate-700">
              {metric === 'exposure' ? formatCompactZmw(maxMetricValue) : `${maxMetricValue} cases`}
            </span>
          </div>

          <div className="min-h-[18px] font-mono text-slate-700">
            {hovered ? (
              <span>
                {hovered.row.district} ({hovered.row.province}) · {hovered.cell.rule_short_label}:{' '}
                <strong>{hovered.cell.count}</strong> open{' '}
                {hovered.cell.count === 1 ? 'case' : 'cases'} ·{' '}
                <strong>{formatZmw(hovered.cell.exposure_zmw)}</strong> (click cell to review)
              </span>
            ) : (
              <span className="font-sans text-slate-400">
                Hover any cell for breakdown · Click a hotspot cell to open Cases &amp; Due Process
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
