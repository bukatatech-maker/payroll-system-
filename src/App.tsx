import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  LayoutDashboard,
  Lock,
  Menu,
  Play,
  Scale,
  Users,
  X,
} from 'lucide-react';
import { AuditSecurityView } from './components/AuditSecurityView.tsx';
import { CasesReviewView } from './components/CasesReviewView.tsx';
import { OverviewReportView, type NavTab } from './components/OverviewReportView.tsx';
import { RegisterView } from './components/RegisterView.tsx';
import { ValidationReconciliationView } from './components/ValidationReconciliationView.tsx';
import { VerificationView } from './components/VerificationView.tsx';
import { api, setAuthToken } from './lib/api.ts';
import { getRoleDefinition } from './lib/roles.ts';
import type {
  ApprovedPost,
  AuditLogEntry,
  DashboardSummary,
  EmployeeRecord,
  ExceptionCase,
  ReconciliationItem,
  Station,
  StationReturn,
  TransferRecord,
  UserAccount,
  VerificationRecord,
} from './types/payroll.ts';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  stepHint: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: 'Overview & Report', stepHint: 'Step 05', icon: LayoutDashboard },
  { id: 'register', label: 'Staff Register', stepHint: 'Step 01', icon: Users },
  { id: 'verify', label: 'Workstation Verify', stepHint: 'Step 02', icon: ClipboardCheck },
  { id: 'validate', label: 'Validate & Reconcile', stepHint: 'Step 03', icon: Scale },
  { id: 'review', label: 'Cases & Due Process', stepHint: 'Step 04', icon: FileSearch },
  { id: 'audit', label: 'Audit Trail & RBAC', stepHint: 'Control', icon: Lock },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [profiles, setProfiles] = useState<UserAccount[]>([]);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingRole, setSwitchingRole] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [posts, setPosts] = useState<ApprovedPost[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [returns, setReturns] = useState<StationReturn[]>([]);
  const [verifications, setVerifications] = useState<VerificationRecord[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationItem[]>([]);
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditVerification, setAuditVerification] = useState<{
    valid: boolean;
    total_entries: number;
    verified_entries: number;
    broken_seq: number | null;
    head_hash: string;
  } | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);

  const [dateRange, setDateRange] = useState<{ start_month: string; end_month: string }>({
    start_month: '2026-06',
    end_month: '2026-11',
  });
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [runningQuickCycle, setRunningQuickCycle] = useState(false);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
  }, []);

  const fetchAllData = useCallback(async (overrideRange?: { start_month: string; end_month: string }) => {
    const activeRange = overrideRange ?? dateRange;
    const [
      dashRes,
      stationsRes,
      empRes,
      verifRes,
      reconRes,
      casesRes,
      auditRes,
      usersRes,
    ] = await Promise.all([
      api.getDashboard(activeRange),
      api.getStations(),
      api.getEmployees(),
      api.getVerifications(),
      api.getReconciliation(),
      api.getCases(),
      api.getAuditTrail(),
      api.getUsers(),
    ]);

    setDashboard(dashRes);
    setStations(stationsRes.stations);
    setPosts(stationsRes.posts);
    setEmployees(empRes.employees);
    setTransfers(empRes.transfers);
    setReturns(empRes.returns);
    setVerifications(verifRes.verifications);
    setReconciliation(reconRes.items);
    setCases(casesRes.cases);
    setAuditLogs(auditRes.logs);
    setAuditVerification(auditRes.verification);
    setUsers(usersRes.users);
  }, [dateRange]);

  const handleDateRangeChange = useCallback(
    async (nextRange: { start_month: string; end_month: string }) => {
      setDateRange(nextRange);
      setDashboardRefreshing(true);
      try {
        const dashRes = await api.getDashboard(nextRange);
        setDashboard(dashRes);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'Unable to apply date range filter.');
      } finally {
        setDashboardRefreshing(false);
      }
    },
    [notify]
  );

  const startSessionForProfile = useCallback(
    async (userId: string) => {
      const session = await api.createSession(userId);
      setAuthToken(session.token);
      setCurrentUser(session.user);
      await fetchAllData();
    },
    [fetchAllData]
  );

  useEffect(() => {
    let active = true;
    async function boot() {
      try {
        const { profiles: list } = await api.getProfiles();
        if (!active) return;
        setProfiles(list);
        const defaultUser =
          list.find((u) => u.role === 'case_reviewer') ?? list[0];
        if (defaultUser) {
          await startSessionForProfile(defaultUser.id);
        }
      } catch (err) {
        if (active) {
          notify('error', err instanceof Error ? err.message : 'Unable to initialize session.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    boot();
    return () => {
      active = false;
    };
  }, [startSessionForProfile, notify]);

  async function handleRoleSwitch(userId: string) {
    setSwitchingRole(true);
    try {
      await startSessionForProfile(userId);
      const next = profiles.find((p) => p.id === userId);
      if (next) {
        const def = getRoleDefinition(next.role);
        notify('success', `Active session switched to ${next.full_name} (${def.label} — ${def.restriction}).`);
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Role switch failed.');
    } finally {
      setSwitchingRole(false);
    }
  }

  async function handleTopBarValidation() {
    setRunningQuickCycle(true);
    try {
      const res = await api.runValidationCycle();
      await fetchAllData();
      notify(
        'success',
        `Validation cycle complete: ${res.records_checked} records checked, ${res.new_cases_opened} new case(s) opened.`
      );
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Validation cycle restricted.');
    } finally {
      setRunningQuickCycle(false);
    }
  }

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];
  const roleInfo = currentUser ? getRoleDefinition(currentUser.role) : null;

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-slate-200 bg-slate-950 text-slate-100 lg:flex">
        <div>
          <div className="border-b border-slate-800 px-6 py-5">
            <div className="font-display text-base font-semibold tracking-tight text-white whitespace-nowrap">
              One Payroll
            </div>
            <div className="mt-1 text-xs text-slate-400">
              PMEC Control &amp; Accountability
            </div>
          </div>

          <nav className="space-y-1 px-3 py-4" aria-label="Primary Navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-700 text-white'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      isActive ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    {item.stepHint}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Active Officer Session & RBAC Switcher */}
        <div className="border-t border-slate-800 p-4">
          <div className="text-xs font-medium text-slate-400">Active Officer Session</div>
          {currentUser && roleInfo && (
            <div className="mt-2 space-y-2">
              <select
                value={currentUser.id}
                disabled={switchingRole}
                onChange={(e) => handleRoleSwitch(e.target.value)}
                aria-label="Switch active officer role"
                className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({getRoleDefinition(p.role).label})
                  </option>
                ))}
              </select>
              <div className="text-xs leading-relaxed text-slate-400">
                <div className="text-slate-200">{roleInfo.label}</div>
                <div>Scope: {currentUser.assigned_station_name ?? currentUser.district}</div>
                <div className="text-amber-400">Rule: {roleInfo.restriction}</div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative z-10 flex w-72 flex-col justify-between bg-slate-950 text-slate-100">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <span className="font-display text-base font-semibold text-white">
                  One Payroll
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-md p-1 text-slate-400 hover:text-white"
                  aria-label="Close navigation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="space-y-1 px-3 py-4">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-xs font-medium ${
                        isActive
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {item.stepHint}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
            {currentUser && (
              <div className="border-t border-slate-800 p-4">
                <label className="mb-1.5 block text-xs text-slate-400">
                  Switch Officer Role
                </label>
                <select
                  value={currentUser.id}
                  disabled={switchingRole}
                  onChange={(e) => handleRoleSwitch(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({getRoleDefinition(p.role).label})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb on left — single action button on right */}
        <header className="flex h-16 items-center justify-between gap-8 border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="font-medium text-slate-500 whitespace-nowrap">One Payroll</span>
              <span className="text-slate-400">/</span>
              <span className="font-display font-semibold text-slate-900 truncate">
                {currentNav.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleTopBarValidation}
              disabled={runningQuickCycle || !currentUser}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{runningQuickCycle ? 'Validating...' : 'Run Validation Cycle'}</span>
            </button>
          </div>
        </header>

        {/* Action & RBAC Feedback Banner */}
        {notice && (
          <div
            role="status"
            className={`flex items-center justify-between gap-4 border-b px-6 py-3 text-xs ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-700" />
              )}
              <span>{notice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-xs font-medium underline underline-offset-2 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Viewport Content */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-6">
          {loading || !currentUser ? (
            <div className="space-y-4">
              <div className="h-24 rounded-lg border border-slate-200 bg-white" />
              <div className="h-64 rounded-lg border border-slate-200 bg-white" />
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewReportView
                  data={dashboard}
                  loading={loading}
                  refreshing={dashboardRefreshing}
                  dateRange={dateRange}
                  generatedBy={currentUser.full_name}
                  onDateRangeChange={handleDateRangeChange}
                  onNavigate={setActiveTab}
                  onNotify={notify}
                />
              )}
              {activeTab === 'register' && (
                <RegisterView
                  currentUser={currentUser}
                  employees={employees}
                  stations={stations}
                  posts={posts}
                  transfers={transfers}
                  returns={returns}
                  onRefresh={fetchAllData}
                  onNotify={notify}
                />
              )}
              {activeTab === 'verify' && (
                <VerificationView
                  currentUser={currentUser}
                  employees={employees}
                  verifications={verifications}
                  onRefresh={fetchAllData}
                  onNotify={notify}
                />
              )}
              {activeTab === 'validate' && (
                <ValidationReconciliationView
                  dashboard={dashboard}
                  reconciliation={reconciliation}
                  onRefresh={fetchAllData}
                  onNotify={notify}
                />
              )}
              {activeTab === 'review' && (
                <CasesReviewView
                  currentUser={currentUser}
                  cases={cases}
                  onRefresh={fetchAllData}
                  onNotify={notify}
                />
              )}
              {activeTab === 'audit' && (
                <AuditSecurityView
                  logs={auditLogs}
                  verification={auditVerification}
                  users={users}
                  onRefresh={fetchAllData}
                  onNotify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
