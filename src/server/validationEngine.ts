import crypto from 'node:crypto';
import type { ReconciliationItem, UserRole, ValidationRuleCode } from '../types/payroll.ts';
import { appendAuditLog, db } from './db.ts';

interface EmployeeRow {
  id: string;
  staff_id: string;
  nrc_number: string;
  full_name: string;
  date_of_birth: string;
  bank_account: string;
  station_id: string;
  station_code: string;
  station_name: string;
  district: string;
  post_id: string;
  post_code: string;
  employment_status: string;
  gross_pay: number;
  net_pay: number;
  absence_months: number;
  recruit_date: string | null;
  payroll_placed: number;
  last_verified_at: string | null;
  last_verification_outcome: string | null;
}

interface PmecRow {
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

function addDaysIso(baseDate: Date, days: number): string {
  const d = new Date(baseDate.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function calculateAgeYears(dobIso: string, refDate: Date): number {
  const dob = new Date(dobIso);
  let age = refDate.getUTCFullYear() - dob.getUTCFullYear();
  const m = refDate.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && refDate.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age;
}

function daysBetween(startIso: string, endDate: Date): number {
  const start = new Date(startIso);
  return Math.floor((endDate.getTime() - start.getTime()) / 86400000);
}

export function computeReconciliation(): ReconciliationItem[] {
  const employees = db
    .prepare(`
      SELECT e.*, s.code AS station_code
      FROM employees e
      JOIN stations s ON s.id = e.station_id
      ORDER BY e.staff_id ASC
    `)
    .all() as Array<EmployeeRow>;

  const pmecRows = db
    .prepare('SELECT * FROM pmec_extracts ORDER BY staff_id ASC')
    .all() as Array<PmecRow>;

  const empByStaff = new Map<string, EmployeeRow>();
  for (const emp of employees) {
    empByStaff.set(emp.staff_id, emp);
  }

  const pmecByStaff = new Map<string, PmecRow>();
  for (const row of pmecRows) {
    pmecByStaff.set(row.staff_id, row);
  }

  const results: ReconciliationItem[] = [];

  for (const emp of employees) {
    const pmec = pmecByStaff.get(emp.staff_id);
    if (!pmec) {
      results.push({
        staff_id: emp.staff_id,
        full_name: emp.full_name,
        hr_station_code: emp.station_code,
        pmec_station_code: null,
        hr_net_pay: emp.net_pay,
        pmec_net_pay: null,
        hr_status: emp.employment_status,
        pmec_status: null,
        match_status: 'Pending PMEC Placement',
      });
      continue;
    }

    let match_status: ReconciliationItem['match_status'] = 'Matched';
    if (emp.station_code !== pmec.pmec_station_code) {
      match_status = 'Station Mismatch';
    } else if (Math.abs(emp.net_pay - pmec.pmec_net_pay) > 1) {
      match_status = 'Net Pay Discrepancy';
    }

    results.push({
      staff_id: emp.staff_id,
      full_name: emp.full_name,
      hr_station_code: emp.station_code,
      pmec_station_code: pmec.pmec_station_code,
      hr_net_pay: emp.net_pay,
      pmec_net_pay: pmec.pmec_net_pay,
      hr_status: emp.employment_status,
      pmec_status: pmec.pmec_status,
      match_status,
    });
  }

  for (const pmec of pmecRows) {
    if (!empByStaff.has(pmec.staff_id)) {
      results.push({
        staff_id: pmec.staff_id,
        full_name: pmec.full_name,
        hr_station_code: null,
        pmec_station_code: pmec.pmec_station_code,
        hr_net_pay: null,
        pmec_net_pay: pmec.pmec_net_pay,
        hr_status: null,
        pmec_status: pmec.pmec_status,
        match_status: 'Unmatched in HR (Potential Ghost)',
      });
    }
  }

  return results;
}

function ensureCaseExists(params: {
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
  raised_by_user_id: string;
  raised_by_name: string;
  deadline_days: number;
}): boolean {
  const existing = db
    .prepare(
      `SELECT id FROM exception_cases
       WHERE staff_id = ? AND rule_code = ? AND status IN ('Open', 'Under Investigation')`
    )
    .get(params.staff_id, params.rule_code) as { id: string } | undefined;

  if (existing) {
    return false;
  }

  // Pick a Case Reviewer who is NOT the actor raising the case
  const reviewer = db
    .prepare(
      `SELECT id, full_name FROM users
       WHERE role = 'case_reviewer' AND is_active = 1 AND id != ?
       LIMIT 1`
    )
    .get(params.raised_by_user_id) as { id: string; full_name: string } | undefined;

  const seqRow = db.prepare('SELECT COUNT(*) as cnt FROM exception_cases').get() as { cnt: number };
  const caseSeq = String(seqRow.cnt + 1).padStart(4, '0');
  const case_number = `OPMS-2026-${caseSeq}`;
  const id = `CASE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date();

  db.prepare(`
    INSERT INTO exception_cases (
      id, case_number, rule_code, rule_label, severity,
      staff_id, employee_name, station_id, station_name, district,
      description, financial_exposure, salary_protected, status,
      raised_by_user_id, raised_by_name, assigned_reviewer_id, assigned_reviewer_name,
      resolution_deadline, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Open', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    case_number,
    params.rule_code,
    params.rule_label,
    params.severity,
    params.staff_id,
    params.employee_name,
    params.station_id,
    params.station_name,
    params.district,
    params.description,
    params.financial_exposure,
    params.raised_by_user_id,
    params.raised_by_name,
    reviewer?.id ?? 'USR-REV-01',
    reviewer?.full_name ?? 'Mutale Banda',
    addDaysIso(now, params.deadline_days),
    now.toISOString()
  );

  return true;
}

export function runAutomatedValidationCycle(actor: {
  id: string;
  full_name: string;
  role: UserRole;
}): {
  records_checked: number;
  new_cases_opened: number;
  total_open_cases: number;
  rules_executed: Array<{ rule_code: ValidationRuleCode; rule_label: string; flagged: number }>;
} {
  const refDate = new Date('2026-11-21T08:00:00.000Z');
  const employees = db
    .prepare(`
      SELECT e.*, s.code AS station_code, s.name AS station_name, s.district, p.post_code
      FROM employees e
      JOIN stations s ON s.id = e.station_id
      JOIN approved_posts p ON p.id = e.post_id
      ORDER BY e.staff_id ASC
    `)
    .all() as Array<EmployeeRow>;

  const pmecRows = db
    .prepare('SELECT * FROM pmec_extracts')
    .all() as Array<PmecRow>;
  const pmecByStaff = new Map<string, PmecRow>(pmecRows.map((r) => [r.staff_id, r]));
  const empByStaff = new Map<string, EmployeeRow>(employees.map((e) => [e.staff_id, e]));

  // Track duplicate NRCs and Bank Accounts
  const nrcCounts = new Map<string, number>();
  const bankCounts = new Map<string, number>();
  for (const emp of employees) {
    nrcCounts.set(emp.nrc_number, (nrcCounts.get(emp.nrc_number) ?? 0) + 1);
    bankCounts.set(emp.bank_account, (bankCounts.get(emp.bank_account) ?? 0) + 1);
  }

  let newCases = 0;
  const ruleFlags: Record<ValidationRuleCode, number> = {
    unique_identity: 0,
    age_bounds: 0,
    net_pay_threshold: 0,
    station_match: 0,
    absence_tracking: 0,
    placement_ageing: 0,
  };

  for (const emp of employees) {
    // 1. Unique Identity (Duplicate NRC, Bank Account, or Ghost PMEC entry)
    const dupNrc = (nrcCounts.get(emp.nrc_number) ?? 0) > 1;
    const dupBank = (bankCounts.get(emp.bank_account) ?? 0) > 1;
    if (dupNrc || dupBank) {
      ruleFlags.unique_identity += 1;
      const created = ensureCaseExists({
        rule_code: 'unique_identity',
        rule_label: 'Unique Identity & Bank Check',
        severity: 'Critical',
        staff_id: emp.staff_id,
        employee_name: emp.full_name,
        station_id: emp.station_id,
        station_name: emp.station_name,
        district: emp.district,
        description: dupBank
          ? `Shared bank account (${emp.bank_account}) detected across multiple active Staff IDs. Open for identity verification; salary remains protected during review.`
          : `Duplicate National Registration Card (${emp.nrc_number}) detected across active records.`,
        financial_exposure: emp.gross_pay,
        raised_by_user_id: actor.id,
        raised_by_name: actor.full_name,
        deadline_days: 7,
      });
      if (created) newCases += 1;
    }

    // 2. Age Bounds (18 - 65 years)
    const age = calculateAgeYears(emp.date_of_birth, refDate);
    if (age < 18 || age > 65) {
      ruleFlags.age_bounds += 1;
      const created = ensureCaseExists({
        rule_code: 'age_bounds',
        rule_label: 'Statutory Employment Age Bounds',
        severity: 'Critical',
        staff_id: emp.staff_id,
        employee_name: emp.full_name,
        station_id: emp.station_id,
        station_name: emp.station_name,
        district: emp.district,
        description: `Calculated age is ${age} years (DOB ${emp.date_of_birth}), outside permitted civil service range (18–65 yrs). Requires NRC documentary verification.`,
        financial_exposure: emp.gross_pay,
        raised_by_user_id: actor.id,
        raised_by_name: actor.full_name,
        deadline_days: 7,
      });
      if (created) newCases += 1;
    }

    // 3. Net-Pay Threshold (Take-home pay >= 40% of gross pay)
    const netRatio = emp.gross_pay > 0 ? emp.net_pay / emp.gross_pay : 1;
    if (netRatio < 0.4) {
      ruleFlags.net_pay_threshold += 1;
      const pct = (netRatio * 100).toFixed(1);
      const created = ensureCaseExists({
        rule_code: 'net_pay_threshold',
        rule_label: '40% Minimum Take-Home Pay Rule',
        severity: 'High',
        staff_id: emp.staff_id,
        employee_name: emp.full_name,
        station_id: emp.station_id,
        station_name: emp.station_name,
        district: emp.district,
        description: `Take-home net pay is K${emp.net_pay.toLocaleString()} (${pct}% of K${emp.gross_pay.toLocaleString()} gross), below the statutory 40% minimum threshold.`,
        financial_exposure: emp.gross_pay - emp.net_pay,
        raised_by_user_id: actor.id,
        raised_by_name: actor.full_name,
        deadline_days: 10,
      });
      if (created) newCases += 1;
    }

    // 4. Station Match (HR station vs PMEC extract & unverified active staff)
    const pmec = pmecByStaff.get(emp.staff_id);
    const stationMismatch = pmec && pmec.pmec_station_code !== emp.station_code;
    const unaccounted = emp.last_verification_outcome === 'Unaccounted at Station';
    const unverifiedActive = emp.payroll_placed === 1 && !emp.last_verified_at;
    if (stationMismatch || unaccounted || unverifiedActive) {
      ruleFlags.station_match += 1;
      const reason = unaccounted
        ? `Officer could not be physically accounted for at ${emp.station_name} during district verification.`
        : stationMismatch
          ? `HR register places officer at ${emp.station_code} (${emp.station_name}) while PMEC extract bills against ${pmec?.pmec_station_code}.`
          : `Active payroll officer at ${emp.station_name} has no scheduled workstation verification recorded this cycle.`;
      const created = ensureCaseExists({
        rule_code: 'station_match',
        rule_label: 'Station & Approved Post Verification',
        severity: unaccounted ? 'Critical' : 'High',
        staff_id: emp.staff_id,
        employee_name: emp.full_name,
        station_id: emp.station_id,
        station_name: emp.station_name,
        district: emp.district,
        description: reason,
        financial_exposure: emp.gross_pay,
        raised_by_user_id: actor.id,
        raised_by_name: actor.full_name,
        deadline_days: 7,
      });
      if (created) newCases += 1;
    }

    // 5. Absence Tracking (> 3 months or > 12 months prolonged absence)
    if (emp.absence_months >= 4) {
      ruleFlags.absence_tracking += 1;
      const created = ensureCaseExists({
        rule_code: 'absence_tracking',
        rule_label: 'Prolonged Absence Monitoring',
        severity: emp.absence_months >= 12 ? 'Critical' : 'Medium',
        staff_id: emp.staff_id,
        employee_name: emp.full_name,
        station_id: emp.station_id,
        station_name: emp.station_name,
        district: emp.district,
        description: `Reported absent from duty station for ${emp.absence_months} months while active on PMEC (Status: ${emp.employment_status}). Confirm leave approval or disciplinary file.`,
        financial_exposure: emp.gross_pay * emp.absence_months,
        raised_by_user_id: actor.id,
        raised_by_name: actor.full_name,
        deadline_days: 7,
      });
      if (created) newCases += 1;
    }

    // 6. Placement Ageing (Recruits pending payroll placement > 60 days)
    if (emp.payroll_placed === 0 && emp.recruit_date) {
      const daysPending = daysBetween(emp.recruit_date, refDate);
      if (daysPending > 60) {
        ruleFlags.placement_ageing += 1;
        const created = ensureCaseExists({
          rule_code: 'placement_ageing',
          rule_label: 'Recruitment Placement Ageing (> 60 Days)',
          severity: 'High',
          staff_id: emp.staff_id,
          employee_name: emp.full_name,
          station_id: emp.station_id,
          station_name: emp.station_name,
          district: emp.district,
          description: `Recruited on ${emp.recruit_date} (${daysPending} days ago) and verified at ${emp.station_name}, but still awaiting placement on active PMEC payroll.`,
          financial_exposure: emp.gross_pay,
          raised_by_user_id: actor.id,
          raised_by_name: actor.full_name,
          deadline_days: 5,
        });
        if (created) newCases += 1;
      }
    }
  }

  // Also check PMEC extract records missing from Authoritative HR Register (potential ghost workers)
  for (const pmec of pmecRows) {
    if (!empByStaff.has(pmec.staff_id)) {
      ruleFlags.unique_identity += 1;
      const station = db
        .prepare('SELECT id, name, district FROM stations WHERE code = ?')
        .get(pmec.pmec_station_code) as { id: string; name: string; district: string } | undefined;

      const created = ensureCaseExists({
        rule_code: 'unique_identity',
        rule_label: 'Unique Identity & Bank Check',
        severity: 'Critical',
        staff_id: pmec.staff_id,
        employee_name: pmec.full_name,
        station_id: station?.id ?? 'STN-KBW-01',
        station_name: station?.name ?? pmec.pmec_station_code,
        district: station?.district ?? 'Kabwe',
        description: `PMEC extract contains paid record ${pmec.staff_id} (K${pmec.pmec_gross_pay.toLocaleString()}) under ${pmec.pmec_station_code}, with no matching authoritative HR Staff ID.`,
        financial_exposure: pmec.pmec_gross_pay,
        raised_by_user_id: actor.id,
        raised_by_name: actor.full_name,
        deadline_days: 5,
      });
      if (created) newCases += 1;
    }
  }

  const openCountRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM exception_cases WHERE status IN ('Open', 'Under Investigation')`)
    .get() as { cnt: number };

  appendAuditLog({
    actor_user_id: actor.id,
    actor_name: actor.full_name,
    actor_role: actor.role,
    action: 'RUN_VALIDATION_CYCLE',
    target_type: 'validation_engine',
    target_id: '2026-11',
    summary: `Executed 6 automated validation rules & PMEC reconciliation across ${employees.length} HR records and ${pmecRows.length} PMEC lines. Opened ${newCases} new due-process review case(s).`,
  });

  return {
    records_checked: employees.length + pmecRows.length,
    new_cases_opened: newCases,
    total_open_cases: openCountRow.cnt,
    rules_executed: [
      { rule_code: 'unique_identity', rule_label: 'Unique Identity & Bank Check', flagged: ruleFlags.unique_identity },
      { rule_code: 'age_bounds', rule_label: 'Statutory Employment Age Bounds', flagged: ruleFlags.age_bounds },
      { rule_code: 'net_pay_threshold', rule_label: '40% Minimum Take-Home Pay Rule', flagged: ruleFlags.net_pay_threshold },
      { rule_code: 'station_match', rule_label: 'Station & Approved Post Verification', flagged: ruleFlags.station_match },
      { rule_code: 'absence_tracking', rule_label: 'Prolonged Absence Monitoring', flagged: ruleFlags.absence_tracking },
      { rule_code: 'placement_ageing', rule_label: 'Recruitment Placement Ageing (> 60 Days)', flagged: ruleFlags.placement_ageing },
    ],
  };
}
