import { useMemo, useState } from 'react';
import { CheckCircle2, FileSearch, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatShortDate, formatZmw } from '../lib/roles.ts';
import type { ExceptionCase, UserAccount } from '../types/payroll.ts';

interface CasesReviewViewProps {
  currentUser: UserAccount;
  cases: ExceptionCase[];
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function CasesReviewView({
  currentUser,
  cases,
  onRefresh,
  onNotify,
}: CasesReviewViewProps) {
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'applied' | 'all'>('open');
  const [activeCase, setActiveCase] = useState<ExceptionCase | null>(null);
  const [decision, setDecision] = useState('Cleared - Verified Present');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const counts = useMemo(() => {
    return {
      open: cases.filter((c) => c.status === 'Open' || c.status === 'Under Investigation').length,
      resolved: cases.filter((c) => c.status === 'Resolved').length,
      applied: cases.filter((c) => c.status === 'Applied to Payroll').length,
      all: cases.length,
    };
  }, [cases]);

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (statusFilter === 'open') return c.status === 'Open' || c.status === 'Under Investigation';
      if (statusFilter === 'resolved') return c.status === 'Resolved';
      if (statusFilter === 'applied') return c.status === 'Applied to Payroll';
      return true;
    });
  }, [cases, statusFilter]);

  function openInvestigateModal(c: ExceptionCase) {
    setActiveCase(c);
    setDecision(
      c.rule_code === 'placement_ageing'
        ? 'Approved Placement'
        : 'Confirmed Discrepancy - Apply Adjustment'
    );
    setEvidenceRef(c.evidence_ref ?? '');
    setNotes(c.resolution_notes ?? '');
  }

  async function handleResolveSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCase) return;
    setSubmitting(true);
    try {
      await api.resolveCase(activeCase.id, {
        resolution_decision: decision,
        resolution_notes: notes,
        evidence_ref: evidenceRef,
      });
      setActiveCase(null);
      await onRefresh();
      onNotify(
        'success',
        `Case ${activeCase.case_number} resolved ("${decision}"). Ready for Payroll Officer action if payroll update is required.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to resolve case.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApplyPayroll(c: ExceptionCase) {
    setSubmitting(true);
    try {
      const res = await api.applyPayrollAction(c.id);
      if (activeCase?.id === c.id) {
        setActiveCase(null);
      }
      await onRefresh();
      onNotify('success', res.summary);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to apply payroll action.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Due-Process & Accountability Header */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white px-6 py-4 lg:flex-row lg:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Procedural Fairness Guarantee · No Automatic Salary Stoppage</span>
          </div>
          <p className="text-xs text-slate-600">
            Every flagged mismatch receives a case number, assigned reviewer, and resolution deadline. Case Reviewers record findings without altering pay; Payroll Officers apply approved resolutions only.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 shrink-0">
          <button
            type="button"
            onClick={() => setStatusFilter('open')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              statusFilter === 'open' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Open ({counts.open})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              statusFilter === 'resolved' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Awaiting Payroll ({counts.resolved})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('applied')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              statusFilter === 'applied' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Completed ({counts.applied})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            All ({counts.all})
          </button>
        </div>
      </div>

      {/* Cases Queue */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Case &amp; Rule</th>
                <th className="px-4 py-3 font-medium">Staff &amp; Station</th>
                <th className="px-4 py-3 font-medium">Findings Summary</th>
                <th className="px-4 py-3 text-right font-medium">Exposure</th>
                <th className="px-4 py-3 font-medium">Ownership &amp; Deadline</th>
                <th className="px-6 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500">
                    No exception cases in this status view.
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => {
                  const isOpen = c.status === 'Open' || c.status === 'Under Investigation';
                  const isResolved = c.status === 'Resolved';
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 align-top">
                        <div className="font-mono font-semibold text-slate-900">
                          {c.case_number}
                        </div>
                        <div className="mt-0.5 text-slate-700">{c.rule_label}</div>
                        <div
                          className={`mt-1 font-medium ${
                            c.severity === 'Critical'
                              ? 'text-red-700'
                              : c.severity === 'High'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                          }`}
                        >
                          {c.severity} · {c.status}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="font-mono font-medium text-slate-900">{c.staff_id}</div>
                        <div className="font-medium text-slate-800">{c.employee_name}</div>
                        <div className="text-slate-500">
                          {c.station_name} · {c.district}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top max-w-md">
                        <p className="leading-relaxed text-slate-700">{c.description}</p>
                        <div className="mt-1.5 text-emerald-700">
                          Salary protected during investigation
                        </div>
                        {c.resolution_decision && (
                          <div className="mt-1.5 text-slate-800">
                            Resolution: <span className="font-medium">{c.resolution_decision}</span>
                            {c.evidence_ref ? ` · Ref ${c.evidence_ref}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 align-top text-right font-mono font-medium text-slate-900 tabular-nums">
                        {formatZmw(c.financial_exposure)}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <div className="text-slate-800">
                          Reviewer: {c.assigned_reviewer_name ?? 'Unassigned'}
                        </div>
                        <div className="font-mono text-slate-600 tabular-nums">
                          Due {c.resolution_deadline}
                        </div>
                        <div className="text-slate-500">Raised by {c.raised_by_name}</div>
                      </td>
                      <td className="px-6 py-4 align-top text-right">
                        <div className="flex flex-col items-end gap-2">
                          {isOpen && (
                            <button
                              type="button"
                              onClick={() => openInvestigateModal(c)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                            >
                              <FileSearch className="h-3.5 w-3.5 text-emerald-700" />
                              <span>Investigate &amp; Resolve</span>
                            </button>
                          )}
                          {isResolved && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleApplyPayroll(c)}
                              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Apply Approved Payroll Action</span>
                            </button>
                          )}
                          {c.status === 'Applied to Payroll' && (
                            <div className="text-right text-slate-500">
                              <div className="font-medium text-emerald-700">Action Applied</div>
                              <div className="font-mono">
                                {formatShortDate(c.payroll_applied_at)}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Case Investigation Modal */}
      {activeCase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="font-mono text-xs font-medium text-emerald-700">
                {activeCase.case_number} · {activeCase.rule_label}
              </div>
              <h3 className="mt-1 font-display text-base font-semibold text-slate-900">
                Case Investigation &amp; Formal Resolution
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {activeCase.staff_id} · {activeCase.employee_name} · {activeCase.station_name}
              </p>
            </div>
            <form onSubmit={handleResolveSubmit} className="space-y-4 p-6 text-xs">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-slate-700">
                <div className="font-medium text-slate-900">Automated Flag Details</div>
                <p className="mt-1 leading-relaxed">{activeCase.description}</p>
                <div className="mt-2 font-mono text-slate-500">
                  Raised by: {activeCase.raised_by_name} · Deadline: {activeCase.resolution_deadline}
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Investigation Resolution Decision
                </label>
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  <option value="Cleared - Verified Present">Cleared — Officer Verified Present</option>
                  <option value="Cleared - Leave or Transfer Updated">
                    Cleared — Approved Leave / Transfer Documented
                  </option>
                  <option value="Confirmed Discrepancy - Apply Adjustment">
                    Confirmed Discrepancy — Escalate to Payroll Officer
                  </option>
                  <option value="Approved Placement">
                    Approved Placement — Authorize Payroll Onboarding
                  </option>
                </select>
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Documentary Evidence Reference
                </label>
                <input
                  required
                  value={evidenceRef}
                  onChange={(e) => setEvidenceRef(e.target.value)}
                  placeholder="e.g., MOE/TRF/2026/412 or NRC-VER-881"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Case Reviewer Investigation Notes
                </label>
                <textarea
                  required
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Summarize physical verification, HR file check, or officer explanation prior to decision."
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-600">
                Signed-in role: <span className="font-medium text-slate-900">{currentUser.full_name} ({currentUser.role})</span>. Only Case Reviewers may resolve cases, and cannot resolve cases they raised.
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setActiveCase(null)}
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {submitting ? 'Recording...' : 'Record Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
