import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Scale,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatShortDate, formatZmw } from '../lib/roles.ts';
import type {
  AuditLogEntry,
  EmployeeRecord,
  EmployeeSearchResult,
  ExceptionCase,
  ReconciliationItem,
  VerificationRecord,
} from '../types/payroll.ts';
import type { NavTab } from './OverviewReportView.tsx';

interface GlobalEmployeeSearchProps {
  employees: EmployeeRecord[];
  verifications: VerificationRecord[];
  reconciliation: ReconciliationItem[];
  cases: ExceptionCase[];
  auditLogs: AuditLogEntry[];
  disabled?: boolean;
  onJumpToTab: (tab: NavTab, staffId: string) => void;
}

export function GlobalEmployeeSearch({
  employees,
  verifications,
  reconciliation,
  cases,
  auditLogs,
  disabled = false,
  onJumpToTab,
}: GlobalEmployeeSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [remoteResults, setRemoteResults] = useState<EmployeeSearchResult[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Instant local fallback so typing feels immediate before API resolves
  const localResults = useMemo<EmployeeSearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const openCaseCountByStaff = new Map<string, number>();
    for (const c of cases) {
      if (c.status === 'Open' || c.status === 'Under Investigation') {
        openCaseCountByStaff.set(c.staff_id, (openCaseCountByStaff.get(c.staff_id) ?? 0) + 1);
      }
    }

    const empMatches: EmployeeSearchResult[] = employees
      .filter(
        (e) =>
          e.staff_id.toLowerCase().includes(q) ||
          e.full_name.toLowerCase().includes(q) ||
          e.nrc_number.toLowerCase().includes(q) ||
          (e.station_name ?? '').toLowerCase().includes(q)
      )
      .slice(0, 10)
      .map((e) => ({
        staff_id: e.staff_id,
        full_name: e.full_name,
        nrc_number: e.nrc_number,
        station_id: e.station_id,
        station_code: null,
        station_name: e.station_name ?? e.station_id,
        district: e.district ?? '',
        post_code: e.post_code ?? null,
        post_title: e.post_title ?? null,
        employment_status: e.employment_status,
        gross_pay: e.gross_pay,
        net_pay: e.net_pay,
        last_verification_outcome: e.last_verification_outcome,
        open_cases_count: openCaseCountByStaff.get(e.staff_id) ?? 0,
        source: 'register',
      }));

    const regIds = new Set(empMatches.map((m) => m.staff_id));
    const reconMatches: EmployeeSearchResult[] = reconciliation
      .filter(
        (r) =>
          !regIds.has(r.staff_id) &&
          (r.staff_id.toLowerCase().includes(q) || r.full_name.toLowerCase().includes(q))
      )
      .slice(0, 4)
      .map((r) => ({
        staff_id: r.staff_id,
        full_name: r.full_name,
        nrc_number: null,
        station_id: null,
        station_code: r.pmec_station_code,
        station_name: r.pmec_station_code ? `PMEC (${r.pmec_station_code})` : 'Unmatched PMEC',
        district: 'Unmatched PMEC',
        post_code: null,
        post_title: null,
        employment_status: r.match_status,
        gross_pay: 0,
        net_pay: r.pmec_net_pay ?? 0,
        last_verification_outcome: null,
        open_cases_count: openCaseCountByStaff.get(r.staff_id) ?? 0,
        source: 'pmec_unmatched',
      }));

    return [...empMatches, ...reconMatches];
  }, [query, employees, reconciliation, cases]);

  // Debounced live SQLite search via /api/employees/search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || disabled) {
      setRemoteResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchEmployees(trimmed);
        if (!cancelled) {
          setRemoteResults(res.results);
        }
      } catch {
        if (!cancelled) {
          setRemoteResults(null);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, disabled]);

  const results = remoteResults ?? localResults;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  // Global Cmd+K / Ctrl+K shortcut to focus Top Bar Search
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelectResult(staffId: string) {
    setSelectedStaffId(staffId);
    setOpen(false);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter') && query.trim()) {
      setOpen(true);
      return;
    }
    if (!open || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[activeIndex] ?? results[0];
      if (target) {
        handleSelectResult(target.staff_id);
      }
    }
  }

  const dossierEmployee = useMemo(
    () =>
      selectedStaffId
        ? employees.find((e) => e.staff_id === selectedStaffId) ?? null
        : null,
    [selectedStaffId, employees]
  );

  const dossierSummary = useMemo(
    () =>
      selectedStaffId
        ? results.find((r) => r.staff_id === selectedStaffId) ?? null
        : null,
    [selectedStaffId, results]
  );

  const dossierVerifications = useMemo(
    () =>
      selectedStaffId
        ? verifications.filter((v) => v.staff_id === selectedStaffId).slice(0, 4)
        : [],
    [selectedStaffId, verifications]
  );

  const dossierRecon = useMemo(
    () =>
      selectedStaffId
        ? reconciliation.find((r) => r.staff_id === selectedStaffId) ?? null
        : null,
    [selectedStaffId, reconciliation]
  );

  const dossierCases = useMemo(
    () =>
      selectedStaffId
        ? cases.filter((c) => c.staff_id === selectedStaffId)
        : [],
    [selectedStaffId, cases]
  );

  const dossierAudits = useMemo(
    () =>
      selectedStaffId
        ? auditLogs.filter((a) => a.target_id === selectedStaffId).slice(0, 4)
        : [],
    [selectedStaffId, auditLogs]
  );

  function jump(tab: NavTab) {
    if (!selectedStaffId) return;
    const targetId = selectedStaffId;
    setSelectedStaffId(null);
    onJumpToTab(tab, targetId);
  }

  return (
    <>
      <div ref={containerRef} className="relative w-full max-w-sm lg:max-w-md">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            disabled={disabled}
            onFocus={() => {
              if (query.trim()) setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Lookup employee by Staff ID or name..."
            aria-label="Global employee lookup by Staff ID or name"
            aria-expanded={open && query.trim().length > 0}
            aria-autocomplete="list"
            className="w-full rounded-md border border-slate-300 bg-slate-50 py-1.5 pl-9 pr-14 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:bg-white focus:outline-none disabled:opacity-50"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setRemoteResults(null);
                setOpen(false);
                inputRef.current?.focus();
              }}
              aria-label="Clear employee search"
              className="absolute right-2 rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2 hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400 sm:inline-block">
              ⌘K
            </kbd>
          )}
        </div>

        {/* Search Dropdown */}
        {open && query.trim().length > 0 && (
          <div
            role="listbox"
            aria-label="Employee search results"
            className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              <span>
                {searching
                  ? 'Searching across payroll register & PMEC...'
                  : `${results.length} matching employee${results.length === 1 ? '' : 's'}`}
              </span>
              <span className="font-mono text-slate-400">Enter to inspect</span>
            </div>

            {results.length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-slate-500">
                No employee matched <span className="font-mono text-slate-700">"{query.trim()}"</span> by Staff ID, name, NRC, or station.
              </div>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {results.map((item, index) => {
                  const isHighlighted = index === activeIndex;
                  return (
                    <li key={`${item.source}-${item.staff_id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => handleSelectResult(item.staff_id)}
                        className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs transition-colors ${
                          isHighlighted ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-emerald-700">
                              {item.staff_id}
                            </span>
                            <span className="truncate font-medium text-slate-900">
                              {item.full_name}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {item.station_name}
                            {item.district ? ` · ${item.district}` : ''}
                            {item.post_title ? ` · ${item.post_title}` : ''}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div
                            className={`text-[11px] font-medium ${
                              item.source === 'pmec_unmatched'
                                ? 'text-red-700'
                                : item.open_cases_count > 0
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {item.source === 'pmec_unmatched'
                              ? 'Unmatched PMEC'
                              : item.open_cases_count > 0
                                ? `${item.open_cases_count} open case${item.open_cases_count === 1 ? '' : 's'}`
                                : item.employment_status}
                          </div>
                          <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                            {formatZmw(item.net_pay)} net
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Cross-Application Employee Dossier Modal */}
      {selectedStaffId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dossier-title"
            className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>Cross-Application Staff Dossier · Unified Staff ID Lookup</span>
                </div>
                <h2
                  id="dossier-title"
                  className="mt-1 font-display text-lg font-semibold text-slate-900"
                >
                  {dossierEmployee?.full_name ?? dossierSummary?.full_name ?? selectedStaffId}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-600">
                  <span>{selectedStaffId}</span>
                  {dossierEmployee?.nrc_number && (
                    <span>NRC {dossierEmployee.nrc_number}</span>
                  )}
                  <span>
                    {dossierEmployee?.station_name ??
                      dossierSummary?.station_name ??
                      'Unmatched Station'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffId(null)}
                aria-label="Close staff dossier"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-xs">
              {/* Authoritative Register Snapshot */}
              {dossierEmployee ? (
                <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                    <span className="font-display text-xs font-semibold text-slate-900">
                      01 · Authoritative Staff Register &amp; Approved Post
                    </span>
                    <span
                      className={`font-medium ${
                        dossierEmployee.employment_status === 'Active'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {dossierEmployee.employment_status} ·{' '}
                      {dossierEmployee.payroll_placed === 1
                        ? 'Placed on PMEC'
                        : 'Pending PMEC Placement'}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
                    <div>
                      <dt className="text-slate-500">Station &amp; District</dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {dossierEmployee.station_name} ({dossierEmployee.district})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Approved Post</dt>
                      <dd className="mt-0.5 font-medium text-slate-900">
                        {dossierEmployee.post_title ?? '—'}{' '}
                        <span className="font-mono text-slate-500">
                          {dossierEmployee.post_code}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Gross / Net Pay</dt>
                      <dd className="mt-0.5 font-mono font-medium text-slate-900 tabular-nums">
                        {formatZmw(dossierEmployee.gross_pay)} / {formatZmw(dossierEmployee.net_pay)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Bank Account</dt>
                      <dd className="mt-0.5 font-mono text-slate-800">
                        {dossierEmployee.bank_account}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Date of Birth</dt>
                      <dd className="mt-0.5 font-mono text-slate-800">
                        {dossierEmployee.date_of_birth}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Absence / Recruit Date</dt>
                      <dd className="mt-0.5 font-mono text-slate-800">
                        {dossierEmployee.absence_months} mo ·{' '}
                        {dossierEmployee.recruit_date ?? 'N/A'}
                      </dd>
                    </div>
                  </dl>
                </section>
              ) : (
                <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-700" />
                    <span>Unmatched PMEC Entry — Absent from Authoritative HR Register</span>
                  </div>
                  <p className="mt-1 text-red-800">
                    Staff ID <span className="font-mono">{selectedStaffId}</span> appears in the monthly PMEC payroll extract without a matching authoritative HR record.
                  </p>
                </section>
              )}

              {/* Workstation Verification & PMEC Reconciliation Split */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="font-display text-xs font-semibold text-slate-900">
                    02 · Workstation Verification
                  </div>
                  <div className="mt-2">
                    {dossierEmployee?.last_verification_outcome ? (
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        {dossierEmployee.last_verification_outcome === 'Present & Verified' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                        )}
                        <span>{dossierEmployee.last_verification_outcome}</span>
                      </div>
                    ) : (
                      <div className="text-slate-500">No workstation verification recorded yet.</div>
                    )}
                    {dossierVerifications.length > 0 && (
                      <ul className="mt-2.5 space-y-2 border-t border-slate-100 pt-2">
                        {dossierVerifications.map((v) => (
                          <li key={v.id} className="text-[11px] text-slate-600">
                            <div className="flex justify-between font-medium text-slate-800">
                              <span>{v.method}</span>
                              <span className="font-mono text-slate-500">
                                {formatShortDate(v.verified_at)}
                              </span>
                            </div>
                            <div className="text-slate-500">{v.evidence_note}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="font-display text-xs font-semibold text-slate-900">
                    03 · PMEC Extract Reconciliation
                  </div>
                  {dossierRecon ? (
                    <dl className="mt-2 space-y-1.5">
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Match Status</dt>
                        <dd
                          className={`font-medium ${
                            dossierRecon.match_status === 'Matched'
                              ? 'text-emerald-700'
                              : dossierRecon.match_status === 'Unmatched in HR (Potential Ghost)'
                                ? 'text-red-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {dossierRecon.match_status}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">HR vs PMEC Station</dt>
                        <dd className="font-mono text-slate-800">
                          {dossierRecon.hr_station_code ?? 'None'} /{' '}
                          {dossierRecon.pmec_station_code ?? 'None'}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">HR vs PMEC Net Pay</dt>
                        <dd className="font-mono text-slate-800 tabular-nums">
                          {dossierRecon.hr_net_pay !== null
                            ? formatZmw(dossierRecon.hr_net_pay)
                            : '—'}{' '}
                          /{' '}
                          {dossierRecon.pmec_net_pay !== null
                            ? formatZmw(dossierRecon.pmec_net_pay)
                            : '—'}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-2 text-slate-500">
                      Not included in current PMEC extract comparison.
                    </p>
                  )}
                </section>
              </div>

              {/* Exception Cases */}
              <section className="rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                  <span className="font-display text-xs font-semibold text-slate-900">
                    04 · Exception Cases &amp; Due Process ({dossierCases.length})
                  </span>
                  <span className="text-[11px] text-emerald-700">
                    Salaries protected pending case resolution
                  </span>
                </div>
                {dossierCases.length === 0 ? (
                  <div className="px-4 py-3 text-slate-500">
                    No open or historical exception cases linked to {selectedStaffId}.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {dossierCases.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-slate-900">
                              {c.case_number}
                            </span>
                            <span className="font-medium text-slate-800">{c.rule_label}</span>
                            <span
                              className={`font-medium ${
                                c.status === 'Open' || c.status === 'Under Investigation'
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              · {c.status}
                            </span>
                          </div>
                          <p className="mt-0.5 text-slate-600">{c.description}</p>
                        </div>
                        <div className="shrink-0 text-right font-mono tabular-nums">
                          <div className="font-medium text-slate-900">
                            {formatZmw(c.financial_exposure)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Due {c.resolution_deadline}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Recent Audit Entries */}
              {dossierAudits.length > 0 && (
                <section className="rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-4 py-2.5 font-display text-xs font-semibold text-slate-900">
                    05 · Recent Tamper-Evident Audit Entries
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {dossierAudits.map((log) => (
                      <li key={log.id} className="px-4 py-2.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-mono font-medium text-slate-700">
                            {log.action} · {log.actor_name}
                          </span>
                          <span className="font-mono">{formatShortDate(log.timestamp)}</span>
                        </div>
                        <div className="mt-0.5 text-slate-700">{log.summary}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* Modal Footer: Cross-App Jump Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {dossierEmployee && (
                  <button
                    type="button"
                    onClick={() => jump('register')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100"
                  >
                    <Users className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Open in Register</span>
                  </button>
                )}
                {dossierEmployee && (
                  <button
                    type="button"
                    onClick={() => jump('verify')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 text-emerald-700" />
                    <span>Verify Workstation</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => jump('validate')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-100"
                >
                  <Scale className="h-3.5 w-3.5 text-emerald-700" />
                  <span>PMEC Reconciliation</span>
                </button>
                {dossierCases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => jump('review')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800"
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    <span>Review Cases ({dossierCases.length})</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffId(null)}
                className="rounded-md px-3 py-1.5 font-medium text-slate-600 hover:text-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
