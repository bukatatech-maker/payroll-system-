export type UserRole =
  | 'station_officer'
  | 'district_verifier'
  | 'case_reviewer'
  | 'payroll_officer'
  | 'auditor'
  | 'system_admin';

export interface UserAccount {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  district: string;
  assigned_station_id: string | null;
  assigned_station_name?: string | null;
  is_active: number;
  created_at: string;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  district: string;
  province: string;
  ministry: string;
  approved_posts_count: number;
  connectivity_tier: 'Online' | 'Intermittent' | 'District-Relay';
  last_return_month: string | null;
}

export interface ApprovedPost {
  id: string;
  post_code: string;
  title: string;
  salary_scale: string;
  station_id: string;
  station_name?: string;
  budget_vote: string;
  is_filled: number;
}

export type EmploymentStatus =
  | 'Active'
  | 'On Leave'
  | 'Study Leave'
  | 'Suspended Pending Review'
  | 'Transferred'
  | 'Pending Placement'
  | 'Separated';

export interface EmployeeRecord {
  id: string;
  staff_id: string;
  nrc_number: string;
  full_name: string;
  date_of_birth: string;
  bank_account: string;
  station_id: string;
  station_name?: string;
  district?: string;
  post_id: string;
  post_code?: string;
  post_title?: string;
  employment_status: EmploymentStatus;
  gross_pay: number;
  net_pay: number;
  absence_months: number;
  recruit_date: string | null;
  payroll_placed: number;
  last_verified_at: string | null;
  last_verification_outcome: string | null;
  updated_at: string;
}

export interface TransferRecord {
  id: string;
  staff_id: string;
  employee_name?: string;
  from_station_id: string;
  from_station_name?: string;
  to_station_id: string;
  to_station_name?: string;
  effective_date: string;
  authority_ref: string;
  recorded_by: string;
  created_at: string;
}

export interface StationReturn {
  id: string;
  station_id: string;
  station_name?: string;
  district?: string;
  return_month: string;
  headcount_reported: number;
  present_count: number;
  absent_count: number;
  on_leave_count: number;
  remarks: string;
  submitted_by: string;
  submitted_at: string;
}

export interface VerificationRecord {
  id: string;
  staff_id: string;
  employee_name?: string;
  station_id: string;
  station_name?: string;
  method: 'Physical Roll-Call' | 'Digital Check-In' | 'District Headcount Audit';
  outcome:
    | 'Present & Verified'
    | 'Approved Leave / Study'
    | 'Transferred - Pending Update'
    | 'Unaccounted at Station';
  evidence_note: string;
  verified_by_user_id: string;
  verified_by_name: string;
  verified_at: string;
}

export interface PmecExtractRow {
  id: string;
  pay_period: string;
  staff_id: string;
  full_name: string;
  pmec_station_code: string;
  pmec_post_code: string;
  pmec_gross_pay: number;
  pmec_net_pay: number;
  pmec_status: string;
}

export interface ReconciliationItem {
  staff_id: string;
  full_name: string;
  hr_station_code: string | null;
  pmec_station_code: string | null;
  hr_net_pay: number | null;
  pmec_net_pay: number | null;
  hr_status: string | null;
  pmec_status: string | null;
  match_status:
    | 'Matched'
    | 'Station Mismatch'
    | 'Unmatched in HR (Potential Ghost)'
    | 'Pending PMEC Placement'
    | 'Net Pay Discrepancy';
}

export type ValidationRuleCode =
  | 'unique_identity'
  | 'age_bounds'
  | 'net_pay_threshold'
  | 'station_match'
  | 'absence_tracking'
  | 'placement_ageing';

export type CaseStatus = 'Open' | 'Under Investigation' | 'Resolved' | 'Applied to Payroll';

export type ResolutionDecision =
  | 'Cleared - Verified Present'
  | 'Cleared - Leave or Transfer Updated'
  | 'Confirmed Discrepancy - Apply Adjustment'
  | 'Approved Placement';

export interface ExceptionCase {
  id: string;
  case_number: string;
  rule_code: ValidationRuleCode;
  rule_label: string;
  severity: 'Critical' | 'High' | 'Medium';
  staff_id: string;
  employee_name: string;
  station_id: string;
  station_name: string;
  district: string;
  description: string;
  financial_exposure: number;
  salary_protected: number;
  status: CaseStatus;
  raised_by_user_id: string;
  raised_by_name: string;
  assigned_reviewer_id: string | null;
  assigned_reviewer_name: string | null;
  resolution_deadline: string;
  resolution_decision: ResolutionDecision | null;
  resolution_notes: string | null;
  evidence_ref: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  payroll_applied_by: string | null;
  payroll_applied_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  seq: number;
  id: string;
  timestamp: string;
  actor_user_id: string;
  actor_name: string;
  actor_role: UserRole;
  action: string;
  target_type: string;
  target_id: string;
  summary: string;
  prev_hash: string;
  entry_hash: string;
}

export interface DashboardSummary {
  total_staff: number;
  active_on_payroll: number;
  verified_station_count: number;
  verified_station_pct: number;
  pending_placement_count: number;
  pending_validations_count: number;
  reconciliation_discrepancies_count: number;
  open_cases_count: number;
  overdue_cases_count: number;
  resolved_cases_count: number;
  avg_turnaround_days: number;
  total_exposure_zmw: number;
  total_monthly_gross_zmw: number;
  audit_chain_length: number;
  rule_breakdown: Array<{
    rule_code: ValidationRuleCode;
    rule_label: string;
    audit_finding: string;
    open_count: number;
    resolved_count: number;
  }>;
  district_breakdown: Array<{
    district: string;
    station_count: number;
    staff_count: number;
    verified_count: number;
    open_cases: number;
  }>;
  workflow_counts: {
    registered: number;
    verified_this_cycle: number;
    validated_rules: number;
    under_review: number;
    completed_actions: number;
  };
  period: {
    start_month: string;
    end_month: string;
  };
  monthly_trends: MonthlyTrendPoint[];
}

export interface MonthlyTrendPoint {
  month: string;
  label: string;
  exception_cases: number;
  resolved_cases: number;
  payroll_variance_zmw: number;
}

