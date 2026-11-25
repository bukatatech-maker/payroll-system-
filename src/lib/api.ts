import type {
  ApprovedPost,
  AuditLogEntry,
  DashboardSummary,
  EmployeeRecord,
  EmployeeSearchResult,
  ExceptionCase,
  ReconciliationItem,
  Station,
  StationReturn,
  TransferRecord,
  UserAccount,
  UserRole,
  VerificationRecord,
} from '../types/payroll.ts';

let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  getProfiles: () => request<{ profiles: UserAccount[] }>('/api/auth/profiles'),
  createSession: (user_id: string) =>
    request<{ token: string; user: UserAccount }>('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
  getDashboard: (range?: { start_month: string; end_month: string }) => {
    const params = new URLSearchParams();
    if (range?.start_month) params.set('start_month', range.start_month);
    if (range?.end_month) params.set('end_month', range.end_month);
    const qs = params.toString();
    return request<DashboardSummary>(`/api/dashboard${qs ? `?${qs}` : ''}`);
  },
  getStations: () => request<{ stations: Station[]; posts: ApprovedPost[] }>('/api/stations'),
  getEmployees: () =>
    request<{
      employees: EmployeeRecord[];
      transfers: TransferRecord[];
      returns: StationReturn[];
    }>('/api/employees'),
  searchEmployees: (q: string) => {
    const params = new URLSearchParams({ q });
    return request<{ results: EmployeeSearchResult[] }>(`/api/employees/search?${params.toString()}`);
  },
  registerEmployee: (payload: {
    staff_id: string;
    nrc_number: string;
    full_name: string;
    date_of_birth: string;
    bank_account: string;
    station_id: string;
    post_id: string;
    employment_status: string;
    gross_pay: number;
    net_pay: number;
    recruit_date?: string;
  }) =>
    request<{ id: string; staff_id: string }>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  bulkImportEmployees: (
    rows: Array<{
      staff_id: string;
      nrc_number: string;
      full_name: string;
      date_of_birth: string;
      bank_account: string;
      station_code: string;
      post_code: string;
      employment_status: string;
      gross_pay: string;
      net_pay: string;
      recruit_date: string;
    }>
  ) =>
    request<{
      inserted: number;
      updated: number;
      transfers_logged: number;
      skipped: number;
      errors: Array<{ row: number; staff_id: string; reason: string }>;
    }>('/api/employees/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
  recordTransfer: (payload: {
    staff_id: string;
    to_station_id: string;
    effective_date: string;
    authority_ref: string;
  }) =>
    request<{ id: string }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitStationReturn: (payload: {
    station_id: string;
    return_month: string;
    headcount_reported: number;
    present_count: number;
    absent_count: number;
    on_leave_count: number;
    remarks: string;
  }) =>
    request<{ id: string }>('/api/station-returns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getVerifications: () => request<{ verifications: VerificationRecord[] }>('/api/verifications'),
  recordVerification: (payload: {
    staff_id: string;
    method: string;
    outcome: string;
    evidence_note: string;
  }) =>
    request<{ id: string; opened_case_number: string | null }>('/api/verifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getReconciliation: () =>
    request<{ items: ReconciliationItem[]; pmec_extract_count: number }>('/api/reconciliation'),
  runValidationCycle: () =>
    request<{
      records_checked: number;
      new_cases_opened: number;
      total_open_cases: number;
      rules_executed: Array<{ rule_code: string; rule_label: string; flagged: number }>;
    }>('/api/validation/run', { method: 'POST' }),
  getCases: () => request<{ cases: ExceptionCase[] }>('/api/cases'),
  resolveCase: (
    id: string,
    payload: {
      resolution_decision: string;
      resolution_notes: string;
      evidence_ref: string;
    }
  ) =>
    request<{ ok: boolean; case_number: string }>(`/api/cases/${id}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  applyPayrollAction: (id: string) =>
    request<{ ok: boolean; summary: string }>(`/api/cases/${id}/apply-payroll`, {
      method: 'POST',
    }),
  getAuditTrail: () =>
    request<{
      logs: AuditLogEntry[];
      verification: {
        valid: boolean;
        total_entries: number;
        verified_entries: number;
        broken_seq: number | null;
        head_hash: string;
      };
    }>('/api/audit'),
  verifyAuditChain: () =>
    request<{
      valid: boolean;
      total_entries: number;
      verified_entries: number;
      broken_seq: number | null;
      head_hash: string;
      verified_by: string;
      verified_at: string;
    }>('/api/audit/verify'),
  getUsers: () => request<{ users: UserAccount[] }>('/api/users'),
  updateUser: (id: string, payload: { role?: UserRole; is_active?: number }) =>
    request<{ ok: boolean }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
};
