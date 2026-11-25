import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Calendar,
  CheckCircle2,
  Download,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { exportOverviewPdfReport } from '../lib/exportPdfReport.ts';
import { formatZmw } from '../lib/roles.ts';
import type { DashboardSummary } from '../types/payroll.ts';
import { MonthlyTrendsChart } from './MonthlyTrendsChart.tsx';
import { RegionalAnomaliesHeatmap } from './RegionalAnomaliesHeatmap.tsx';
import { TechnicalReportModal } from './TechnicalReportModal.tsx';

export type NavTab =
  | 'overview'
  | 'register'
  | 'verify'
  | 'validate'
  | 'review'
  | 'audit';

const AVAILABLE_MONTHS = [
  { value: '2026-06', label: 'Jun 2026' },
  { value: '2026-07', label: 'Jul 2026' },
  { value: '2026-08', label: 'Aug 2026' },
  { value: '2026-09', label: 'Sep 2026' },
  { value: '2026-10', label: 'Oct 2026' },
  { value: '2026-11', label: 'Nov 2026' },
];

interface OverviewReportViewProps {
  data: DashboardSummary | null;
  loading: boolean;
  refreshing?: boolean;
  dateRange: { start_month: string; end_month: string };
  generatedBy: string;
  onDateRangeChange: (nextRange: { start_month: string; end_month: string }) => void;
  onNavigate: (tab: NavTab) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function OverviewReportView({
  data,
  loading,
  refreshing = false,
  dateRange,
  generatedBy,
  onDateRangeChange,
  onNavigate,
  onNotify,
}: OverviewReportViewProps) {
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  async function handleExportPdf() {
    if (!data) return;
    setExportingPdf(true);
    try {
      const svgEl = document.querySelector<SVGSVGElement>('svg[data-chart="monthly-trends"]');
      const fileName = await exportOverviewPdfReport({
        data,
        dateRange,
        svgElement: svgEl,
        generatedBy,
      });
      onNotify('success', `Exported stakeholder PDF report (${fileName}).`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to export PDF report.');
    } finally {
      setExportingPdf(false);
    }
  }
  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-lg border border-slate-200 bg-white p-5"
            />
          ))}
        </div>
        <div className="h-64 rounded-lg border border-slate-200 bg-white p-6" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        Dashboard metrics unavailable. Ensure the backend service is active.
      </div>
    );
  }

  const workflowSteps: Array<{
    step: string;
    title: string;
    metric: string;
    detail: string;
    tab: NavTab;
  }> = [
    {
      step: '01',
      title: 'Register',
      metric: `${data.workflow_counts.registered} Staff IDs`,
      detail: 'Authoritative HR & post records',
      tab: 'register',
    },
    {
      step: '02',
      title: 'Verify',
      metric: `${data.workflow_counts.verified_this_cycle} Checks`,
      detail: 'Station & roll-call evidence',
      tab: 'verify',
    },
    {
      step: '03',
      title: 'Validate',
      metric: `${data.workflow_counts.validated_rules} Rules Active`,
      detail: 'HR vs PMEC extract checks',
      tab: 'validate',
    },
    {
      step: '04',
      title: 'Review',
      metric: `${data.workflow_counts.under_review} Open Cases`,
      detail: 'Due-process investigation',
      tab: 'review',
    },
    {
      step: '05',
      title: 'Report',
      metric: `${data.audit_chain_length} Audit Logs`,
      detail: 'Continuous oversight & trail',
      tab: 'audit',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Procedural Fairness & Architectural Mandate */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white px-6 py-5 lg:flex-row lg:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Unified PMEC Control Layer · Procedural Fairness Active</span>
          </div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">
            Public Sector Payroll Integrity &amp; Establishment Control
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
            HR records, approved posts, station verifications, and PMEC extracts operate on one authoritative Staff ID dataset. Automated validation flags open review cases with assigned deadlines and never trigger automatic salary stoppages.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('review')}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <span>Inspect Open Cases</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Date Range Filter Controls */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white px-6 py-4 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <Calendar className="h-4 w-4 text-emerald-700" />
            <span>Reporting Period</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() =>
                onDateRangeChange({ start_month: '2026-11', end_month: '2026-11' })
              }
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                dateRange.start_month === '2026-11' && dateRange.end_month === '2026-11'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Current Month
            </button>
            <button
              type="button"
              onClick={() =>
                onDateRangeChange({ start_month: '2026-09', end_month: '2026-11' })
              }
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                dateRange.start_month === '2026-09' && dateRange.end_month === '2026-11'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 3 Months
            </button>
            <button
              type="button"
              onClick={() =>
                onDateRangeChange({ start_month: '2026-06', end_month: '2026-11' })
              }
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                dateRange.start_month === '2026-06' && dateRange.end_month === '2026-11'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Last 6 Months
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2">
            <label htmlFor="period-start" className="font-medium text-slate-600">
              From
            </label>
            <select
              id="period-start"
              value={dateRange.start_month}
              onChange={(e) => {
                const nextStart = e.target.value;
                onDateRangeChange({
                  start_month: nextStart,
                  end_month: nextStart > dateRange.end_month ? nextStart : dateRange.end_month,
                });
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-emerald-700 focus:outline-none"
            >
              {AVAILABLE_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="period-end" className="font-medium text-slate-600">
              To
            </label>
            <select
              id="period-end"
              value={dateRange.end_month}
              onChange={(e) => {
                const nextEnd = e.target.value;
                onDateRangeChange({
                  start_month: nextEnd < dateRange.start_month ? nextEnd : dateRange.start_month,
                  end_month: nextEnd,
                });
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-emerald-700 focus:outline-none"
            >
              {AVAILABLE_MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {(dateRange.start_month !== '2026-06' || dateRange.end_month !== '2026-11') && (
            <button
              type="button"
              onClick={() =>
                onDateRangeChange({ start_month: '2026-06', end_month: '2026-11' })
              }
              className="font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          )}

          {refreshing && (
            <span className="text-slate-500">Updating...</span>
          )}

          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            disabled={!data}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FileText className="h-3.5 w-3.5 text-emerald-700" />
            <span>Seminar Report &amp; Fig. 3.1</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exportingPdf || !data}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-emerald-700" />
            <span>{exportingPdf ? 'Exporting PDF...' : 'Export PDF Report'}</span>
          </button>
        </div>
      </div>

      {/* 4-Column Evaluation KPI Strip (Section 2.9 Indicators) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">
            Station Verification Match
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.verified_station_pct}%
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              ({data.verified_station_count} of {data.total_staff} staff)
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Monthly gross roll: <span className="font-mono text-slate-700">{formatZmw(data.total_monthly_gross_zmw)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">
            Open Exceptions Under Review
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-amber-700 tabular-nums">
              {data.open_cases_count}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {data.overdue_cases_count > 0
                ? `${data.overdue_cases_count} overdue deadline`
                : 'All within deadline'}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Flagged exposure: <span className="font-mono text-slate-800">{formatZmw(data.total_exposure_zmw)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">
            Case Resolution Turnaround
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.avg_turnaround_days} days
            </span>
            <span className="text-xs text-emerald-700">
              {data.resolved_cases_count} resolved
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Salaries protected during investigation
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">
            Pending Recruitment Placements
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.pending_placement_count}
            </span>
            <span className="text-xs text-slate-500">
              awaiting PMEC placement
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Active on payroll: <span className="font-mono text-slate-700">{data.active_on_payroll}</span>
          </div>
        </div>
      </div>

      {/* 5-Step Digital Control Workflow Strip (Section 3.1) */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            5-Step Digital Control Workflow
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Select any stage to inspect records, log verifications, run validation rules, or review exception cases.
          </p>
        </div>
        <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-5 md:divide-x md:divide-y-0">
          {workflowSteps.map((item) => (
            <button
              key={item.step}
              type="button"
              onClick={() => onNavigate(item.tab)}
              className="group flex flex-col justify-between p-5 text-left transition-colors hover:bg-slate-50"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono font-medium text-emerald-700">
                    Step {item.step}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
                </div>
                <div className="mt-1.5 font-display text-base font-semibold text-slate-900">
                  {item.title}
                </div>
                <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
              </div>
              <div className="mt-4 font-mono text-sm font-medium text-slate-800 tabular-nums">
                {item.metric}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Compact Control Summary Cards Directly Above Trend Chart */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <button
          type="button"
          onClick={() => onNavigate('verify')}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <div>
            <div className="text-xs font-medium text-slate-500">
              Total Pending Validations
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {data.pending_validations_count}
              </span>
              <span className="text-xs text-slate-500">
                records awaiting check
              </span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('review')}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <div>
            <div className="text-xs font-medium text-slate-500">
              Active Exception Cases
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-amber-700 tabular-nums">
                {data.open_cases_count}
              </span>
              <span className="text-xs text-slate-500 tabular-nums">
                {formatZmw(data.total_exposure_zmw)} under review
              </span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('validate')}
          className="group flex items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <div>
            <div className="text-xs font-medium text-slate-500">
              Total Reconciliation Discrepancies
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-red-700 tabular-nums">
                {data.reconciliation_discrepancies_count}
              </span>
              <span className="text-xs text-slate-500">
                HR vs PMEC extract
              </span>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-700" />
        </button>
      </div>

      {/* Urgent Payroll Alerts Card (Stations exceeding +10% variance spike) */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {(data.urgent_payroll_alerts?.length ?? 0) > 0 ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              )}
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Urgent Payroll Alerts
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                · {data.urgent_payroll_alerts?.length ?? 0}{' '}
                {(data.urgent_payroll_alerts?.length ?? 0) === 1 ? 'station' : 'stations'} &gt; +10% spike
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Stations with month-over-month flagged variance spikes exceeding 10% in the selected reporting period (triggers case review without salary stoppage).
            </p>
          </div>
          {(data.urgent_payroll_alerts?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('review')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <span>Inspect Flagged Cases</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {!data.urgent_payroll_alerts || data.urgent_payroll_alerts.length === 0 ? (
          <div className="flex items-center gap-3 px-6 py-5 text-xs text-slate-600">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>
              No stations exceed the +10% variance threshold in the selected reporting period ({data.period.start_month} to {data.period.end_month}).
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Station &amp; District</th>
                  <th className="px-4 py-3 text-right font-medium">Prior Baseline</th>
                  <th className="px-4 py-3 text-right font-medium">Current Variance</th>
                  <th className="px-4 py-3 text-right font-medium">Variance Spike</th>
                  <th className="px-4 py-3 text-right font-medium">Open Cases</th>
                  <th className="px-6 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.urgent_payroll_alerts.map((alert) => (
                  <tr key={alert.station_id} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5">
                      <div className="font-medium text-slate-900">{alert.station_name}</div>
                      <div className="mt-0.5 font-mono text-slate-500">
                        {alert.station_code} · {alert.district}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-600 tabular-nums">
                      <div>{formatZmw(alert.baseline_variance_zmw)}</div>
                      <div className="text-slate-400">{alert.baseline_month}</div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-900 tabular-nums">
                      <div>{formatZmw(alert.current_variance_zmw)}</div>
                      <div className="text-slate-500">{alert.current_month}</div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                      <div className="font-semibold text-red-700">
                        +{alert.spike_pct.toFixed(1)}% spike
                      </div>
                      <div className="text-slate-500">
                        +{formatZmw(alert.variance_delta_zmw)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                      <span className="font-semibold text-amber-700">
                        {alert.open_cases_count}
                      </span>{' '}
                      <span className="text-slate-500">
                        {alert.open_cases_count === 1 ? 'case' : 'cases'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => onNavigate('review')}
                        className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap"
                      >
                        <span>Review</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 6-Month D3 Trend Line Chart: Payroll Variances & Exception Cases */}
      <MonthlyTrendsChart data={data.monthly_trends ?? []} />

      {/* Regional Payroll Anomalies Heatmap (Geographic Hotspots by District & Control Rule) */}
      <RegionalAnomaliesHeatmap
        rows={data.regional_anomalies ?? []}
        period={data.period}
        onNavigate={onNavigate}
      />

      {/* Top Performance Card (Station Ranking by Validation Completion Rate) */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 shrink-0 text-emerald-700" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Top Performance
              </h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                · {data.top_performing_stations?.length ?? 0} pilot stations ranked
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Stations ranked by validation completion rate across workstation verifications, monthly return submissions, and exception case clearance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('verify')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <span>Log Station Verification</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="w-16 px-6 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Station &amp; District</th>
                <th className="px-4 py-3 text-right font-medium">Workstation Checks</th>
                <th className="px-4 py-3 text-right font-medium">Open Cases</th>
                <th className="px-4 py-3 font-medium">Monthly Return</th>
                <th className="w-56 px-4 py-3 font-medium">Completion Rate</th>
                <th className="px-6 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(data.top_performing_stations ?? []).map((stn) => {
                const isTop = stn.validation_completion_rate >= 75;
                const isMid = stn.validation_completion_rate >= 50;
                return (
                  <tr key={stn.station_id} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5 font-mono font-semibold text-slate-700 tabular-nums">
                      #{String(stn.rank).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">{stn.station_name}</div>
                      <div className="mt-0.5 font-mono text-slate-500">
                        {stn.station_code} · {stn.district}, {stn.province}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                      {stn.verified_staff}/{stn.total_staff} verified
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                      <span
                        className={
                          stn.open_cases > 0
                            ? 'font-semibold text-amber-700'
                            : 'font-medium text-emerald-700'
                        }
                      >
                        {stn.open_cases}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={
                          stn.return_submitted
                            ? 'font-medium text-emerald-700'
                            : 'font-medium text-amber-700'
                        }
                      >
                        {stn.return_submitted ? 'Submitted' : 'Overdue'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-slate-100">
                          <div
                            style={{ width: `${Math.min(100, stn.validation_completion_rate)}%` }}
                            className={`h-full transition-all ${
                              isTop
                                ? 'bg-emerald-700'
                                : isMid
                                  ? 'bg-amber-600'
                                  : 'bg-red-600'
                            }`}
                          />
                        </div>
                        <span
                          className={`w-14 text-right font-mono font-semibold tabular-nums ${
                            isTop
                              ? 'text-emerald-700'
                              : isMid
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {stn.validation_completion_rate.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                        {stn.completed_checks}/{stn.total_checks} control checks cleared
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => onNavigate(stn.open_cases > 0 ? 'review' : 'register')}
                        className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap"
                      >
                        <span>{stn.open_cases > 0 ? 'Clear Cases' : 'Register'}</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Two-Column Breakdown: Automated Rules vs Audit Findings & Pilot District Coverage */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-lg border border-slate-200 bg-white xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Continuous Validation Rules Mapped to Auditor General Findings
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Every documented control gap (2024–2026) is tested automatically before payroll runs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('validate')}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap shrink-0"
            >
              Open Validation Engine
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Control Rule</th>
                  <th className="px-4 py-3 font-medium">Documented Audit Finding</th>
                  <th className="px-4 py-3 text-right font-medium">Open Cases</th>
                  <th className="px-6 py-3 text-right font-medium">Resolved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.rule_breakdown.map((rule) => (
                  <tr key={rule.rule_code} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-900">
                      {rule.rule_label}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{rule.audit_finding}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      <span
                        className={
                          rule.open_count > 0
                            ? 'font-semibold text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {rule.open_count}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-slate-600 tabular-nums">
                      {rule.resolved_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Pilot District Coverage
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Phased deployment across selected pilot districts prior to national rollout.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">District</th>
                  <th className="px-3 py-3 text-right font-medium">Verified</th>
                  <th className="px-6 py-3 text-right font-medium">Open Cases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.district_breakdown.map((d) => (
                  <tr key={d.district} className="hover:bg-slate-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-slate-900">{d.district}</div>
                      <div className="text-slate-500">
                        {d.station_count} {d.station_count === 1 ? 'station' : 'stations'} · {d.staff_count} staff
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-slate-800 tabular-nums">
                      {d.verified_count}/{d.staff_count}
                    </td>
                    <td className="px-6 py-3 text-right font-mono tabular-nums">
                      <span
                        className={
                          d.open_cases > 0
                            ? 'font-semibold text-amber-700'
                            : 'text-emerald-700'
                        }
                      >
                        {d.open_cases}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <TechnicalReportModal
        open={showReportModal}
        onClose={() => setShowReportModal(false)}
        data={data}
        onNotify={onNotify}
      />
    </div>
  );
}
