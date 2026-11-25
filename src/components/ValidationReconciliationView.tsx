import { useEffect, useState } from 'react';
import { Play, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatZmw } from '../lib/roles.ts';
import type { DashboardSummary, ReconciliationItem } from '../types/payroll.ts';

interface ValidationReconciliationViewProps {
  dashboard: DashboardSummary | null;
  reconciliation: ReconciliationItem[];
  focusedStaff?: { staffId: string; nonce: number } | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const RULE_CATALOG = [
  {
    code: 'unique_identity',
    title: '01. Unique Identity',
    check: 'One Staff ID per person; flags duplicate Staff IDs, NRCs, bank accounts, or PMEC records absent from HR.',
    finding: 'Duplicate & ghost entries (Section 2.1)',
  },
  {
    code: 'age_bounds',
    title: '02. Age Bounds',
    check: 'Date of birth must calculate to an age within permitted public service range (18–65 years).',
    finding: '205 underage entries (2024 Audit)',
  },
  {
    code: 'net_pay_threshold',
    title: '03. Net-Pay Threshold',
    check: 'Take-home net pay must not fall below the statutory 40% minimum of gross pay.',
    finding: '108 threshold breaches (2024 Audit)',
  },
  {
    code: 'station_match',
    title: '04. Station Match',
    check: 'Each active employee links to an approved post, verified station, and matching PMEC station code.',
    finding: '125 officers unaccounted across 24 stations (2025)',
  },
  {
    code: 'absence_tracking',
    title: '05. Absence Tracking',
    check: 'Absence beyond threshold raises a case until leave approval or return-to-duty is updated.',
    finding: '4 officers absent > 12 months, K224,612 (2025)',
  },
  {
    code: 'placement_ageing',
    title: '06. Placement Ageing',
    check: 'Recruited officers not placed on active PMEC payroll within 60 days are listed for follow-up.',
    finding: '1,524 of 4,319 teachers pending placement (Mar 2026)',
  },
];

export function ValidationReconciliationView({
  dashboard,
  reconciliation,
  focusedStaff,
  onRefresh,
  onNotify,
}: ValidationReconciliationViewProps) {
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'mismatches'>('all');
  const [staffFilter, setStaffFilter] = useState<string>('');

  useEffect(() => {
    if (focusedStaff?.staffId) {
      setStatusFilter('all');
      setStaffFilter(focusedStaff.staffId);
    }
  }, [focusedStaff]);

  const visibleItems = reconciliation.filter((r) => {
    if (statusFilter === 'mismatches' && r.match_status === 'Matched') return false;
    if (staffFilter && r.staff_id !== staffFilter) return false;
    return true;
  });

  const mismatchCount = reconciliation.filter((r) => r.match_status !== 'Matched').length;

  async function handleRunValidation() {
    setRunning(true);
    try {
      const result = await api.runValidationCycle();
      await onRefresh();
      onNotify(
        'success',
        `Validation complete: checked ${result.records_checked} records across 6 rules. Opened ${result.new_cases_opened} new case(s); ${result.total_open_cases} total open for review.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Validation run failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Control Action Header */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white px-6 py-5 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Continuous Validation Engine &amp; PMEC Reconciliation
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Compares the authoritative HR register against the monthly PMEC payroll extract and executes all 6 statutory validation rules prior to salary disbursement.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRunValidation}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Play className="h-3.5 w-3.5" />
          <span>{running ? 'Running Validation...' : 'Run Validation & Reconciliation Cycle'}</span>
        </button>
      </div>

      {/* 6 Automated Validation Rules Grid (Table 3.1) */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Automated Validation Rules (Table 3.1)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              A failed rule opens a traceable review case and never stops a salary automatically.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <span>Due-process review mode</span>
          </div>
        </div>
        <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-2 md:divide-x lg:grid-cols-3">
          {RULE_CATALOG.map((rule) => {
            const live = dashboard?.rule_breakdown.find((r) => r.rule_code === rule.code);
            return (
              <div key={rule.code} className="flex flex-col justify-between p-5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-slate-900">
                      {rule.title}
                    </span>
                    <span
                      className={`font-mono text-xs font-medium tabular-nums ${
                        (live?.open_count ?? 0) > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {live?.open_count ?? 0} open
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">{rule.check}</p>
                </div>
                <div className="mt-4 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                  Addresses: <span className="text-slate-700">{rule.finding}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* HR Register vs PMEC Extract Reconciliation Table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              PMEC Extract vs. Authoritative HR Register Reconciliation (2026-11)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {reconciliation.length} total records compared · {mismatchCount} reconciliation discrepancy item(s) detected
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {staffFilter && (
              <button
                type="button"
                onClick={() => setStaffFilter('')}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700 hover:bg-slate-50"
              >
                <span>Filtered: {staffFilter}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                  statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                All Lines ({reconciliation.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('mismatches')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                  statusFilter === 'mismatches'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600'
                }`}
              >
                Discrepancies Only ({mismatchCount})
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Staff ID &amp; Officer</th>
                <th className="px-4 py-3 font-medium">HR Station</th>
                <th className="px-4 py-3 font-medium">PMEC Station</th>
                <th className="px-4 py-3 text-right font-medium">HR Net Pay</th>
                <th className="px-4 py-3 text-right font-medium">PMEC Net Pay</th>
                <th className="px-6 py-3 font-medium">Reconciliation Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleItems.map((item) => {
                const isOk = item.match_status === 'Matched';
                return (
                  <tr key={item.staff_id} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5">
                      <div className="font-mono font-medium text-slate-900">{item.staff_id}</div>
                      <div className="text-slate-600">{item.full_name}</div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-700">
                      {item.hr_station_code ?? 'Missing in HR'}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-700">
                      {item.pmec_station_code ?? 'Not on PMEC'}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                      {item.hr_net_pay !== null ? formatZmw(item.hr_net_pay) : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                      {item.pmec_net_pay !== null ? formatZmw(item.pmec_net_pay) : '—'}
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`font-medium ${
                          isOk
                            ? 'text-emerald-700'
                            : item.match_status === 'Unmatched in HR (Potential Ghost)'
                              ? 'text-red-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {item.match_status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
