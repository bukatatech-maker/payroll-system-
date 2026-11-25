import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserRole } from '../types/payroll.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'opms.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      district TEXT NOT NULL,
      assigned_station_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      district TEXT NOT NULL,
      province TEXT NOT NULL,
      ministry TEXT NOT NULL,
      approved_posts_count INTEGER NOT NULL,
      connectivity_tier TEXT NOT NULL,
      last_return_month TEXT
    );

    CREATE TABLE IF NOT EXISTS approved_posts (
      id TEXT PRIMARY KEY,
      post_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      salary_scale TEXT NOT NULL,
      station_id TEXT NOT NULL,
      budget_vote TEXT NOT NULL,
      is_filled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (station_id) REFERENCES stations(id)
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL UNIQUE,
      nrc_number TEXT NOT NULL,
      full_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      bank_account TEXT NOT NULL,
      station_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      employment_status TEXT NOT NULL,
      gross_pay REAL NOT NULL,
      net_pay REAL NOT NULL,
      absence_months INTEGER NOT NULL DEFAULT 0,
      recruit_date TEXT,
      payroll_placed INTEGER NOT NULL DEFAULT 1,
      last_verified_at TEXT,
      last_verification_outcome TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (station_id) REFERENCES stations(id),
      FOREIGN KEY (post_id) REFERENCES approved_posts(id)
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      from_station_id TEXT NOT NULL,
      to_station_id TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      authority_ref TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_returns (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL,
      return_month TEXT NOT NULL,
      headcount_reported INTEGER NOT NULL,
      present_count INTEGER NOT NULL,
      absent_count INTEGER NOT NULL,
      on_leave_count INTEGER NOT NULL,
      remarks TEXT NOT NULL,
      submitted_by TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      FOREIGN KEY (station_id) REFERENCES stations(id)
    );

    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      station_id TEXT NOT NULL,
      method TEXT NOT NULL,
      outcome TEXT NOT NULL,
      evidence_note TEXT NOT NULL,
      verified_by_user_id TEXT NOT NULL,
      verified_by_name TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      FOREIGN KEY (station_id) REFERENCES stations(id)
    );

    CREATE TABLE IF NOT EXISTS pmec_extracts (
      id TEXT PRIMARY KEY,
      pay_period TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      pmec_station_code TEXT NOT NULL,
      pmec_post_code TEXT NOT NULL,
      pmec_gross_pay REAL NOT NULL,
      pmec_net_pay REAL NOT NULL,
      pmec_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exception_cases (
      id TEXT PRIMARY KEY,
      case_number TEXT NOT NULL UNIQUE,
      rule_code TEXT NOT NULL,
      rule_label TEXT NOT NULL,
      severity TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      station_id TEXT NOT NULL,
      station_name TEXT NOT NULL,
      district TEXT NOT NULL,
      description TEXT NOT NULL,
      financial_exposure REAL NOT NULL DEFAULT 0,
      salary_protected INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Open',
      raised_by_user_id TEXT NOT NULL,
      raised_by_name TEXT NOT NULL,
      assigned_reviewer_id TEXT,
      assigned_reviewer_name TEXT,
      resolution_deadline TEXT NOT NULL,
      resolution_decision TEXT,
      resolution_notes TEXT,
      evidence_ref TEXT,
      resolved_by_user_id TEXT,
      resolved_by_name TEXT,
      resolved_at TEXT,
      payroll_applied_by TEXT,
      payroll_applied_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      timestamp TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monthly_trends (
      month TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      exception_cases INTEGER NOT NULL,
      resolved_cases INTEGER NOT NULL,
      payroll_variance_zmw REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS station_variance_baselines (
      station_id TEXT NOT NULL,
      month TEXT NOT NULL,
      variance_zmw REAL NOT NULL,
      open_cases_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (station_id, month),
      FOREIGN KEY (station_id) REFERENCES stations(id)
    );
  `);
}

function computeEntryHash(payload: {
  id: string;
  timestamp: string;
  actor_user_id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  summary: string;
  prev_hash: string;
}): string {
  const canonical = JSON.stringify([
    payload.id,
    payload.timestamp,
    payload.actor_user_id,
    payload.actor_name,
    payload.actor_role,
    payload.action,
    payload.target_type,
    payload.target_id,
    payload.summary,
    payload.prev_hash,
  ]);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function appendAuditLog(params: {
  actor_user_id: string;
  actor_name: string;
  actor_role: UserRole;
  action: string;
  target_type: string;
  target_id: string;
  summary: string;
  timestamp?: string;
}): void {
  const lastRow = db
    .prepare('SELECT entry_hash FROM audit_logs ORDER BY seq DESC LIMIT 1')
    .get() as { entry_hash: string } | undefined;

  const prev_hash = lastRow?.entry_hash ?? '0'.repeat(64);
  const id = `AUD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const timestamp = params.timestamp ?? new Date().toISOString();

  const entry_hash = computeEntryHash({
    id,
    timestamp,
    actor_user_id: params.actor_user_id,
    actor_name: params.actor_name,
    actor_role: params.actor_role,
    action: params.action,
    target_type: params.target_type,
    target_id: params.target_id,
    summary: params.summary,
    prev_hash,
  });

  db.prepare(`
    INSERT INTO audit_logs (
      id, timestamp, actor_user_id, actor_name, actor_role,
      action, target_type, target_id, summary, prev_hash, entry_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    timestamp,
    params.actor_user_id,
    params.actor_name,
    params.actor_role,
    params.action,
    params.target_type,
    params.target_id,
    params.summary,
    prev_hash,
    entry_hash
  );
}

export function verifyAuditChain(): {
  valid: boolean;
  total_entries: number;
  verified_entries: number;
  broken_seq: number | null;
  head_hash: string;
} {
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY seq ASC')
    .all() as Array<{
    seq: number;
    id: string;
    timestamp: string;
    actor_user_id: string;
    actor_name: string;
    actor_role: string;
    action: string;
    target_type: string;
    target_id: string;
    summary: string;
    prev_hash: string;
    entry_hash: string;
  }>;

  let expectedPrev = '0'.repeat(64);
  let verified = 0;

  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        total_entries: rows.length,
        verified_entries: verified,
        broken_seq: row.seq,
        head_hash: expectedPrev,
      };
    }

    const recomputed = computeEntryHash({
      id: row.id,
      timestamp: row.timestamp,
      actor_user_id: row.actor_user_id,
      actor_name: row.actor_name,
      actor_role: row.actor_role,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      summary: row.summary,
      prev_hash: row.prev_hash,
    });

    if (recomputed !== row.entry_hash) {
      return {
        valid: false,
        total_entries: rows.length,
        verified_entries: verified,
        broken_seq: row.seq,
        head_hash: row.entry_hash,
      };
    }

    expectedPrev = row.entry_hash;
    verified += 1;
  }

  return {
    valid: true,
    total_entries: rows.length,
    verified_entries: verified,
    broken_seq: null,
    head_hash: expectedPrev,
  };
}

export function seedInitialDataIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM stations').get() as { cnt: number };
  if (countRow.cnt > 0) {
    return;
  }

  const now = '2026-11-21T08:00:00.000Z';

  const stations = [
    {
      id: 'STN-CHB-01',
      code: 'MOE-CHB-101',
      name: 'Chibombo Boarding Secondary School',
      district: 'Chibombo',
      province: 'Central',
      ministry: 'Ministry of Education',
      approved_posts_count: 42,
      connectivity_tier: 'Intermittent',
      last_return_month: '2026-11',
    },
    {
      id: 'STN-CHB-02',
      code: 'MOE-CHB-104',
      name: 'Mwachisompola Primary School',
      district: 'Chibombo',
      province: 'Central',
      ministry: 'Ministry of Education',
      approved_posts_count: 24,
      connectivity_tier: 'District-Relay',
      last_return_month: '2026-11',
    },
    {
      id: 'STN-LSK-01',
      code: 'MOE-LSK-201',
      name: 'Kamwala South Secondary School',
      district: 'Lusaka',
      province: 'Lusaka',
      ministry: 'Ministry of Education',
      approved_posts_count: 58,
      connectivity_tier: 'Online',
      last_return_month: '2026-11',
    },
    {
      id: 'STN-KBW-01',
      code: 'MOE-KBW-305',
      name: 'Kabwe Highridge Secondary School',
      district: 'Kabwe',
      province: 'Central',
      ministry: 'Ministry of Education',
      approved_posts_count: 46,
      connectivity_tier: 'Online',
      last_return_month: '2026-10',
    },
    {
      id: 'STN-NDL-01',
      code: 'MOE-NDL-402',
      name: 'Masala Combined School',
      district: 'Ndola',
      province: 'Copperbelt',
      ministry: 'Ministry of Education',
      approved_posts_count: 35,
      connectivity_tier: 'Intermittent',
      last_return_month: '2026-11',
    },
    {
      id: 'STN-CHG-01',
      code: 'MOE-CHG-509',
      name: 'Chongwe District Education Board',
      district: 'Chongwe',
      province: 'Lusaka',
      ministry: 'Ministry of Education',
      approved_posts_count: 28,
      connectivity_tier: 'Online',
      last_return_month: '2026-11',
    },
  ];

  const insertStation = db.prepare(`
    INSERT INTO stations (id, code, name, district, province, ministry, approved_posts_count, connectivity_tier, last_return_month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of stations) {
    insertStation.run(
      s.id,
      s.code,
      s.name,
      s.district,
      s.province,
      s.ministry,
      s.approved_posts_count,
      s.connectivity_tier,
      s.last_return_month
    );
  }

  const users = [
    {
      id: 'USR-STN-01',
      full_name: 'Mwansa Phiri',
      email: 'm.phiri@education.gov.zm',
      role: 'station_officer',
      district: 'Chibombo',
      assigned_station_id: 'STN-CHB-01',
    },
    {
      id: 'USR-VER-01',
      full_name: 'Chanda Mulenga',
      email: 'c.mulenga@chibombo.gov.zm',
      role: 'district_verifier',
      district: 'Chibombo',
      assigned_station_id: null,
    },
    {
      id: 'USR-REV-01',
      full_name: 'Mutale Banda',
      email: 'm.banda@pmec-control.gov.zm',
      role: 'case_reviewer',
      district: 'National',
      assigned_station_id: null,
    },
    {
      id: 'USR-PAY-01',
      full_name: 'Lombe Katongo',
      email: 'l.katongo@mofnp.gov.zm',
      role: 'payroll_officer',
      district: 'National',
      assigned_station_id: null,
    },
    {
      id: 'USR-AUD-01',
      full_name: 'Dr. Kelvin Sichone',
      email: 'k.sichone@ago.gov.zm',
      role: 'auditor',
      district: 'National',
      assigned_station_id: null,
    },
    {
      id: 'USR-ADM-01',
      full_name: 'Andrew Mumba',
      email: 'a.mumba@opms.gov.zm',
      role: 'system_admin',
      district: 'National',
      assigned_station_id: null,
    },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id, full_name, email, role, district, assigned_station_id, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const u of users) {
    insertUser.run(u.id, u.full_name, u.email, u.role, u.district, u.assigned_station_id, now);
  }

  const posts = [
    { id: 'PST-001', post_code: 'EST-CHB-0101', title: 'Head Teacher (Grade I)', salary_scale: 'TMS-02', station_id: 'STN-CHB-01', budget_vote: '80/04/01', is_filled: 1 },
    { id: 'PST-002', post_code: 'EST-CHB-0102', title: 'Senior Teacher - Mathematics', salary_scale: 'TMS-04', station_id: 'STN-CHB-01', budget_vote: '80/04/01', is_filled: 1 },
    { id: 'PST-003', post_code: 'EST-CHB-0103', title: 'Secondary School Teacher - Biology', salary_scale: 'TMS-05', station_id: 'STN-CHB-01', budget_vote: '80/04/01', is_filled: 1 },
    { id: 'PST-004', post_code: 'EST-CHB-0104', title: 'Secondary School Teacher - English', salary_scale: 'TMS-05', station_id: 'STN-CHB-01', budget_vote: '80/04/01', is_filled: 1 },
    { id: 'PST-005', post_code: 'EST-CHB-0201', title: 'Primary Teacher - Grade 6', salary_scale: 'TMP-06', station_id: 'STN-CHB-02', budget_vote: '80/04/02', is_filled: 1 },
    { id: 'PST-006', post_code: 'EST-CHB-0202', title: 'Primary Teacher - Literacy', salary_scale: 'TMP-06', station_id: 'STN-CHB-02', budget_vote: '80/04/02', is_filled: 1 },
    { id: 'PST-007', post_code: 'EST-LSK-0101', title: 'Deputy Head Teacher', salary_scale: 'TMS-03', station_id: 'STN-LSK-01', budget_vote: '80/02/01', is_filled: 1 },
    { id: 'PST-008', post_code: 'EST-LSK-0102', title: 'Secondary Teacher - Physics', salary_scale: 'TMS-05', station_id: 'STN-LSK-01', budget_vote: '80/02/01', is_filled: 1 },
    { id: 'PST-009', post_code: 'EST-LSK-0103', title: 'Secondary Teacher - Civic Ed', salary_scale: 'TMS-05', station_id: 'STN-LSK-01', budget_vote: '80/02/01', is_filled: 1 },
    { id: 'PST-010', post_code: 'EST-KBW-0101', title: 'Senior Teacher - Chemistry', salary_scale: 'TMS-04', station_id: 'STN-KBW-01', budget_vote: '80/04/05', is_filled: 1 },
    { id: 'PST-011', post_code: 'EST-KBW-0102', title: 'Guidance & Counselling Officer', salary_scale: 'TMS-05', station_id: 'STN-KBW-01', budget_vote: '80/04/05', is_filled: 1 },
    { id: 'PST-012', post_code: 'EST-NDL-0101', title: 'Primary Teacher - Science', salary_scale: 'TMP-06', station_id: 'STN-NDL-01', budget_vote: '80/05/03', is_filled: 1 },
    { id: 'PST-013', post_code: 'EST-NDL-0102', title: 'Secondary Teacher - ICT', salary_scale: 'TMS-05', station_id: 'STN-NDL-01', budget_vote: '80/05/03', is_filled: 0 },
    { id: 'PST-014', post_code: 'EST-CHG-0101', title: 'District Education Standards Officer', salary_scale: 'DES-03', station_id: 'STN-CHG-01', budget_vote: '80/02/09', is_filled: 1 },
    { id: 'PST-015', post_code: 'EST-CHB-0105', title: 'Secondary Teacher - Geography', salary_scale: 'TMS-05', station_id: 'STN-CHB-01', budget_vote: '80/04/01', is_filled: 0 },
  ];

  const insertPost = db.prepare(`
    INSERT INTO approved_posts (id, post_code, title, salary_scale, station_id, budget_vote, is_filled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of posts) {
    insertPost.run(p.id, p.post_code, p.title, p.salary_scale, p.station_id, p.budget_vote, p.is_filled);
  }

  // Authoritative employee records: mix of nominal compliant staff and realistic cases mirroring Table 2.1 & 3.1
  const employees = [
    {
      id: 'EMP-001',
      staff_id: 'ZMB-MOE-10421',
      nrc_number: '241509/10/1',
      full_name: 'Bwalya Tembo',
      date_of_birth: '1979-04-12',
      bank_account: 'ZANACO-0041928310',
      station_id: 'STN-CHB-01',
      post_id: 'PST-001',
      employment_status: 'Active',
      gross_pay: 14850,
      net_pay: 9200,
      absence_months: 0,
      recruit_date: '2011-01-15',
      payroll_placed: 1,
      last_verified_at: '2026-11-05T10:20:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-002',
      staff_id: 'ZMB-MOE-10422',
      nrc_number: '318944/17/1',
      full_name: 'Kabwe Mwewa',
      date_of_birth: '1986-08-23',
      bank_account: 'INDO-8821049123',
      station_id: 'STN-CHB-01',
      post_id: 'PST-002',
      employment_status: 'Active',
      gross_pay: 11400,
      net_pay: 6840,
      absence_months: 0,
      recruit_date: '2014-05-01',
      payroll_placed: 1,
      last_verified_at: '2026-11-05T10:35:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-003',
      staff_id: 'ZMB-MOE-10423',
      nrc_number: '402187/10/1',
      full_name: 'Thandiwe Zulu',
      date_of_birth: '1991-11-02',
      bank_account: 'STANBIC-1902384711',
      station_id: 'STN-CHB-01',
      post_id: 'PST-003',
      employment_status: 'Active',
      gross_pay: 10200,
      net_pay: 3450, // < 40% take-home net-pay breach (33.8%)
      absence_months: 0,
      recruit_date: '2019-02-10',
      payroll_placed: 1,
      last_verified_at: '2026-11-05T10:50:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-004',
      staff_id: 'ZMB-MOE-10424',
      nrc_number: '389102/16/1',
      full_name: 'Mubanga Chileshe',
      date_of_birth: '1988-02-19',
      bank_account: 'ABSA-4410293847',
      station_id: 'STN-CHB-01',
      post_id: 'PST-004',
      employment_status: 'Active',
      gross_pay: 10200,
      net_pay: 6150,
      absence_months: 14, // > 12 months prolonged absence
      recruit_date: '2016-09-01',
      payroll_placed: 1,
      last_verified_at: '2026-11-06T09:15:00.000Z',
      last_verification_outcome: 'Unaccounted at Station',
    },
    {
      id: 'EMP-005',
      staff_id: 'ZMB-MOE-10815',
      nrc_number: '519023/17/1',
      full_name: 'Natasha Lungu',
      date_of_birth: '1994-06-30',
      bank_account: 'ZANACO-0092837465',
      station_id: 'STN-CHB-02',
      post_id: 'PST-005',
      employment_status: 'Active',
      gross_pay: 9100,
      net_pay: 5580,
      absence_months: 0,
      recruit_date: '2021-03-14',
      payroll_placed: 1,
      last_verified_at: '2026-11-07T11:00:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-006',
      staff_id: 'ZMB-MOE-10816',
      nrc_number: '298341/10/1',
      full_name: 'Derrick Mumba',
      date_of_birth: '1984-12-08',
      bank_account: 'FNB-7738291044',
      station_id: 'STN-CHB-02',
      post_id: 'PST-006',
      employment_status: 'Transferred',
      gross_pay: 9100,
      net_pay: 5400,
      absence_months: 0,
      recruit_date: '2015-07-01',
      payroll_placed: 1,
      last_verified_at: '2026-11-07T11:20:00.000Z',
      last_verification_outcome: 'Transferred - Pending Update',
    },
    {
      id: 'EMP-007',
      staff_id: 'ZMB-MOE-20104',
      nrc_number: '332190/10/1',
      full_name: 'Grace Mwanza',
      date_of_birth: '1982-09-14',
      bank_account: 'ZANACO-0078123490',
      station_id: 'STN-LSK-01',
      post_id: 'PST-007',
      employment_status: 'Active',
      gross_pay: 13500,
      net_pay: 8100,
      absence_months: 0,
      recruit_date: '2012-04-02',
      payroll_placed: 1,
      last_verified_at: '2026-11-04T14:10:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-008',
      staff_id: 'ZMB-MOE-20105',
      nrc_number: '612093/10/1',
      full_name: 'Chisomo Nyirenda',
      date_of_birth: '2010-05-18', // Underage entry (< 18 years)
      bank_account: 'ATLAS-9910234811',
      station_id: 'STN-LSK-01',
      post_id: 'PST-008',
      employment_status: 'Active',
      gross_pay: 10200,
      net_pay: 6300,
      absence_months: 0,
      recruit_date: '2024-08-01',
      payroll_placed: 1,
      last_verified_at: '2026-11-04T14:25:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-009',
      staff_id: 'ZMB-MOE-20106',
      nrc_number: '449812/10/1',
      full_name: 'Patrick Sakala',
      date_of_birth: '1990-01-27',
      bank_account: 'INDO-8821049123', // Duplicate bank account with EMP-002!
      station_id: 'STN-LSK-01',
      post_id: 'PST-009',
      employment_status: 'Active',
      gross_pay: 10200,
      net_pay: 6120,
      absence_months: 0,
      recruit_date: '2020-01-10',
      payroll_placed: 1,
      last_verified_at: '2026-11-04T14:40:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-010',
      staff_id: 'ZMB-MOE-30511',
      nrc_number: '278411/16/1',
      full_name: 'Josephine Kaluba',
      date_of_birth: '1985-07-05',
      bank_account: 'STANBIC-1908876123',
      station_id: 'STN-KBW-01',
      post_id: 'PST-010',
      employment_status: 'Active',
      gross_pay: 11400,
      net_pay: 6950,
      absence_months: 0,
      recruit_date: '2016-02-01',
      payroll_placed: 1,
      last_verified_at: null,
      last_verification_outcome: null, // Unverified station match risk
    },
    {
      id: 'EMP-011',
      staff_id: 'ZMB-MOE-30512',
      nrc_number: '365902/16/1',
      full_name: 'Emmanuel Musonda',
      date_of_birth: '1989-10-19',
      bank_account: 'ZANACO-0033445566',
      station_id: 'STN-KBW-01',
      post_id: 'PST-011',
      employment_status: 'Study Leave',
      gross_pay: 10200,
      net_pay: 6200,
      absence_months: 4,
      recruit_date: '2018-06-01',
      payroll_placed: 1,
      last_verified_at: '2026-10-22T09:00:00.000Z',
      last_verification_outcome: 'Approved Leave / Study',
    },
    {
      id: 'EMP-012',
      staff_id: 'ZMB-MOE-40201',
      nrc_number: '410982/67/1',
      full_name: 'Sylvia Kasonde',
      date_of_birth: '1993-03-11',
      bank_account: 'ABSA-4499887711',
      station_id: 'STN-NDL-01',
      post_id: 'PST-012',
      employment_status: 'Active',
      gross_pay: 9100,
      net_pay: 5500,
      absence_months: 0,
      recruit_date: '2020-08-15',
      payroll_placed: 1,
      last_verified_at: '2026-11-08T10:15:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-013',
      staff_id: 'ZMB-MOE-40299',
      nrc_number: '554120/67/1',
      full_name: 'Chipo Chilufya',
      date_of_birth: '1998-09-22',
      bank_account: 'FNB-7712349876',
      station_id: 'STN-NDL-01',
      post_id: 'PST-013',
      employment_status: 'Pending Placement',
      gross_pay: 10200,
      net_pay: 6250,
      absence_months: 0,
      recruit_date: '2025-07-15', // Recruited in July 2025 replacement exercise, still pending!
      payroll_placed: 0,
      last_verified_at: '2026-11-08T10:40:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-014',
      staff_id: 'ZMB-MOE-10498',
      nrc_number: '578341/17/1',
      full_name: 'Dalitso Banda',
      date_of_birth: '1997-11-16',
      bank_account: 'ZANACO-0061239871',
      station_id: 'STN-CHB-01',
      post_id: 'PST-015',
      employment_status: 'Pending Placement',
      gross_pay: 10200,
      net_pay: 6250,
      absence_months: 0,
      recruit_date: '2025-07-15', // Pending placement > 60 days
      payroll_placed: 0,
      last_verified_at: '2026-11-05T11:10:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
    {
      id: 'EMP-015',
      staff_id: 'ZMB-MOE-50901',
      nrc_number: '231044/10/1',
      full_name: 'Miriam Mbewe',
      date_of_birth: '1978-05-03',
      bank_account: 'ZANACO-0011229988',
      station_id: 'STN-CHG-01',
      post_id: 'PST-014',
      employment_status: 'Active',
      gross_pay: 15600,
      net_pay: 9800,
      absence_months: 0,
      recruit_date: '2009-03-01',
      payroll_placed: 1,
      last_verified_at: '2026-11-09T13:30:00.000Z',
      last_verification_outcome: 'Present & Verified',
    },
  ];

  const insertEmp = db.prepare(`
    INSERT INTO employees (
      id, staff_id, nrc_number, full_name, date_of_birth, bank_account,
      station_id, post_id, employment_status, gross_pay, net_pay,
      absence_months, recruit_date, payroll_placed, last_verified_at,
      last_verification_outcome, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of employees) {
    insertEmp.run(
      e.id,
      e.staff_id,
      e.nrc_number,
      e.full_name,
      e.date_of_birth,
      e.bank_account,
      e.station_id,
      e.post_id,
      e.employment_status,
      e.gross_pay,
      e.net_pay,
      e.absence_months,
      e.recruit_date,
      e.payroll_placed,
      e.last_verified_at,
      e.last_verification_outcome,
      now
    );
  }

  // Monthly PMEC Extract (includes station mismatch for EMP-006 + 1 unmatched ghost entry ZMB-MOE-99812)
  const pmecRows = [
    { id: 'PMEC-001', pay_period: '2026-11', staff_id: 'ZMB-MOE-10421', full_name: 'Bwalya Tembo', pmec_station_code: 'MOE-CHB-101', pmec_post_code: 'EST-CHB-0101', pmec_gross_pay: 14850, pmec_net_pay: 9200, pmec_status: 'Paid' },
    { id: 'PMEC-002', pay_period: '2026-11', staff_id: 'ZMB-MOE-10422', full_name: 'Kabwe Mwewa', pmec_station_code: 'MOE-CHB-101', pmec_post_code: 'EST-CHB-0102', pmec_gross_pay: 11400, pmec_net_pay: 6840, pmec_status: 'Paid' },
    { id: 'PMEC-003', pay_period: '2026-11', staff_id: 'ZMB-MOE-10423', full_name: 'Thandiwe Zulu', pmec_station_code: 'MOE-CHB-101', pmec_post_code: 'EST-CHB-0103', pmec_gross_pay: 10200, pmec_net_pay: 3450, pmec_status: 'Paid' },
    { id: 'PMEC-004', pay_period: '2026-11', staff_id: 'ZMB-MOE-10424', full_name: 'Mubanga Chileshe', pmec_station_code: 'MOE-CHB-101', pmec_post_code: 'EST-CHB-0104', pmec_gross_pay: 10200, pmec_net_pay: 6150, pmec_status: 'Paid' },
    { id: 'PMEC-005', pay_period: '2026-11', staff_id: 'ZMB-MOE-10815', full_name: 'Natasha Lungu', pmec_station_code: 'MOE-CHB-104', pmec_post_code: 'EST-CHB-0201', pmec_gross_pay: 9100, pmec_net_pay: 5580, pmec_status: 'Paid' },
    { id: 'PMEC-006', pay_period: '2026-11', staff_id: 'ZMB-MOE-10816', full_name: 'Derrick Mumba', pmec_station_code: 'MOE-KBW-305', pmec_post_code: 'EST-CHB-0202', pmec_gross_pay: 9100, pmec_net_pay: 5400, pmec_status: 'Paid' },
    { id: 'PMEC-007', pay_period: '2026-11', staff_id: 'ZMB-MOE-20104', full_name: 'Grace Mwanza', pmec_station_code: 'MOE-LSK-201', pmec_post_code: 'EST-LSK-0101', pmec_gross_pay: 13500, pmec_net_pay: 8100, pmec_status: 'Paid' },
    { id: 'PMEC-008', pay_period: '2026-11', staff_id: 'ZMB-MOE-20105', full_name: 'Chisomo Nyirenda', pmec_station_code: 'MOE-LSK-201', pmec_post_code: 'EST-LSK-0102', pmec_gross_pay: 10200, pmec_net_pay: 6300, pmec_status: 'Paid' },
    { id: 'PMEC-009', pay_period: '2026-11', staff_id: 'ZMB-MOE-20106', full_name: 'Patrick Sakala', pmec_station_code: 'MOE-LSK-201', pmec_post_code: 'EST-LSK-0103', pmec_gross_pay: 10200, pmec_net_pay: 6120, pmec_status: 'Paid' },
    { id: 'PMEC-010', pay_period: '2026-11', staff_id: 'ZMB-MOE-30511', full_name: 'Josephine Kaluba', pmec_station_code: 'MOE-KBW-305', pmec_post_code: 'EST-KBW-0101', pmec_gross_pay: 11400, pmec_net_pay: 6950, pmec_status: 'Paid' },
    { id: 'PMEC-011', pay_period: '2026-11', staff_id: 'ZMB-MOE-30512', full_name: 'Emmanuel Musonda', pmec_station_code: 'MOE-KBW-305', pmec_post_code: 'EST-KBW-0102', pmec_gross_pay: 10200, pmec_net_pay: 6200, pmec_status: 'Paid' },
    { id: 'PMEC-012', pay_period: '2026-11', staff_id: 'ZMB-MOE-40201', full_name: 'Sylvia Kasonde', pmec_station_code: 'MOE-NDL-402', pmec_post_code: 'EST-NDL-0101', pmec_gross_pay: 9100, pmec_net_pay: 5500, pmec_status: 'Paid' },
    { id: 'PMEC-013', pay_period: '2026-11', staff_id: 'ZMB-MOE-50901', full_name: 'Miriam Mbewe', pmec_station_code: 'MOE-CHG-509', pmec_post_code: 'EST-CHG-0101', pmec_gross_pay: 15600, pmec_net_pay: 9800, pmec_status: 'Paid' },
    { id: 'PMEC-014', pay_period: '2026-11', staff_id: 'ZMB-MOE-99812', full_name: 'Unknown / Legacy Record', pmec_station_code: 'MOE-KBW-305', pmec_post_code: 'EST-KBW-9999', pmec_gross_pay: 9800, pmec_net_pay: 5900, pmec_status: 'Paid' },
  ];

  const insertPmec = db.prepare(`
    INSERT INTO pmec_extracts (id, pay_period, staff_id, full_name, pmec_station_code, pmec_post_code, pmec_gross_pay, pmec_net_pay, pmec_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of pmecRows) {
    insertPmec.run(r.id, r.pay_period, r.staff_id, r.full_name, r.pmec_station_code, r.pmec_post_code, r.pmec_gross_pay, r.pmec_net_pay, r.pmec_status);
  }

  // Initial Station Returns
  db.prepare(`
    INSERT INTO station_returns (id, station_id, return_month, headcount_reported, present_count, absent_count, on_leave_count, remarks, submitted_by, submitted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'RET-2026-11-CHB01',
    'STN-CHB-01',
    '2026-11',
    5,
    4,
    1,
    0,
    'Monthly digital return submitted. 1 officer (ZMB-MOE-10424) reported absent; 1 July 2025 recruit awaiting PMEC placement.',
    'Mwansa Phiri',
    '2026-11-05T12:00:00.000Z'
  );

  // Initial Transfers
  db.prepare(`
    INSERT INTO transfers (id, staff_id, from_station_id, to_station_id, effective_date, authority_ref, recorded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TRF-2026-019',
    'ZMB-MOE-10816',
    'STN-CHB-02',
    'STN-KBW-01',
    '2026-10-01',
    'MOE/CEN/TRF/2026/412',
    'Mwansa Phiri',
    '2026-10-12T09:30:00.000Z'
  );

  // Initial Verifications
  const insertVerif = db.prepare(`
    INSERT INTO verifications (id, staff_id, station_id, method, outcome, evidence_note, verified_by_user_id, verified_by_name, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertVerif.run('VER-101', 'ZMB-MOE-10421', 'STN-CHB-01', 'Physical Roll-Call', 'Present & Verified', 'Verified in person at Chibombo Boarding Secondary; NRC & appointment letter sighted.', 'USR-VER-01', 'Chanda Mulenga', '2026-11-05T10:20:00.000Z');
  insertVerif.run('VER-102', 'ZMB-MOE-10424', 'STN-CHB-01', 'District Headcount Audit', 'Unaccounted at Station', 'Officer not present during unannounced physical headcount; Head Teacher reports >12 months unapproved absence.', 'USR-VER-01', 'Chanda Mulenga', '2026-11-06T09:15:00.000Z');
  insertVerif.run('VER-103', 'ZMB-MOE-10816', 'STN-CHB-02', 'Physical Roll-Call', 'Transferred - Pending Update', 'Transfer authority MOE/CEN/TRF/2026/412 sighted; PMEC moved station to Kabwe but HR register still lists Mwachisompola.', 'USR-VER-01', 'Chanda Mulenga', '2026-11-07T11:20:00.000Z');

  // Seed initial audit log genesis + baseline events
  appendAuditLog({
    actor_user_id: 'USR-ADM-01',
    actor_name: 'Andrew Mumba',
    actor_role: 'system_admin',
    action: 'SYSTEM_GENESIS',
    target_type: 'platform',
    target_id: 'OPMS-ZAMBIA-PILOT',
    summary: 'Initialized One Payroll Management System authoritative relational register and SHA-256 tamper-evident audit chain.',
    timestamp: '2026-11-01T08:00:00.000Z',
  });

  appendAuditLog({
    actor_user_id: 'USR-STN-01',
    actor_name: 'Mwansa Phiri',
    actor_role: 'station_officer',
    action: 'SUBMIT_STATION_RETURN',
    target_type: 'station',
    target_id: 'STN-CHB-01',
    summary: 'Submitted November 2026 digital station return for Chibombo Boarding Secondary School (4 present, 1 absent).',
    timestamp: '2026-11-05T12:00:00.000Z',
  });

  appendAuditLog({
    actor_user_id: 'USR-VER-01',
    actor_name: 'Chanda Mulenga',
    actor_role: 'district_verifier',
    action: 'RECORD_VERIFICATION',
    target_type: 'employee',
    target_id: 'ZMB-MOE-10424',
    summary: 'Recorded physical workstation verification outcome: Unaccounted at Station for ZMB-MOE-10424 (salary protected pending investigation).',
    timestamp: '2026-11-06T09:15:00.000Z',
  });

  ensureMonthlyTrendsSeeded();
  ensureStationBaselinesSeeded();
}

export function ensureMonthlyTrendsSeeded(): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM monthly_trends').get() as { cnt: number };
  if (row.cnt > 0) {
    return;
  }

  const history = [
    { month: '2026-06', label: 'Jun 2026', exception_cases: 19, resolved_cases: 6, payroll_variance_zmw: 412500 },
    { month: '2026-07', label: 'Jul 2026', exception_cases: 22, resolved_cases: 9, payroll_variance_zmw: 448900 },
    { month: '2026-08', label: 'Aug 2026', exception_cases: 18, resolved_cases: 11, payroll_variance_zmw: 384200 },
    { month: '2026-09', label: 'Sep 2026', exception_cases: 16, resolved_cases: 12, payroll_variance_zmw: 341600 },
    { month: '2026-10', label: 'Oct 2026', exception_cases: 14, resolved_cases: 10, payroll_variance_zmw: 315400 },
  ];

  const stmt = db.prepare(`
    INSERT INTO monthly_trends (month, label, exception_cases, resolved_cases, payroll_variance_zmw)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const h of history) {
    stmt.run(h.month, h.label, h.exception_cases, h.resolved_cases, h.payroll_variance_zmw);
  }
}

export function ensureStationBaselinesSeeded(): void {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM station_variance_baselines')
    .get() as { cnt: number };
  if (row.cnt > 0) {
    return;
  }

  const baselines: Array<{
    station_id: string;
    month: string;
    variance_zmw: number;
    open_cases_count: number;
  }> = [
    // Chibombo Boarding Secondary School (STN-CHB-01): Nov live is K181,350 (+37.4% vs Oct K132,000)
    { station_id: 'STN-CHB-01', month: '2026-05', variance_zmw: 158000, open_cases_count: 5 },
    { station_id: 'STN-CHB-01', month: '2026-06', variance_zmw: 168500, open_cases_count: 6 },
    { station_id: 'STN-CHB-01', month: '2026-07', variance_zmw: 192400, open_cases_count: 7 },
    { station_id: 'STN-CHB-01', month: '2026-08', variance_zmw: 164000, open_cases_count: 5 },
    { station_id: 'STN-CHB-01', month: '2026-09', variance_zmw: 146500, open_cases_count: 4 },
    { station_id: 'STN-CHB-01', month: '2026-10', variance_zmw: 132000, open_cases_count: 4 },

    // Kabwe Highridge Secondary School (STN-KBW-01): Nov live is K62,000 (+39.3% vs Oct K44,500)
    { station_id: 'STN-KBW-01', month: '2026-05', variance_zmw: 58000, open_cases_count: 3 },
    { station_id: 'STN-KBW-01', month: '2026-06', variance_zmw: 61200, open_cases_count: 3 },
    { station_id: 'STN-KBW-01', month: '2026-07', variance_zmw: 69800, open_cases_count: 4 },
    { station_id: 'STN-KBW-01', month: '2026-08', variance_zmw: 56400, open_cases_count: 3 },
    { station_id: 'STN-KBW-01', month: '2026-09', variance_zmw: 49000, open_cases_count: 2 },
    { station_id: 'STN-KBW-01', month: '2026-10', variance_zmw: 44500, open_cases_count: 2 },

    // Kamwala South Secondary School (STN-LSK-01): Nov live is K20,400 (+3.0% vs Oct K19,800)
    { station_id: 'STN-LSK-01', month: '2026-05', variance_zmw: 28400, open_cases_count: 3 },
    { station_id: 'STN-LSK-01', month: '2026-06', variance_zmw: 31500, open_cases_count: 3 },
    { station_id: 'STN-LSK-01', month: '2026-07', variance_zmw: 37800, open_cases_count: 4 },
    { station_id: 'STN-LSK-01', month: '2026-08', variance_zmw: 29400, open_cases_count: 3 },
    { station_id: 'STN-LSK-01', month: '2026-09', variance_zmw: 22100, open_cases_count: 2 },
    { station_id: 'STN-LSK-01', month: '2026-10', variance_zmw: 19800, open_cases_count: 2 },

    // Masala Combined School (STN-NDL-01): Nov live is K10,200 (-10.5% vs Oct K11,400)
    { station_id: 'STN-NDL-01', month: '2026-05', variance_zmw: 16200, open_cases_count: 2 },
    { station_id: 'STN-NDL-01', month: '2026-06', variance_zmw: 18900, open_cases_count: 2 },
    { station_id: 'STN-NDL-01', month: '2026-07', variance_zmw: 19500, open_cases_count: 2 },
    { station_id: 'STN-NDL-01', month: '2026-08', variance_zmw: 14800, open_cases_count: 2 },
    { station_id: 'STN-NDL-01', month: '2026-09', variance_zmw: 12900, open_cases_count: 1 },
    { station_id: 'STN-NDL-01', month: '2026-10', variance_zmw: 11400, open_cases_count: 1 },

    // Mwachisompola Primary School (STN-CHB-02): Nov live is K9,100 (0% vs Oct K9,100)
    { station_id: 'STN-CHB-02', month: '2026-05', variance_zmw: 11200, open_cases_count: 1 },
    { station_id: 'STN-CHB-02', month: '2026-06', variance_zmw: 12400, open_cases_count: 2 },
    { station_id: 'STN-CHB-02', month: '2026-07', variance_zmw: 11800, open_cases_count: 2 },
    { station_id: 'STN-CHB-02', month: '2026-08', variance_zmw: 10500, open_cases_count: 1 },
    { station_id: 'STN-CHB-02', month: '2026-09', variance_zmw: 9100, open_cases_count: 1 },
    { station_id: 'STN-CHB-02', month: '2026-10', variance_zmw: 9100, open_cases_count: 1 },

    // Chongwe District Education Board (STN-CHG-01): Nov live is K0
    { station_id: 'STN-CHG-01', month: '2026-05', variance_zmw: 4200, open_cases_count: 1 },
    { station_id: 'STN-CHG-01', month: '2026-06', variance_zmw: 4200, open_cases_count: 1 },
    { station_id: 'STN-CHG-01', month: '2026-07', variance_zmw: 3100, open_cases_count: 1 },
    { station_id: 'STN-CHG-01', month: '2026-08', variance_zmw: 1800, open_cases_count: 1 },
    { station_id: 'STN-CHG-01', month: '2026-09', variance_zmw: 0, open_cases_count: 0 },
    { station_id: 'STN-CHG-01', month: '2026-10', variance_zmw: 0, open_cases_count: 0 },
  ];

  const stmt = db.prepare(`
    INSERT INTO station_variance_baselines (station_id, month, variance_zmw, open_cases_count)
    VALUES (?, ?, ?, ?)
  `);
  for (const b of baselines) {
    stmt.run(b.station_id, b.month, b.variance_zmw, b.open_cases_count);
  }
}
