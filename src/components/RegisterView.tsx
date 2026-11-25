import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, FilePlus2, Search, Upload, UserPlus } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatShortDate, formatZmw } from '../lib/roles.ts';
import type {
  ApprovedPost,
  EmployeeRecord,
  Station,
  StationReturn,
  TransferRecord,
  UserAccount,
} from '../types/payroll.ts';
import { BulkCsvImportModal } from './BulkCsvImportModal.tsx';

interface RegisterViewProps {
  currentUser: UserAccount;
  employees: EmployeeRecord[];
  stations: Station[];
  posts: ApprovedPost[];
  transfers: TransferRecord[];
  returns: StationReturn[];
  focusedStaff?: { staffId: string; nonce: number } | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function RegisterView({
  currentUser,
  employees,
  stations,
  posts,
  transfers,
  returns,
  focusedStaff,
  onRefresh,
  onNotify,
}: RegisterViewProps) {
  const [subTab, setSubTab] = useState<'staff' | 'transfers' | 'returns'>('staff');
  const [search, setSearch] = useState('');
  const [districtFilter, setDistrictFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    if (focusedStaff?.staffId) {
      setSubTab('staff');
      setDistrictFilter('All');
      setStatusFilter('All');
      setSearch(focusedStaff.staffId);
    }
  }, [focusedStaff]);

  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Register staff form state
  const defaultStationId = currentUser.assigned_station_id ?? stations[0]?.id ?? '';
  const [staffForm, setStaffForm] = useState({
    staff_id: '',
    nrc_number: '',
    full_name: '',
    date_of_birth: '1995-04-15',
    bank_account: '',
    station_id: defaultStationId,
    post_id: posts[0]?.id ?? '',
    employment_status: 'Pending Placement',
    gross_pay: '10200',
    net_pay: '6250',
    recruit_date: '2026-09-01',
  });

  // Transfer form state
  const [transferForm, setTransferForm] = useState({
    staff_id: employees[0]?.staff_id ?? '',
    to_station_id: stations[0]?.id ?? '',
    effective_date: '2026-11-21',
    authority_ref: 'MOE/CEN/TRF/2026/',
  });

  // Monthly station return form state
  const [returnForm, setReturnForm] = useState({
    station_id: currentUser.assigned_station_id ?? stations[0]?.id ?? '',
    return_month: '2026-11',
    headcount_reported: '5',
    present_count: '4',
    absent_count: '1',
    on_leave_count: '0',
    remarks: '',
  });

  const districts = useMemo(
    () => ['All', ...Array.from(new Set(stations.map((s) => s.district))).sort()],
    [stations]
  );

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (districtFilter !== 'All' && e.district !== districtFilter) return false;
      if (statusFilter === 'Pending Placement' && e.payroll_placed !== 0) return false;
      if (statusFilter === 'Active' && e.employment_status !== 'Active') return false;
      if (statusFilter === 'Flagged Absence' && e.absence_months < 4) return false;
      if (!q) return true;
      return (
        e.staff_id.toLowerCase().includes(q) ||
        e.full_name.toLowerCase().includes(q) ||
        e.nrc_number.toLowerCase().includes(q) ||
        (e.station_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, search, districtFilter, statusFilter]);

