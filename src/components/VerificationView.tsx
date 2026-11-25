import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Search } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatShortDate } from '../lib/roles.ts';
import type {
  EmployeeRecord,
  UserAccount,
  VerificationRecord,
} from '../types/payroll.ts';

interface VerificationViewProps {
  currentUser: UserAccount;
  employees: EmployeeRecord[];
  verifications: VerificationRecord[];
  focusedStaff?: { staffId: string; nonce: number } | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function VerificationView({
  currentUser,
  employees,
  verifications,
  focusedStaff,
  onRefresh,
  onNotify,
}: VerificationViewProps) {
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unverified' | 'flagged'>('all');
  const [selectedStaff, setSelectedStaff] = useState<EmployeeRecord | null>(null);
  const [method, setMethod] = useState<'Physical Roll-Call' | 'Digital Check-In' | 'District Headcount Audit'>('Physical Roll-Call');
  const [outcome, setOutcome] = useState<
    | 'Present & Verified'
    | 'Approved Leave / Study'
    | 'Transferred - Pending Update'
    | 'Unaccounted at Station'
  >('Present & Verified');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (focusedStaff?.staffId) {
      setFilterMode('all');
      setSearch(focusedStaff.staffId);
      const matched = employees.find((e) => e.staff_id === focusedStaff.staffId);
      if (matched) {
        setSelectedStaff(matched);
      }
    }
  }, [focusedStaff, employees]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (filterMode === 'unverified' && e.last_verified_at !== null) return false;
      if (
        filterMode === 'flagged' &&
        e.last_verification_outcome !== 'Unaccounted at Station' &&
        e.last_verification_outcome !== 'Transferred - Pending Update'
      ) {
        return false;
      }
      if (!q) return true;
      return (
        e.staff_id.toLowerCase().includes(q) ||
        e.full_name.toLowerCase().includes(q) ||
        (e.station_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, search, filterMode]);

  async function handleSubmitVerification(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStaff) return;
    setSubmitting(true);
    try {
      const res = await api.recordVerification({
        staff_id: selectedStaff.staff_id,
        method,
        outcome,
        evidence_note: evidenceNote,
      });
      setSelectedStaff(null);
      setEvidenceNote('');
      await onRefresh();
      onNotify(
        'success',
        res.opened_case_number
          ? `Verification saved. Opened due-process case ${res.opened_case_number} (salary protected during review).`
          : `Workstation verification recorded for ${selectedStaff.staff_id}.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* District Verifier Guidance Banner */}
      <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-white px-6 py-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Scheduled Physical &amp; Digital Workstation Verification
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            District Verifiers record physical headcount and documentary evidence. Unaccounted results open a review case without stopping pay.
          </p>
        </div>
        <div className="text-xs text-slate-600 whitespace-nowrap shrink-0">
          Active session: <span className="font-medium text-slate-900">{currentUser.full_name}</span>
        </div>
      </div>

      {/* Filter & Verification Roster */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search officer or station..."
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                filterMode === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              All Officers ({employees.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('unverified')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                filterMode === 'unverified' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Unverified
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('flagged')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                filterMode === 'flagged' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Flagged Outcome
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Staff ID &amp; Officer</th>
                <th className="px-4 py-3 font-medium">Station &amp; District</th>
                <th className="px-4 py-3 font-medium">Current Outcome</th>
                <th className="px-4 py-3 font-medium">Last Verified</th>
                <th className="px-6 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredStaff.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3.5">
                    <div className="font-mono font-medium text-slate-900">{emp.staff_id}</div>
                    <div className="text-slate-600">{emp.full_name}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="font-medium text-slate-800">{emp.station_name}</div>
                    <div className="text-slate-500">{emp.district}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`font-medium ${
                        emp.last_verification_outcome === 'Present & Verified'
                          ? 'text-emerald-700'
                          : emp.last_verification_outcome === 'Unaccounted at Station'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {emp.last_verification_outcome ?? 'Pending Scheduled Check'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-slate-600 tabular-nums">
                    {formatShortDate(emp.last_verified_at)}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedStaff(emp);
                        setOutcome('Present & Verified');
                        setEvidenceNote('');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5 text-emerald-700" />
                      <span>Log Verification</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent Verification Evidence Log */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Recent Workstation Verification Log
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Staff Member</th>
                <th className="px-4 py-3 font-medium">Method &amp; Outcome</th>
                <th className="px-4 py-3 font-medium">Documentary Evidence Note</th>
                <th className="px-6 py-3 font-medium">Verifier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {verifications.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3.5 font-mono text-slate-600 tabular-nums">
                    {formatShortDate(v.verified_at)}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="font-mono font-medium text-slate-900">{v.staff_id}</div>
                    <div className="text-slate-600">{v.employee_name}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="text-slate-700">{v.method}</div>
                    <div
                      className={
                        v.outcome === 'Present & Verified'
                          ? 'font-medium text-emerald-700'
                          : v.outcome === 'Unaccounted at Station'
                            ? 'font-medium text-red-700'
                            : 'font-medium text-amber-700'
                      }
                    >
                      {v.outcome}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 max-w-md text-slate-600">{v.evidence_note}</td>
                  <td className="px-6 py-3.5 text-slate-800">{v.verified_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Log Verification Modal */}
      {selectedStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Record Workstation Verification
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {selectedStaff.staff_id} · {selectedStaff.full_name} · {selectedStaff.station_name}
              </p>
            </div>
            <form onSubmit={handleSubmitVerification} className="space-y-4 p-6 text-xs">
              <div>
                <label className="mb-1 block font-medium text-slate-700">Verification Method</label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as typeof method)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  <option value="Physical Roll-Call">Physical Roll-Call</option>
                  <option value="Digital Check-In">Digital Check-In (District Relay)</option>
                  <option value="District Headcount Audit">District Headcount Audit</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">Verification Outcome</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  <option value="Present & Verified">Present &amp; Verified</option>
                  <option value="Approved Leave / Study">Approved Leave / Study</option>
                  <option value="Transferred - Pending Update">Transferred - Pending Update (Opens Case)</option>
                  <option value="Unaccounted at Station">Unaccounted at Station (Opens Case)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">Documentary Evidence Note</label>
                <textarea
                  required
                  rows={3}
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  placeholder="Describe NRC/appointment letter check, headteacher sign-off, or absence context."
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-slate-600">
                Separation of duties: If this verification opens a review case, a separate Case Reviewer must investigate it. You cannot approve your own raised case.
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setSelectedStaff(null)}
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {submitting ? 'Recording...' : 'Save Verification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