  const postsForSelectedStation = useMemo(() => {
    const matched = posts.filter((p) => p.station_id === staffForm.station_id);
    return matched.length > 0 ? matched : posts;
  }, [posts, staffForm.station_id]);

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.registerEmployee({
        staff_id: staffForm.staff_id,
        nrc_number: staffForm.nrc_number,
        full_name: staffForm.full_name,
        date_of_birth: staffForm.date_of_birth,
        bank_account: staffForm.bank_account,
        station_id: staffForm.station_id,
        post_id: staffForm.post_id,
        employment_status: staffForm.employment_status,
        gross_pay: Number(staffForm.gross_pay),
        net_pay: Number(staffForm.net_pay),
        recruit_date: staffForm.recruit_date,
      });
      setShowRegisterModal(false);
      await onRefresh();
      onNotify('success', `Staff record ${res.staff_id} registered in authoritative dataset.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to register staff.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTransferSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.recordTransfer(transferForm);
      setShowTransferModal(false);
      await onRefresh();
      onNotify('success', `Station transfer recorded for ${transferForm.staff_id} with audit trail.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to record transfer.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReturnSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.submitStationReturn({
        station_id: returnForm.station_id,
        return_month: returnForm.return_month,
        headcount_reported: Number(returnForm.headcount_reported),
        present_count: Number(returnForm.present_count),
        absent_count: Number(returnForm.absent_count),
        on_leave_count: Number(returnForm.on_leave_count),
        remarks: returnForm.remarks,
      });
      setShowReturnModal(false);
      await onRefresh();
      onNotify('success', `Monthly digital station return (${returnForm.return_month}) submitted.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to submit station return.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white px-6 py-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setSubTab('staff')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'staff'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Staff Register ({employees.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('transfers')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'transfers'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Transfer Tracking ({transfers.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('returns')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'returns'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Station Returns ({returns.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReturnModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span>Submit Station Return</span>
          </button>
          <button
            type="button"
            onClick={() => setShowTransferModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span>Log Transfer</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCsvModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5 text-emerald-700" />
            <span>Import CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRegisterModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Register Staff</span>
          </button>
        </div>
      </div>

      {subTab === 'staff' && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 md:flex-row md:items-center md:justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Staff ID, name, NRC, or station..."
                className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={districtFilter}
                onChange={(e) => setDistrictFilter(e.target.value)}
                aria-label="Filter by district"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-emerald-700 focus:outline-none"
              >
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d === 'All' ? 'All Districts' : `${d} District`}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-emerald-700 focus:outline-none"
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active Staff</option>
                <option value="Pending Placement">Pending Placement</option>
                <option value="Flagged Absence">Absence &ge; 4 Months</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Staff ID / NRC</th>
                  <th className="px-4 py-3 font-medium">Officer &amp; DOB</th>
                  <th className="px-4 py-3 font-medium">Station &amp; Approved Post</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Gross / Net Pay</th>
                  <th className="px-6 py-3 font-medium">Last Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-slate-500">
                      No staff records match the current search or filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => {
                    const netPct =
                      emp.gross_pay > 0 ? Math.round((emp.net_pay / emp.gross_pay) * 100) : 100;
                    const isLowNet = netPct < 40;
                    return (
                      <tr key={emp.id} className="hover:bg-slate-50">
                        <td className="px-6 py-3.5">
                          <div className="font-mono font-medium text-slate-900">
                            {emp.staff_id}
                          </div>
                          <div className="font-mono text-slate-500">{emp.nrc_number}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-slate-900">{emp.full_name}</div>
                          <div className="font-mono text-slate-500">
                            DOB {emp.date_of_birth}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-slate-800">{emp.station_name}</div>
                          <div className="text-slate-500">
                            {emp.district} · <span className="font-mono">{emp.post_code}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div
                            className={`font-medium ${
                              emp.employment_status === 'Active' && emp.absence_months === 0
                                ? 'text-emerald-700'
                                : emp.absence_months >= 12
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }`}
                          >
                            {emp.employment_status}
                          </div>
                          <div className="text-slate-500">
                            {emp.payroll_placed === 1 ? 'On PMEC' : 'Awaiting Placement'}
                            {emp.absence_months > 0 ? ` · ${emp.absence_months}m absent` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                          <div className="text-slate-900">{formatZmw(emp.gross_pay)}</div>
                          <div className={isLowNet ? 'font-semibold text-red-700' : 'text-slate-500'}>
                            Net {formatZmw(emp.net_pay)} ({netPct}%)
                          </div>
                        </td>
                        <td className="px-6 py-3.5">
                          <div
                            className={
                              emp.last_verification_outcome === 'Present & Verified'
                                ? 'font-medium text-emerald-700'
                                : emp.last_verification_outcome === 'Unaccounted at Station'
                                  ? 'font-medium text-red-700'
                                  : 'text-amber-700'
                            }
                          >
                            {emp.last_verification_outcome ?? 'Unverified'}
                          </div>
                          <div className="font-mono text-slate-500">
                            {formatShortDate(emp.last_verified_at)}
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
      )}

      {subTab === 'transfers' && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Historical Transfer Tracking Log
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Maintains traceable station movement history so inter-district transfers do not create false ghost alerts.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Staff ID &amp; Officer</th>
                  <th className="px-4 py-3 font-medium">From Station</th>
                  <th className="px-4 py-3 font-medium">To Station</th>
                  <th className="px-4 py-3 font-medium">Effective Date</th>
                  <th className="px-6 py-3 font-medium">Authority Reference &amp; Recorder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5">
                      <div className="font-mono font-medium text-slate-900">{t.staff_id}</div>
                      <div className="text-slate-600">{t.employee_name ?? 'Staff Member'}</div>
                    </td>
                    <td className="px-4 py-3.5 text-slate-700">{t.from_station_name ?? t.from_station_id}</td>
                    <td className="px-4 py-3.5 font-medium text-slate-900">
                      {t.to_station_name ?? t.to_station_id}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-700 tabular-nums">
                      {t.effective_date}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="font-mono text-slate-900">{t.authority_ref}</div>
                      <div className="text-slate-500">Recorded by {t.recorded_by}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'returns' && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Monthly Digital Station Returns
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Submitted monthly by Station Officers prior to payroll validation. Station Officers are restricted to their assigned station.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Month</th>
                  <th className="px-4 py-3 font-medium">Station &amp; District</th>
                  <th className="px-4 py-3 text-right font-medium">Reported / Present / Absent / Leave</th>
                  <th className="px-4 py-3 font-medium">Remarks</th>
                  <th className="px-6 py-3 font-medium">Submitted By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {returns.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5 font-mono font-medium text-slate-900 tabular-nums">
                      {r.return_month}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">{r.station_name}</div>
                      <div className="text-slate-500">{r.district}</div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums">
                      {r.headcount_reported} · {r.present_count} present · {r.absent_count} absent · {r.on_leave_count} leave
                    </td>
                    <td className="px-4 py-3.5 max-w-md text-slate-600">{r.remarks}</td>
                    <td className="px-6 py-3.5">
                      <div className="text-slate-900">{r.submitted_by}</div>
                      <div className="font-mono text-slate-500">{formatShortDate(r.submitted_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Register Staff Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Register Authoritative Staff Record
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Enforces unique Staff ID linkage to an approved establishment post.
              </p>
            </div>
            <form onSubmit={handleRegisterSubmit} className="space-y-4 p-6 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Unique Staff ID</label>
                  <input
                    required
                    value={staffForm.staff_id}
                    onChange={(e) => setStaffForm({ ...staffForm, staff_id: e.target.value })}
                    placeholder="ZMB-MOE-10510"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">NRC Number</label>
                  <input
                    required
                    value={staffForm.nrc_number}
                    onChange={(e) => setStaffForm({ ...staffForm, nrc_number: e.target.value })}
                    placeholder="591204/10/1"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Full Name</label>
                  <input
                    required
                    value={staffForm.full_name}
                    onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })}
                    placeholder="Mulenga Banda"
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Date of Birth</label>
                  <input
                    required
                    type="date"
                    value={staffForm.date_of_birth}
                    onChange={(e) => setStaffForm({ ...staffForm, date_of_birth: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Station</label>
                  <select
                    value={staffForm.station_id}
                    onChange={(e) => setStaffForm({ ...staffForm, station_id: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.district})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Approved Post</label>
                  <select
                    value={staffForm.post_id}
                    onChange={(e) => setStaffForm({ ...staffForm, post_id: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    {postsForSelectedStation.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.post_code} — {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Bank Account</label>
                  <input
                    required
                    value={staffForm.bank_account}
                    onChange={(e) => setStaffForm({ ...staffForm, bank_account: e.target.value })}
                    placeholder="ZANACO-00981234"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Gross Pay (K)</label>
                  <input
                    required
                    type="number"
                    value={staffForm.gross_pay}
                    onChange={(e) => setStaffForm({ ...staffForm, gross_pay: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Net Pay (K)</label>
                  <input
                    required
                    type="number"
                    value={staffForm.net_pay}
                    onChange={(e) => setStaffForm({ ...staffForm, net_pay: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Employment Status</label>
                  <select
                    value={staffForm.employment_status}
                    onChange={(e) => setStaffForm({ ...staffForm, employment_status: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    <option value="Pending Placement">Pending Placement (New Recruit)</option>
                    <option value="Active">Active</option>
                    <option value="On Leave">On Leave</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Recruitment Date</label>
                  <input
                    type="date"
                    value={staffForm.recruit_date}
                    onChange={(e) => setStaffForm({ ...staffForm, recruit_date: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Staff Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Record Station Transfer
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Updates authoritative station link and writes an immutable transfer log.
              </p>
            </div>
            <form onSubmit={handleTransferSubmit} className="space-y-4 p-6 text-xs">
              <div>
                <label className="mb-1 block font-medium text-slate-700">Staff Member</label>
                <select
                  value={transferForm.staff_id}
                  onChange={(e) => setTransferForm({ ...transferForm, staff_id: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  {employees.map((emp) => (
                    <option key={emp.staff_id} value={emp.staff_id}>
                      {emp.staff_id} — {emp.full_name} ({emp.station_name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">Destination Station</label>
                <select
                  value={transferForm.to_station_id}
                  onChange={(e) => setTransferForm({ ...transferForm, to_station_id: e.target.value })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.district})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Effective Date</label>
                  <input
                    required
                    type="date"
                    value={transferForm.effective_date}
                    onChange={(e) => setTransferForm({ ...transferForm, effective_date: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Transfer Authority Ref</label>
                  <input
                    required
                    value={transferForm.authority_ref}
                    onChange={(e) => setTransferForm({ ...transferForm, authority_ref: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {submitting ? 'Recording...' : 'Record Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Station Return Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Submit Monthly Digital Station Return
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Station Officers may only submit returns for their assigned station.
              </p>
            </div>
            <form onSubmit={handleReturnSubmit} className="space-y-4 p-6 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Station</label>
                  <select
                    value={returnForm.station_id}
                    onChange={(e) => setReturnForm({ ...returnForm, station_id: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Return Month</label>
                  <input
                    required
                    value={returnForm.return_month}
                    onChange={(e) => setReturnForm({ ...returnForm, return_month: e.target.value })}
                    placeholder="2026-11"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Total</label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={returnForm.headcount_reported}
                    onChange={(e) => setReturnForm({ ...returnForm, headcount_reported: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Present</label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={returnForm.present_count}
                    onChange={(e) => setReturnForm({ ...returnForm, present_count: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Absent</label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={returnForm.absent_count}
                    onChange={(e) => setReturnForm({ ...returnForm, absent_count: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Leave</label>
                  <input
                    required
                    type="number"
                    min={0}
                    value={returnForm.on_leave_count}
                    onChange={(e) => setReturnForm({ ...returnForm, on_leave_count: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-2 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">Station Remarks</label>
                <textarea
                  rows={3}
                  value={returnForm.remarks}
                  onChange={(e) => setReturnForm({ ...returnForm, remarks: e.target.value })}
                  placeholder="Note any transfers, study leave approvals, or recruits awaiting payroll placement."
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setShowReturnModal(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCsvModal && (
        <BulkCsvImportModal
          employees={employees}
          stations={stations}
          posts={posts}
          onClose={() => setShowCsvModal(false)}
          onSuccess={onRefresh}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
