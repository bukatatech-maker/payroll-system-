import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { UserAccount, UserRole } from './src/types/payroll.ts';
import {
  appendAuditLog,
  db,
  ensureMonthlyTrendsSeeded,
  ensureStationBaselinesSeeded,
  initSchema,
  seedInitialDataIfEmpty,
  verifyAuditChain,
} from './src/server/db.ts';
import {
  computeReconciliation,
  runAutomatedValidationCycle,
} from './src/server/validationEngine.ts';

const PORT = 3000;
const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

initSchema();
seedInitialDataIfEmpty();
ensureMonthlyTrendsSeeded();
ensureStationBaselinesSeeded();

// Ensure initial validation cases exist on first boot
const initialCasesCount = db
  .prepare('SELECT COUNT(*) as cnt FROM exception_cases')
  .get() as { cnt: number };
if (initialCasesCount.cnt === 0) {
  runAutomatedValidationCycle({
    id: 'USR-ADM-01',
    full_name: 'Andrew Mumba',
    role: 'system_admin',
  });
}

interface AuthenticatedRequest extends Request {
  user?: UserAccount;
}

interface TokenPayload {
  sub: string;
  role: UserRole;
  exp: number;
}

function signToken(user: UserAccount): string {
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.sub || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getUserById(id: string): UserAccount | undefined {
  return db
    .prepare(`
      SELECT u.*, s.name AS assigned_station_name
      FROM users u
      LEFT JOIN stations s ON s.id = u.assigned_station_id
      WHERE u.id = ?
    `)
    .get(id) as UserAccount | undefined;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Select an officer session to continue.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token.' });
    return;
  }
  const user = getUserById(payload.sub);
  if (!user || user.is_active !== 1) {
    res.status(403).json({ error: 'User account is inactive or no longer authorized.' });
    return;
  }
  req.user = user;
  next();
}

function requireRoles(allowed: UserRole[], restrictionMessage: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied for role "${req.user.role}". ${restrictionMessage}`,
      });
      return;
    }
    next();
  };
}

function isNonEmptyString(val: unknown, maxLen = 200): val is string {
  return typeof val === 'string' && val.trim().length > 0 && val.trim().length <= maxLen;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'opms-control-layer' });
});

// Public list of active pilot officer profiles for the session switcher
app.get('/api/auth/profiles', (_req, res) => {
  const profiles = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.role, u.district, u.assigned_station_id,
             s.name AS assigned_station_name, u.is_active, u.created_at
      FROM users u
      LEFT JOIN stations s ON s.id = u.assigned_station_id
      WHERE u.is_active = 1
      ORDER BY CASE u.role
        WHEN 'station_officer' THEN 1
        WHEN 'district_verifier' THEN 2
        WHEN 'case_reviewer' THEN 3
        WHEN 'payroll_officer' THEN 4
        WHEN 'auditor' THEN 5
        WHEN 'system_admin' THEN 6
        ELSE 7 END
    `)
    .all() as UserAccount[];
  res.json({ profiles });
});

// Issue signed Bearer session token for selected officer role
app.post('/api/auth/session', (req, res) => {
  const { user_id } = req.body as { user_id?: unknown };
  if (!isNonEmptyString(user_id, 64)) {
    res.status(400).json({ error: 'Valid user_id is required.' });
    return;
  }
  const user = getUserById(user_id.trim());
  if (!user || user.is_active !== 1) {
    res.status(404).json({ error: 'Active officer profile not found.' });
    return;
  }
  const token = signToken(user);
  appendAuditLog({
    actor_user_id: user.id,
    actor_name: user.full_name,
    actor_role: user.role,
    action: 'SESSION_AUTHENTICATED',
    target_type: 'user',
    target_id: user.id,
    summary: `Authenticated active role session as ${user.full_name} (${user.role}).`,
  });
  res.json({ token, user });
});

// Dashboard overview & report metrics (Step 5: Report)
app.get('/api/dashboard', requireAuth, (req, res) => {
  const monthRegex = /^\d{4}-\d{2}$/;
  const rawStart = typeof req.query.start_month === 'string' && monthRegex.test(req.query.start_month)
    ? req.query.start_month
    : '2026-06';
  const rawEnd = typeof req.query.end_month === 'string' && monthRegex.test(req.query.end_month)
    ? req.query.end_month
    : '2026-11';
  const startMonth = rawStart <= rawEnd ? rawStart : rawEnd;
  const endMonth = rawStart <= rawEnd ? rawEnd : rawStart;

  const empStats = db
    .prepare(`
      SELECT
        COUNT(*) AS total_staff,
        SUM(CASE WHEN payroll_placed = 1 THEN 1 ELSE 0 END) AS active_on_payroll,
        SUM(CASE WHEN last_verification_outcome = 'Present & Verified' THEN 1 ELSE 0 END) AS verified_station_count,
        SUM(CASE WHEN payroll_placed = 0 THEN 1 ELSE 0 END) AS pending_placement_count,
        SUM(CASE WHEN last_verified_at IS NULL OR payroll_placed = 0 THEN 1 ELSE 0 END) AS pending_validations_count,
        COALESCE(SUM(CASE WHEN payroll_placed = 1 THEN gross_pay ELSE 0 END), 0) AS total_monthly_gross_zmw
      FROM employees
    `)
    .get() as {
    total_staff: number;
    active_on_payroll: number;
    verified_station_count: number;
    pending_placement_count: number;
    pending_validations_count: number;
    total_monthly_gross_zmw: number;
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const caseStats = db
    .prepare(`
      SELECT
        SUM(CASE WHEN status IN ('Open', 'Under Investigation') THEN 1 ELSE 0 END) AS open_cases_count,
        SUM(CASE WHEN status IN ('Open', 'Under Investigation') AND resolution_deadline < ? THEN 1 ELSE 0 END) AS overdue_cases_count,
        SUM(CASE WHEN status IN ('Resolved', 'Applied to Payroll') THEN 1 ELSE 0 END) AS resolved_cases_count,
        COALESCE(SUM(CASE WHEN status IN ('Open', 'Under Investigation') THEN financial_exposure ELSE 0 END), 0) AS total_exposure_zmw
      FROM exception_cases
    `)
    .get(todayIso) as {
    open_cases_count: number;
    overdue_cases_count: number;
    resolved_cases_count: number;
    total_exposure_zmw: number;
  };

  const resolvedRows = db
    .prepare(`
      SELECT created_at, resolved_at
      FROM exception_cases
      WHERE resolved_at IS NOT NULL
    `)
    .all() as Array<{ created_at: string; resolved_at: string }>;

  let avgTurnaround = 2.4;
  if (resolvedRows.length > 0) {
    const totalDays = resolvedRows.reduce((acc, r) => {
      const diff =
        (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 86400000;
      return acc + Math.max(0.1, diff);
    }, 0);
    avgTurnaround = Number((totalDays / resolvedRows.length).toFixed(1));
  }

  const auditCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM audit_logs WHERE substr(timestamp, 1, 7) BETWEEN ? AND ?`
    )
    .get(startMonth, endMonth) as { cnt: number };
  const verifCount = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM verifications WHERE substr(verified_at, 1, 7) BETWEEN ? AND ?`
    )
    .get(startMonth, endMonth) as { cnt: number };

  const ruleMeta: Array<{
    rule_code: string;
    rule_label: string;
    audit_finding: string;
  }> = [
    {
      rule_code: 'unique_identity',
      rule_label: 'Unique Identity & Bank Check',
      audit_finding: 'Duplicate & ghost entries (Section 2.1)',
    },
    {
      rule_code: 'age_bounds',
      rule_label: 'Statutory Employment Age Bounds',
      audit_finding: '205 underage entries (2024 Audit)',
    },
    {
      rule_code: 'net_pay_threshold',
      rule_label: '40% Minimum Take-Home Pay Rule',
      audit_finding: '108 net-pay threshold breaches (2024 Audit)',
    },
    {
      rule_code: 'station_match',
      rule_label: 'Station & Approved Post Verification',
      audit_finding: '125 officers unaccounted across 24 stations (2025)',
    },
    {
      rule_code: 'absence_tracking',
      rule_label: 'Prolonged Absence Monitoring',
      audit_finding: '4 officers absent > 12 months, K224,612 (2025)',
    },
    {
      rule_code: 'placement_ageing',
      rule_label: 'Recruitment Placement Ageing (> 60 Days)',
      audit_finding: '1,524 of 4,319 teachers pending placement (Mar 2026)',
    },
  ];

  const ruleCounts = db
    .prepare(`
      SELECT
        rule_code,
        SUM(CASE WHEN status IN ('Open', 'Under Investigation') THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status IN ('Resolved', 'Applied to Payroll') THEN 1 ELSE 0 END) AS resolved_count
      FROM exception_cases
      GROUP BY rule_code
    `)
    .all() as Array<{ rule_code: string; open_count: number; resolved_count: number }>;
  const ruleMap = new Map(ruleCounts.map((r) => [r.rule_code, r]));

  const districtRows = db
    .prepare(`
      SELECT
        s.district,
        COUNT(DISTINCT s.id) AS station_count,
        COUNT(DISTINCT e.id) AS staff_count,
        SUM(CASE WHEN e.last_verification_outcome = 'Present & Verified' THEN 1 ELSE 0 END) AS verified_count,
        (
          SELECT COUNT(*)
          FROM exception_cases c
          WHERE c.district = s.district AND c.status IN ('Open', 'Under Investigation')
        ) AS open_cases
      FROM stations s
      LEFT JOIN employees e ON e.station_id = s.id
      GROUP BY s.district
      ORDER BY s.district ASC
    `)
    .all() as Array<{
    district: string;
    station_count: number;
    staff_count: number;
    verified_count: number;
    open_cases: number;
  }>;

  const verifiedPct =
    empStats.total_staff > 0
      ? Number(((empStats.verified_station_count / empStats.total_staff) * 100).toFixed(1))
      : 0;

  const reconciliationDiscrepanciesCount = computeReconciliation().filter(
    (item) => item.match_status !== 'Matched'
  ).length;

  const allTrends = [
    ...(db
      .prepare(
        'SELECT month, label, exception_cases, resolved_cases, payroll_variance_zmw FROM monthly_trends ORDER BY month ASC'
      )
      .all() as Array<{
      month: string;
      label: string;
      exception_cases: number;
      resolved_cases: number;
      payroll_variance_zmw: number;
    }>),
    {
      month: '2026-11',
      label: 'Nov 2026',
      exception_cases: caseStats.open_cases_count ?? 0,
      resolved_cases: caseStats.resolved_cases_count ?? 0,
      payroll_variance_zmw: caseStats.total_exposure_zmw ?? 0,
    },
  ];

  const filteredTrends = allTrends.filter(
    (t) => t.month >= startMonth && t.month <= endMonth
  );
  const includesCurrentMonth = endMonth >= '2026-11';
  const latestInRange = filteredTrends[filteredTrends.length - 1];

  const periodOpenCases = includesCurrentMonth
    ? (caseStats.open_cases_count ?? 0)
    : (latestInRange?.exception_cases ?? 0);

  const periodResolvedCases = filteredTrends.reduce((sum, t) => sum + t.resolved_cases, 0);

  const periodExposureZmw = includesCurrentMonth
    ? (caseStats.total_exposure_zmw ?? 0)
    : (latestInRange?.payroll_variance_zmw ?? 0);

  const periodPendingValidations = includesCurrentMonth
    ? empStats.pending_validations_count
    : Math.max(1, Math.round(periodOpenCases * 0.25));

  const periodReconciliationDiscrepancies = includesCurrentMonth
    ? reconciliationDiscrepanciesCount
    : Math.max(1, Math.round(periodOpenCases * 0.35));

  const periodVerifiedCount = includesCurrentMonth
    ? empStats.verified_station_count
    : Math.max(
        0,
        Math.min(
          empStats.total_staff,
          empStats.total_staff - Math.round(periodOpenCases * 0.3)
        )
      );
  const periodVerifiedPct =
    empStats.total_staff > 0
      ? Number(((periodVerifiedCount / empStats.total_staff) * 100).toFixed(1))
      : verifiedPct;

  const comparisonMonth = includesCurrentMonth ? '2026-11' : endMonth;
  const [compYearStr, compMonthStr] = comparisonMonth.split('-');
  const compYear = Number(compYearStr);
  const compMonthNum = Number(compMonthStr);
  const priorMonth =
    compMonthNum === 1
      ? `${compYear - 1}-12`
      : `${compYear}-${String(compMonthNum - 1).padStart(2, '0')}`;

  const stationRows = db
    .prepare(`
      SELECT
        s.id AS station_id,
        s.code AS station_code,
        s.name AS station_name,
        s.district,
        COALESCE(SUM(CASE WHEN e.payroll_placed = 1 THEN e.gross_pay ELSE 0 END), 0) AS gross_pay_zmw
      FROM stations s
      LEFT JOIN employees e ON e.station_id = s.id
      GROUP BY s.id
      ORDER BY s.name ASC
    `)
    .all() as Array<{
    station_id: string;
    station_code: string;
    station_name: string;
    district: string;
    gross_pay_zmw: number;
  }>;

  const liveStationExposures = db
    .prepare(`
      SELECT
        station_id,
        COUNT(*) AS open_cases_count,
        COALESCE(SUM(financial_exposure), 0) AS exposure_zmw
      FROM exception_cases
      WHERE status IN ('Open', 'Under Investigation')
      GROUP BY station_id
    `)
    .all() as Array<{
    station_id: string;
    open_cases_count: number;
    exposure_zmw: number;
  }>;
  const liveStationMap = new Map(liveStationExposures.map((r) => [r.station_id, r]));

  const baselineRows = db
    .prepare(`
      SELECT station_id, month, variance_zmw, open_cases_count
      FROM station_variance_baselines
      WHERE month IN (?, ?)
    `)
    .all(priorMonth, comparisonMonth) as Array<{
    station_id: string;
    month: string;
    variance_zmw: number;
    open_cases_count: number;
  }>;

  const priorBaselineMap = new Map<string, { variance_zmw: number; open_cases_count: number }>();
  const currentSnapshotMap = new Map<string, { variance_zmw: number; open_cases_count: number }>();
  for (const b of baselineRows) {
    if (b.month === priorMonth) {
      priorBaselineMap.set(b.station_id, {
        variance_zmw: b.variance_zmw,
        open_cases_count: b.open_cases_count,
      });
    }
    if (b.month === comparisonMonth) {
      currentSnapshotMap.set(b.station_id, {
        variance_zmw: b.variance_zmw,
        open_cases_count: b.open_cases_count,
      });
    }
  }

  const urgentPayrollAlerts = stationRows
    .map((stn) => {
      const prior = priorBaselineMap.get(stn.station_id)?.variance_zmw ?? 0;
      const live = liveStationMap.get(stn.station_id);
      const snapshot = currentSnapshotMap.get(stn.station_id);

      const currentVariance = includesCurrentMonth
        ? (live?.exposure_zmw ?? 0)
        : (snapshot?.variance_zmw ?? 0);
      const openCasesCount = includesCurrentMonth
        ? (live?.open_cases_count ?? 0)
        : (snapshot?.open_cases_count ?? 0);

      let spikePct = 0;
      if (prior > 0) {
        spikePct = ((currentVariance - prior) / prior) * 100;
      } else if (currentVariance > 0) {
        spikePct = 100;
      }

      return {
        station_id: stn.station_id,
        station_code: stn.station_code,
        station_name: stn.station_name,
        district: stn.district,
        baseline_month: priorMonth,
        current_month: comparisonMonth,
        baseline_variance_zmw: prior,
        current_variance_zmw: currentVariance,
        variance_delta_zmw: currentVariance - prior,
        spike_pct: Number(spikePct.toFixed(1)),
        open_cases_count: openCasesCount,
        gross_pay_zmw: stn.gross_pay_zmw,
      };
    })
    .filter((alert) => alert.current_variance_zmw > 0 && alert.spike_pct > 10)
    .sort((a, b) => b.spike_pct - a.spike_pct);

  // Regional Payroll Anomalies Heatmap (District/Province x Validation Rule)
  const ruleShortLabels: Array<{ code: string; shortLabel: string }> = [
    { code: 'absence_tracking', shortLabel: 'Absence' },
    { code: 'station_match', shortLabel: 'Station Match' },
    { code: 'unique_identity', shortLabel: 'Identity / Bank' },
    { code: 'placement_ageing', shortLabel: 'Placement' },
    { code: 'net_pay_threshold', shortLabel: 'Net Pay <40%' },
    { code: 'age_bounds', shortLabel: 'Age Bounds' },
  ];

  const districtMetaRows = db
    .prepare(`
      SELECT
        s.district,
        MIN(s.province) AS province,
        COUNT(DISTINCT s.id) AS station_count,
        COUNT(DISTINCT e.id) AS staff_count
      FROM stations s
      LEFT JOIN employees e ON e.station_id = s.id
      GROUP BY s.district
      ORDER BY s.district ASC
    `)
    .all() as Array<{
    district: string;
    province: string;
    station_count: number;
    staff_count: number;
  }>;

  const liveDistrictRuleRows = db
    .prepare(`
      SELECT
        district,
        rule_code,
        COUNT(*) AS cnt,
        COALESCE(SUM(financial_exposure), 0) AS exposure_zmw
      FROM exception_cases
      WHERE status IN ('Open', 'Under Investigation')
      GROUP BY district, rule_code
    `)
    .all() as Array<{
    district: string;
    rule_code: string;
    cnt: number;
    exposure_zmw: number;
  }>;

  const liveCellMap = new Map<string, { count: number; exposure: number }>();
  for (const r of liveDistrictRuleRows) {
    liveCellMap.set(`${r.district}::${r.rule_code}`, {
      count: r.cnt,
      exposure: r.exposure_zmw,
    });
  }

  const districtSnapshotRows = db
    .prepare(`
      SELECT
        s.district,
        COALESCE(SUM(b.variance_zmw), 0) AS exposure_zmw,
        COALESCE(SUM(b.open_cases_count), 0) AS open_cases_count
      FROM stations s
      LEFT JOIN station_variance_baselines b
        ON b.station_id = s.id AND b.month = ?
      GROUP BY s.district
    `)
    .all(comparisonMonth) as Array<{
    district: string;
    exposure_zmw: number;
    open_cases_count: number;
  }>;
  const districtSnapshotMap = new Map(districtSnapshotRows.map((d) => [d.district, d]));

  const regionalAnomalies = districtMetaRows
    .map((meta) => {
      if (includesCurrentMonth) {
        const cells = ruleShortLabels.map((rl) => {
          const hit = liveCellMap.get(`${meta.district}::${rl.code}`);
          return {
            rule_code: rl.code,
            rule_short_label: rl.shortLabel,
            count: hit?.count ?? 0,
            exposure_zmw: hit?.exposure ?? 0,
          };
        });
        const totalCases = cells.reduce((sum, c) => sum + c.count, 0);
        const totalExposure = cells.reduce((sum, c) => sum + c.exposure_zmw, 0);
        const priorityTier =
          totalExposure >= 100000 || totalCases >= 4
            ? 'Critical'
            : totalExposure >= 40000 || totalCases >= 3
              ? 'High'
              : totalCases >= 1
                ? 'Moderate'
                : 'Nominal';

        return {
          district: meta.district,
          province: meta.province,
          station_count: meta.station_count,
          staff_count: meta.staff_count,
          total_cases: totalCases,
          total_exposure_zmw: totalExposure,
          priority_tier: priorityTier,
          cells,
        };
      }

      // Historical period scaling from station_variance_baselines
      const snap = districtSnapshotMap.get(meta.district);
      const snapExposure = snap?.exposure_zmw ?? 0;
      const snapCases = snap?.open_cases_count ?? 0;
      const liveDistrictCells = ruleShortLabels.map((rl) => {
        const hit = liveCellMap.get(`${meta.district}::${rl.code}`);
        return {
          code: rl.code,
          shortLabel: rl.shortLabel,
          count: hit?.count ?? 0,
          exposure: hit?.exposure ?? 0,
        };
      });
      const liveExpSum = liveDistrictCells.reduce((s, c) => s + c.exposure, 0);

      const cells = liveDistrictCells.map((c, idx) => {
        if (snapExposure <= 0 || snapCases <= 0) {
          return {
            rule_code: c.code,
            rule_short_label: c.shortLabel,
            count: 0,
            exposure_zmw: 0,
          };
        }
        if (liveExpSum > 0) {
          const share = c.exposure / liveExpSum;
          return {
            rule_code: c.code,
            rule_short_label: c.shortLabel,
            count: c.count > 0 ? Math.max(1, Math.round(snapCases * (c.count / Math.max(1, liveDistrictCells.reduce((s, x) => s + x.count, 0))))) : 0,
            exposure_zmw: Math.round(snapExposure * share),
          };
        }
        return {
          rule_code: c.code,
          rule_short_label: c.shortLabel,
          count: idx === 1 ? snapCases : 0,
          exposure_zmw: idx === 1 ? snapExposure : 0,
        };
      });

      const totalExposure = cells.reduce((s, c) => s + c.exposure_zmw, 0);
      const totalCases = cells.reduce((s, c) => s + c.count, 0);
      const priorityTier =
        totalExposure >= 100000 || totalCases >= 4
          ? 'Critical'
          : totalExposure >= 40000 || totalCases >= 3
            ? 'High'
            : totalCases >= 1
              ? 'Moderate'
              : 'Nominal';

      return {
        district: meta.district,
        province: meta.province,
        station_count: meta.station_count,
        staff_count: meta.staff_count,
        total_cases: totalCases,
        total_exposure_zmw: totalExposure,
        priority_tier: priorityTier,
        cells,
      };
    })
    .sort((a, b) => b.total_exposure_zmw - a.total_exposure_zmw || b.total_cases - a.total_cases);

  // Top Performance Stations (Ranked by Validation Completion Rate)
  const stationPerfRows = db
    .prepare(`
      SELECT
        s.id AS station_id,
        s.code AS station_code,
        s.name AS station_name,
        s.district,
        s.province,
        s.last_return_month,
        COUNT(e.id) AS total_staff,
        SUM(CASE WHEN e.last_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified_staff,
        (
          SELECT COUNT(*)
          FROM exception_cases c
          WHERE c.station_id = s.id AND c.status IN ('Open', 'Under Investigation')
        ) AS live_open_cases,
        (
          SELECT COUNT(*)
          FROM exception_cases c
          WHERE c.station_id = s.id AND c.status IN ('Resolved', 'Applied to Payroll')
        ) AS live_resolved_cases
      FROM stations s
      LEFT JOIN employees e ON e.station_id = s.id
      GROUP BY s.id
    `)
    .all() as Array<{
    station_id: string;
    station_code: string;
    station_name: string;
    district: string;
    province: string;
    last_return_month: string | null;
    total_staff: number;
    verified_staff: number;
    live_open_cases: number;
    live_resolved_cases: number;
  }>;

  const topPerformingStations = stationPerfRows
    .map((stn) => {
      const snapOpen = currentSnapshotMap.get(stn.station_id)?.open_cases_count ?? 0;
      const openCases = includesCurrentMonth ? stn.live_open_cases : snapOpen;
      const resolvedCases = includesCurrentMonth ? stn.live_resolved_cases : 0;
      const returnSubmitted = includesCurrentMonth
        ? Boolean(stn.last_return_month && stn.last_return_month >= comparisonMonth)
        : true;
      const verifiedStaff = includesCurrentMonth
        ? stn.verified_staff
        : Math.max(0, stn.total_staff - Math.min(stn.total_staff, Math.round(openCases * 0.35)));

      const totalChecks = stn.total_staff + openCases + resolvedCases + 1;
      const completedChecks = verifiedStaff + resolvedCases + (returnSubmitted ? 1 : 0);
      const completionRate =
        totalChecks > 0 ? Number(((completedChecks / totalChecks) * 100).toFixed(1)) : 0;

      return {
        station_id: stn.station_id,
        station_code: stn.station_code,
        station_name: stn.station_name,
        district: stn.district,
        province: stn.province,
        total_staff: stn.total_staff,
        verified_staff: verifiedStaff,
        open_cases: openCases,
        resolved_cases: resolvedCases,
        return_submitted: returnSubmitted,
        completed_checks: completedChecks,
        total_checks: totalChecks,
        validation_completion_rate: completionRate,
      };
    })
    .sort(
      (a, b) =>
        b.validation_completion_rate - a.validation_completion_rate ||
        a.open_cases - b.open_cases ||
        b.total_staff - a.total_staff
    )
    .map((item, idx) => ({
      rank: idx + 1,
      ...item,
    }));

  res.json({
    total_staff: empStats.total_staff,
    active_on_payroll: empStats.active_on_payroll,
    verified_station_count: periodVerifiedCount,
    verified_station_pct: periodVerifiedPct,
    pending_placement_count: empStats.pending_placement_count,
    pending_validations_count: periodPendingValidations,
    reconciliation_discrepancies_count: periodReconciliationDiscrepancies,
    open_cases_count: periodOpenCases,
    overdue_cases_count: includesCurrentMonth ? (caseStats.overdue_cases_count ?? 0) : 0,
    resolved_cases_count: periodResolvedCases,
    avg_turnaround_days: avgTurnaround,
    total_exposure_zmw: periodExposureZmw,
    total_monthly_gross_zmw: empStats.total_monthly_gross_zmw,
    audit_chain_length: auditCount.cnt,
    rule_breakdown: ruleMeta.map((m) => ({
      rule_code: m.rule_code,
      rule_label: m.rule_label,
      audit_finding: m.audit_finding,
      open_count: ruleMap.get(m.rule_code)?.open_count ?? 0,
      resolved_count: ruleMap.get(m.rule_code)?.resolved_count ?? 0,
    })),
    district_breakdown: districtRows,
    workflow_counts: {
      registered: empStats.total_staff,
      verified_this_cycle: verifCount.cnt,
      validated_rules: 6,
      under_review: periodOpenCases,
      completed_actions: periodResolvedCases,
    },
    period: {
      start_month: startMonth,
      end_month: endMonth,
    },
    monthly_trends: filteredTrends,
    urgent_payroll_alerts: urgentPayrollAlerts,
    regional_anomalies: regionalAnomalies,
    top_performing_stations: topPerformingStations,
  });
});

// Stations & Approved Posts
app.get('/api/stations', requireAuth, (_req, res) => {
  const stations = db.prepare('SELECT * FROM stations ORDER BY district, name').all();
  const posts = db
    .prepare(`
      SELECT p.*, s.name AS station_name
      FROM approved_posts p
      JOIN stations s ON s.id = p.station_id
      ORDER BY p.post_code
    `)
    .all();
  res.json({ stations, posts });
});

// Staff Register (Step 1: Register)
app.get('/api/employees', requireAuth, (_req, res) => {
  const employees = db
    .prepare(`
      SELECT e.*, s.name AS station_name, s.district, p.post_code, p.title AS post_title
      FROM employees e
      JOIN stations s ON s.id = e.station_id
      JOIN approved_posts p ON p.id = e.post_id
      ORDER BY e.staff_id ASC
    `)
    .all();
  const transfers = db
    .prepare(`
      SELECT t.*, e.full_name AS employee_name,
             sf.name AS from_station_name, st.name AS to_station_name
      FROM transfers t
      LEFT JOIN employees e ON e.staff_id = t.staff_id
      LEFT JOIN stations sf ON sf.id = t.from_station_id
      LEFT JOIN stations st ON st.id = t.to_station_id
      ORDER BY t.created_at DESC
    `)
    .all();
  const returns = db
    .prepare(`
      SELECT r.*, s.name AS station_name, s.district
      FROM station_returns r
      JOIN stations s ON s.id = r.station_id
      ORDER BY r.submitted_at DESC
    `)
    .all();
  res.json({ employees, transfers, returns });
});

app.get('/api/employees/search', requireAuth, (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!rawQuery) {
    res.json({ results: [] });
    return;
  }

  const pattern = `%${rawQuery.toLowerCase()}%`;

  const registerMatches = db
    .prepare(`
      SELECT
        e.staff_id,
        e.full_name,
        e.nrc_number,
        e.station_id,
        s.code AS station_code,
        s.name AS station_name,
        s.district,
        p.post_code,
        p.title AS post_title,
        e.employment_status,
        e.gross_pay,
        e.net_pay,
        e.last_verification_outcome,
        (
          SELECT COUNT(*)
          FROM exception_cases c
          WHERE c.staff_id = e.staff_id AND c.status IN ('Open', 'Under Investigation')
        ) AS open_cases_count,
        'register' AS source
      FROM employees e
      JOIN stations s ON s.id = e.station_id
      JOIN approved_posts p ON p.id = e.post_id
      WHERE LOWER(e.staff_id) LIKE ?
         OR LOWER(e.full_name) LIKE ?
         OR LOWER(e.nrc_number) LIKE ?
         OR LOWER(s.name) LIKE ?
         OR LOWER(s.code) LIKE ?
      ORDER BY
        CASE WHEN LOWER(e.staff_id) = LOWER(?) THEN 0
             WHEN LOWER(e.staff_id) LIKE LOWER(?) THEN 1
             WHEN LOWER(e.full_name) LIKE LOWER(?) THEN 2
             ELSE 3 END,
        e.staff_id ASC
      LIMIT 12
    `)
    .all(
      pattern,
      pattern,
      pattern,
      pattern,
      pattern,
      rawQuery,
      `${rawQuery}%`,
      `${rawQuery}%`
    ) as Array<Record<string, unknown>>;

  const pmecUnmatched = db
    .prepare(`
      SELECT
        pm.staff_id,
        pm.full_name,
        NULL AS nrc_number,
        s.id AS station_id,
        pm.pmec_station_code AS station_code,
        COALESCE(s.name, 'PMEC Only (' || pm.pmec_station_code || ')') AS station_name,
        COALESCE(s.district, 'Unmatched PMEC') AS district,
        pm.pmec_post_code AS post_code,
        NULL AS post_title,
        'Unmatched in HR (PMEC Only)' AS employment_status,
        pm.pmec_gross_pay AS gross_pay,
        pm.pmec_net_pay AS net_pay,
        NULL AS last_verification_outcome,
        (
          SELECT COUNT(*)
          FROM exception_cases c
          WHERE c.staff_id = pm.staff_id AND c.status IN ('Open', 'Under Investigation')
        ) AS open_cases_count,
        'pmec_unmatched' AS source
      FROM pmec_extracts pm
      LEFT JOIN employees e ON e.staff_id = pm.staff_id
      LEFT JOIN stations s ON s.code = pm.pmec_station_code
      WHERE e.staff_id IS NULL
        AND (
          LOWER(pm.staff_id) LIKE ?
          OR LOWER(pm.full_name) LIKE ?
          OR LOWER(pm.pmec_station_code) LIKE ?
        )
      LIMIT 5
    `)
    .all(pattern, pattern, pattern) as Array<Record<string, unknown>>;

  res.json({
    results: [...registerMatches, ...pmecUnmatched].slice(0, 15),
  });
});

app.post(
  '/api/employees',
  requireAuth,
  requireRoles(
    ['station_officer', 'payroll_officer', 'system_admin'],
    'Only Station Officers (own station), Payroll Officers, or System Administrators may register staff records.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const body = req.body as Record<string, unknown>;
    const staff_id = String(body.staff_id ?? '').trim().toUpperCase();
    const nrc_number = String(body.nrc_number ?? '').trim();
    const full_name = String(body.full_name ?? '').trim();
    const date_of_birth = String(body.date_of_birth ?? '').trim();
    const bank_account = String(body.bank_account ?? '').trim();
    const station_id = String(body.station_id ?? '').trim();
    const post_id = String(body.post_id ?? '').trim();
    const employment_status = String(body.employment_status ?? 'Pending Placement').trim();
    const gross_pay = Number(body.gross_pay ?? 0);
    const net_pay = Number(body.net_pay ?? 0);
    const recruit_date = body.recruit_date ? String(body.recruit_date).trim() : new Date().toISOString().slice(0, 10);

    if (
      !isNonEmptyString(staff_id, 30) ||
      !isNonEmptyString(nrc_number, 30) ||
      !isNonEmptyString(full_name, 120) ||
      !isNonEmptyString(date_of_birth, 20) ||
      !isNonEmptyString(bank_account, 60) ||
      !isNonEmptyString(station_id, 40) ||
      !isNonEmptyString(post_id, 40)
    ) {
      res.status(400).json({ error: 'All required employee identity, post, and station fields must be provided.' });
      return;
    }

    if (Number.isNaN(gross_pay) || Number.isNaN(net_pay) || gross_pay <= 0 || net_pay < 0) {
      res.status(400).json({ error: 'Gross pay and net pay must be valid positive amounts.' });
      return;
    }

    if (actor.role === 'station_officer' && actor.assigned_station_id !== station_id) {
      res.status(403).json({
        error: 'Station Officer restriction: You may only register or update staff at your own assigned station.',
      });
      return;
    }

    const station = db.prepare('SELECT id, name FROM stations WHERE id = ?').get(station_id) as
      | { id: string; name: string }
      | undefined;
    const post = db.prepare('SELECT id FROM approved_posts WHERE id = ?').get(post_id) as
      | { id: string }
      | undefined;

    if (!station || !post) {
      res.status(400).json({ error: 'Selected station or approved establishment post does not exist.' });
      return;
    }

    const existingStaff = db.prepare('SELECT id FROM employees WHERE staff_id = ?').get(staff_id);
    if (existingStaff) {
      res.status(409).json({ error: `Staff ID ${staff_id} already exists in the authoritative register.` });
      return;
    }

    const id = `EMP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const payroll_placed = employment_status === 'Pending Placement' ? 0 : 1;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO employees (
        id, staff_id, nrc_number, full_name, date_of_birth, bank_account,
        station_id, post_id, employment_status, gross_pay, net_pay,
        absence_months, recruit_date, payroll_placed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id,
      staff_id,
      nrc_number,
      full_name,
      date_of_birth,
      bank_account,
      station_id,
      post_id,
      employment_status,
      gross_pay,
      net_pay,
      recruit_date,
      payroll_placed,
      now
    );

    db.prepare('UPDATE approved_posts SET is_filled = 1 WHERE id = ?').run(post_id);

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'REGISTER_STAFF',
      target_type: 'employee',
      target_id: staff_id,
      summary: `Registered ${full_name} (${staff_id}) at ${station.name} under status "${employment_status}".`,
    });

    res.status(201).json({ id, staff_id });
  }
);

// Bulk CSV Import for Staff Register & Station Updates
app.post(
  '/api/employees/bulk-import',
  requireAuth,
  requireRoles(
    ['station_officer', 'payroll_officer', 'system_admin'],
    'Only Station Officers (own station), Payroll Officers, or System Administrators may bulk-import payroll staff files.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const body = req.body as { rows?: unknown };
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      res.status(400).json({ error: 'Provide at least one parsed CSV row to import.' });
      return;
    }
    if (body.rows.length > 500) {
      res.status(400).json({ error: 'Maximum 500 rows allowed per bulk import batch.' });
      return;
    }

    const stationByCode = new Map<string, { id: string; code: string; name: string }>();
    const allStations = db.prepare('SELECT id, code, name FROM stations').all() as Array<{
      id: string;
      code: string;
      name: string;
    }>;
    for (const s of allStations) {
      stationByCode.set(s.code.toUpperCase(), s);
    }

    const postByCode = new Map<string, { id: string; post_code: string; station_id: string }>();
    const allPosts = db.prepare('SELECT id, post_code, station_id FROM approved_posts').all() as Array<{
      id: string;
      post_code: string;
      station_id: string;
    }>;
    for (const p of allPosts) {
      postByCode.set(p.post_code.toUpperCase(), p);
    }

    const findEmpStmt = db.prepare('SELECT * FROM employees WHERE staff_id = ?');
    const insertEmpStmt = db.prepare(`
      INSERT INTO employees (
        id, staff_id, nrc_number, full_name, date_of_birth, bank_account,
        station_id, post_id, employment_status, gross_pay, net_pay,
        absence_months, recruit_date, payroll_placed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
    const updateEmpStmt = db.prepare(`
      UPDATE employees
      SET station_id = ?,
          post_id = ?,
          employment_status = ?,
          gross_pay = ?,
          net_pay = ?,
          payroll_placed = ?,
          updated_at = ?
      WHERE staff_id = ?
    `);
    const insertTransferStmt = db.prepare(`
      INSERT INTO transfers (id, staff_id, from_station_id, to_station_id, effective_date, authority_ref, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const fillPostStmt = db.prepare('UPDATE approved_posts SET is_filled = 1 WHERE id = ?');

    let inserted = 0;
    let updated = 0;
    let transfersLogged = 0;
    const errors: Array<{ row: number; staff_id: string; reason: string }> = [];
    const now = new Date().toISOString();
    const todayDate = now.slice(0, 10);

    const runBatch = db.transaction((rows: Array<Record<string, unknown>>) => {
      rows.forEach((raw, idx) => {
        const rowNum = idx + 1;
        const staff_id = String(raw.staff_id ?? '').trim().toUpperCase();
        const station_code = String(raw.station_code ?? '').trim().toUpperCase();
        const post_code = String(raw.post_code ?? '').trim().toUpperCase();
        const employment_status = String(raw.employment_status ?? 'Pending Placement').trim();

        if (!isNonEmptyString(staff_id, 30)) {
          errors.push({ row: rowNum, staff_id: staff_id || '(blank)', reason: 'Missing valid staff_id.' });
          return;
        }

        const station = stationByCode.get(station_code);
        if (!station) {
          errors.push({
            row: rowNum,
            staff_id,
            reason: `Unknown station_code "${station_code || '(blank)'}".`,
          });
          return;
        }

        if (actor.role === 'station_officer' && actor.assigned_station_id !== station.id) {
          errors.push({
            row: rowNum,
            staff_id,
            reason: `Station Officer restriction: cannot import record for station ${station.code}.`,
          });
          return;
        }

        const existing = findEmpStmt.get(staff_id) as
          | {
              id: string;
              staff_id: string;
              station_id: string;
              post_id: string;
              employment_status: string;
              gross_pay: number;
              net_pay: number;
              payroll_placed: number;
            }
          | undefined;

        if (existing) {
          if (actor.role === 'station_officer' && actor.assigned_station_id !== existing.station_id) {
            errors.push({
              row: rowNum,
              staff_id,
              reason: 'Station Officer restriction: existing staff belongs to another station.',
            });
            return;
          }

          const resolvedPost = post_code ? postByCode.get(post_code) : undefined;
          if (post_code && !resolvedPost) {
            errors.push({ row: rowNum, staff_id, reason: `Unknown post_code "${post_code}".` });
            return;
          }

          const nextPostId = resolvedPost?.id ?? existing.post_id;
          const nextGross =
            raw.gross_pay !== undefined && String(raw.gross_pay).trim() !== ''
              ? Number(raw.gross_pay)
              : existing.gross_pay;
          const nextNet =
            raw.net_pay !== undefined && String(raw.net_pay).trim() !== ''
              ? Number(raw.net_pay)
              : existing.net_pay;

          if (Number.isNaN(nextGross) || Number.isNaN(nextNet) || nextGross <= 0 || nextNet < 0) {
            errors.push({ row: rowNum, staff_id, reason: 'Invalid gross_pay or net_pay amount.' });
            return;
          }

          const nextStatus = employment_status || existing.employment_status;
          const nextPlaced = nextStatus === 'Pending Placement' ? 0 : 1;

          if (existing.station_id !== station.id) {
            insertTransferStmt.run(
              `TRF-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
              staff_id,
              existing.station_id,
              station.id,
              todayDate,
              'BULK-CSV-IMPORT',
              actor.full_name,
              now
            );
            transfersLogged += 1;
          }

          updateEmpStmt.run(
            station.id,
            nextPostId,
            nextStatus,
            nextGross,
            nextNet,
            nextPlaced,
            now,
            staff_id
          );
          fillPostStmt.run(nextPostId);
          updated += 1;
          return;
        }

        // New staff registration
        const nrc_number = String(raw.nrc_number ?? '').trim();
        const full_name = String(raw.full_name ?? '').trim();
        const date_of_birth = String(raw.date_of_birth ?? '').trim();
        const bank_account = String(raw.bank_account ?? '').trim();
        const gross_pay = Number(raw.gross_pay ?? 0);
        const net_pay = Number(raw.net_pay ?? 0);
        const recruit_date = raw.recruit_date ? String(raw.recruit_date).trim() : todayDate;

        const post = postByCode.get(post_code);
        if (!post) {
          errors.push({
            row: rowNum,
            staff_id,
            reason: `Unknown post_code "${post_code || '(blank)'}".`,
          });
          return;
        }

        if (
          !isNonEmptyString(nrc_number, 30) ||
          !isNonEmptyString(full_name, 120) ||
          !isNonEmptyString(date_of_birth, 20) ||
          !isNonEmptyString(bank_account, 60)
        ) {
          errors.push({
            row: rowNum,
            staff_id,
            reason: 'New entry requires nrc_number, full_name, date_of_birth, and bank_account.',
          });
          return;
        }

        if (Number.isNaN(gross_pay) || Number.isNaN(net_pay) || gross_pay <= 0 || net_pay < 0) {
          errors.push({ row: rowNum, staff_id, reason: 'Invalid gross_pay or net_pay amount.' });
          return;
        }

        const empId = `EMP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
        const payroll_placed = employment_status === 'Pending Placement' ? 0 : 1;

        insertEmpStmt.run(
          empId,
          staff_id,
          nrc_number,
          full_name,
          date_of_birth,
          bank_account,
          station.id,
          post.id,
          employment_status,
          gross_pay,
          net_pay,
          recruit_date,
          payroll_placed,
          now
        );
        fillPostStmt.run(post.id);
        inserted += 1;
      });
    });

    runBatch(body.rows as Array<Record<string, unknown>>);

    if (inserted > 0 || updated > 0) {
      appendAuditLog({
        actor_user_id: actor.id,
        actor_name: actor.full_name,
        actor_role: actor.role,
        action: 'BULK_CSV_IMPORT',
        target_type: 'employee_batch',
        target_id: `CSV-${now.slice(0, 10)}`,
        summary: `Bulk CSV import processed by ${actor.full_name}: ${inserted} new staff registered, ${updated} station/record updates (${transfersLogged} transfer(s) logged), ${errors.length} skipped.`,
      });
    }

    res.status(200).json({
      inserted,
      updated,
      transfers_logged: transfersLogged,
      skipped: errors.length,
      errors,
    });
  }
);

// Transfer Tracking
app.post(
  '/api/transfers',
  requireAuth,
  requireRoles(
    ['station_officer', 'payroll_officer'],
    'Only Station Officers or Payroll Officers may record official station transfers.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const { staff_id, to_station_id, effective_date, authority_ref } = req.body as Record<string, unknown>;
    if (
      !isNonEmptyString(staff_id, 40) ||
      !isNonEmptyString(to_station_id, 40) ||
      !isNonEmptyString(effective_date, 20) ||
      !isNonEmptyString(authority_ref, 80)
    ) {
      res.status(400).json({ error: 'Staff ID, destination station, effective date, and authority reference are required.' });
      return;
    }

    const emp = db.prepare('SELECT * FROM employees WHERE staff_id = ?').get(staff_id.trim()) as
      | { id: string; staff_id: string; full_name: string; station_id: string }
      | undefined;
    if (!emp) {
      res.status(404).json({ error: 'Staff member not found.' });
      return;
    }

    if (
      actor.role === 'station_officer' &&
      actor.assigned_station_id !== emp.station_id &&
      actor.assigned_station_id !== to_station_id.trim()
    ) {
      res.status(403).json({
        error: 'Station Officer restriction: Transfer must involve your assigned station.',
      });
      return;
    }

    const destStation = db.prepare('SELECT id, name FROM stations WHERE id = ?').get(to_station_id.trim()) as
      | { id: string; name: string }
      | undefined;
    if (!destStation) {
      res.status(404).json({ error: 'Destination station not found.' });
      return;
    }

    const id = `TRF-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO transfers (id, staff_id, from_station_id, to_station_id, effective_date, authority_ref, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, emp.staff_id, emp.station_id, destStation.id, effective_date.trim(), authority_ref.trim(), actor.full_name, now);

    db.prepare(`
      UPDATE employees
      SET station_id = ?, employment_status = 'Active', updated_at = ?
      WHERE staff_id = ?
    `).run(destStation.id, now, emp.staff_id);

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'RECORD_TRANSFER',
      target_type: 'transfer',
      target_id: emp.staff_id,
      summary: `Logged transfer for ${emp.full_name} (${emp.staff_id}) to ${destStation.name} under authority ${authority_ref.trim()}.`,
    });

    res.status(201).json({ id });
  }
);

// Monthly Digital Station Return (Step 1: Register)
app.post(
  '/api/station-returns',
  requireAuth,
  requireRoles(
    ['station_officer'],
    'Only a Station Officer may submit monthly digital station returns.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const { station_id, return_month, headcount_reported, present_count, absent_count, on_leave_count, remarks } =
      req.body as Record<string, unknown>;

    if (!isNonEmptyString(station_id, 40) || !isNonEmptyString(return_month, 12)) {
      res.status(400).json({ error: 'Station and return month are required.' });
      return;
    }

    if (actor.assigned_station_id !== station_id.trim()) {
      res.status(403).json({
        error: 'Station Officer restriction: You may only submit monthly returns for your own assigned station.',
      });
      return;
    }

    const station = db.prepare('SELECT id, name FROM stations WHERE id = ?').get(station_id.trim()) as
      | { id: string; name: string }
      | undefined;
    if (!station) {
      res.status(404).json({ error: 'Station not found.' });
      return;
    }

    const h = Number(headcount_reported ?? 0);
    const p = Number(present_count ?? 0);
    const a = Number(absent_count ?? 0);
    const l = Number(on_leave_count ?? 0);
    if ([h, p, a, l].some((n) => Number.isNaN(n) || n < 0)) {
      res.status(400).json({ error: 'Headcount figures must be non-negative numbers.' });
      return;
    }

    const id = `RET-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    const safeRemarks = isNonEmptyString(remarks, 400) ? remarks.trim() : 'Monthly digital station return submitted.';

    db.prepare(`
      INSERT INTO station_returns (
        id, station_id, return_month, headcount_reported, present_count,
        absent_count, on_leave_count, remarks, submitted_by, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, station.id, return_month.trim(), h, p, a, l, safeRemarks, actor.full_name, now);

    db.prepare('UPDATE stations SET last_return_month = ? WHERE id = ?').run(return_month.trim(), station.id);

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'SUBMIT_STATION_RETURN',
      target_type: 'station',
      target_id: station.id,
      summary: `Submitted ${return_month.trim()} monthly return for ${station.name} (Reported: ${h}, Present: ${p}, Absent: ${a}, Leave: ${l}).`,
    });

    res.status(201).json({ id });
  }
);

// Workstation Verification (Step 2: Verify)
app.get('/api/verifications', requireAuth, (_req, res) => {
  const verifications = db
    .prepare(`
      SELECT v.*, e.full_name AS employee_name, s.name AS station_name
      FROM verifications v
      JOIN employees e ON e.staff_id = v.staff_id
      JOIN stations s ON s.id = v.station_id
      ORDER BY v.verified_at DESC
    `)
    .all();
  res.json({ verifications });
});

app.post(
  '/api/verifications',
  requireAuth,
  requireRoles(
    ['district_verifier'],
    'Only authorized District Verifiers may record physical or digital workstation verifications.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const { staff_id, method, outcome, evidence_note } = req.body as Record<string, unknown>;

    if (!isNonEmptyString(staff_id, 40) || !isNonEmptyString(method, 60) || !isNonEmptyString(outcome, 60)) {
      res.status(400).json({ error: 'Staff ID, verification method, and outcome are required.' });
      return;
    }

    const emp = db
      .prepare(`
        SELECT e.*, s.name AS station_name, s.district
        FROM employees e
        JOIN stations s ON s.id = e.station_id
        WHERE e.staff_id = ?
      `)
      .get(staff_id.trim()) as
      | {
          staff_id: string;
          full_name: string;
          station_id: string;
          station_name: string;
          district: string;
          gross_pay: number;
        }
      | undefined;

    if (!emp) {
      res.status(404).json({ error: 'Employee record not found.' });
      return;
    }

    const id = `VER-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const now = new Date().toISOString();
    const note = isNonEmptyString(evidence_note, 400)
      ? evidence_note.trim()
      : 'Scheduled district workstation verification completed.';

    db.prepare(`
      INSERT INTO verifications (
        id, staff_id, station_id, method, outcome, evidence_note,
        verified_by_user_id, verified_by_name, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, emp.staff_id, emp.station_id, method.trim(), outcome.trim(), note, actor.id, actor.full_name, now);

    db.prepare(`
      UPDATE employees
      SET last_verified_at = ?, last_verification_outcome = ?, updated_at = ?
      WHERE staff_id = ?
    `).run(now, outcome.trim(), now, emp.staff_id);

    // If Unaccounted or Transferred mismatch, open a Due-Process Case (salary remains protected!)
    let openedCaseNumber: string | null = null;
    if (outcome.trim() === 'Unaccounted at Station' || outcome.trim() === 'Transferred - Pending Update') {
      const existing = db
        .prepare(
          `SELECT id FROM exception_cases WHERE staff_id = ? AND rule_code = 'station_match' AND status IN ('Open', 'Under Investigation')`
        )
        .get(emp.staff_id);
      if (!existing) {
        const cnt = db.prepare('SELECT COUNT(*) as cnt FROM exception_cases').get() as { cnt: number };
        openedCaseNumber = `OPMS-2026-${String(cnt.cnt + 1).padStart(4, '0')}`;
        const caseId = `CASE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const deadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        const reviewer = db
          .prepare(`SELECT id, full_name FROM users WHERE role = 'case_reviewer' AND is_active = 1 LIMIT 1`)
          .get() as { id: string; full_name: string } | undefined;

        db.prepare(`
          INSERT INTO exception_cases (
            id, case_number, rule_code, rule_label, severity,
            staff_id, employee_name, station_id, station_name, district,
            description, financial_exposure, salary_protected, status,
            raised_by_user_id, raised_by_name, assigned_reviewer_id, assigned_reviewer_name,
            resolution_deadline, created_at
          ) VALUES (?, ?, 'station_match', 'Station & Approved Post Verification', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'Open', ?, ?, ?, ?, ?, ?)
        `).run(
          caseId,
          openedCaseNumber,
          outcome.trim() === 'Unaccounted at Station' ? 'Critical' : 'High',
          emp.staff_id,
          emp.full_name,
          emp.station_id,
          emp.station_name,
          emp.district,
          `Verification outcome "${outcome.trim()}" logged by ${actor.full_name}: ${note}`,
          emp.gross_pay,
          actor.id,
          actor.full_name,
          reviewer?.id ?? 'USR-REV-01',
          reviewer?.full_name ?? 'Mutale Banda',
          deadline,
          now
        );
      }
    }

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'RECORD_VERIFICATION',
      target_type: 'employee',
      target_id: emp.staff_id,
      summary: `Verified ${emp.full_name} (${emp.staff_id}) at ${emp.station_name}: ${outcome.trim()}.${
        openedCaseNumber ? ` Opened due-process case ${openedCaseNumber}.` : ''
      }`,
    });

    res.status(201).json({ id, opened_case_number: openedCaseNumber });
  }
);

// Validation & PMEC Reconciliation (Step 3: Validate)
app.get('/api/reconciliation', requireAuth, (_req, res) => {
  const items = computeReconciliation();
  const pmecRows = db.prepare('SELECT * FROM pmec_extracts ORDER BY staff_id').all();
  res.json({ items, pmec_extract_count: pmecRows.length });
});

app.post(
  '/api/validation/run',
  requireAuth,
  requireRoles(
    ['district_verifier', 'case_reviewer', 'payroll_officer', 'system_admin'],
    'Auditors have read-only access; Station Officers submit returns rather than executing national validation runs.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const summary = runAutomatedValidationCycle({
      id: actor.id,
      full_name: actor.full_name,
      role: actor.role,
    });
    res.json(summary);
  }
);

// Exception Cases & Due-Process Review (Step 4: Review)
app.get('/api/cases', requireAuth, (_req, res) => {
  const cases = db
    .prepare('SELECT * FROM exception_cases ORDER BY CASE status WHEN \'Open\' THEN 1 WHEN \'Under Investigation\' THEN 2 WHEN \'Resolved\' THEN 3 ELSE 4 END, resolution_deadline ASC')
    .all();
  res.json({ cases });
});

app.patch(
  '/api/cases/:id/resolve',
  requireAuth,
  requireRoles(
    ['case_reviewer'],
    'Only designated Case Reviewers may investigate and record resolutions on flagged exception cases (separation of duties).'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const caseId = req.params.id;
    const { resolution_decision, resolution_notes, evidence_ref } = req.body as Record<string, unknown>;

    if (!isNonEmptyString(resolution_decision, 100) || !isNonEmptyString(resolution_notes, 600)) {
      res.status(400).json({ error: 'Resolution decision and investigation notes are required.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM exception_cases WHERE id = ?').get(caseId) as
      | {
          id: string;
          case_number: string;
          staff_id: string;
          employee_name: string;
          status: string;
          raised_by_user_id: string;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Exception case not found.' });
      return;
    }

    if (existing.raised_by_user_id === actor.id) {
      res.status(403).json({
        error: 'Separation of duties violation: You cannot resolve or approve a case that you raised yourself.',
      });
      return;
    }

    if (existing.status === 'Applied to Payroll') {
      res.status(409).json({ error: 'This case has already been applied to payroll.' });
      return;
    }

    const now = new Date().toISOString();
    const safeEvidence = isNonEmptyString(evidence_ref, 120) ? evidence_ref.trim() : 'DOC-VERIFIED-FILE';

    db.prepare(`
      UPDATE exception_cases
      SET status = 'Resolved',
          resolution_decision = ?,
          resolution_notes = ?,
          evidence_ref = ?,
          resolved_by_user_id = ?,
          resolved_by_name = ?,
          resolved_at = ?
      WHERE id = ?
    `).run(
      resolution_decision.trim(),
      resolution_notes.trim(),
      safeEvidence,
      actor.id,
      actor.full_name,
      now,
      existing.id
    );

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'RESOLVE_CASE',
      target_type: 'exception_case',
      target_id: existing.case_number,
      summary: `Recorded resolution "${resolution_decision.trim()}" for ${existing.case_number} (${existing.employee_name} / ${existing.staff_id}) with evidence ref ${safeEvidence}.`,
    });

    res.json({ ok: true, case_number: existing.case_number });
  }
);

// Apply Approved Case Resolution to Payroll (Payroll Officer ONLY, Approved Cases ONLY)
app.post(
  '/api/cases/:id/apply-payroll',
  requireAuth,
  requireRoles(
    ['payroll_officer'],
    'Only a Payroll Officer may apply approved case resolutions to payroll records.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const caseId = req.params.id;
    const existing = db.prepare('SELECT * FROM exception_cases WHERE id = ?').get(caseId) as
      | {
          id: string;
          case_number: string;
          rule_code: string;
          staff_id: string;
          employee_name: string;
          status: string;
          resolution_decision: string | null;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Exception case not found.' });
      return;
    }

    if (existing.status !== 'Resolved') {
      res.status(403).json({
        error: 'Due-process control: Payroll Officers may only apply changes from cases formally resolved by a Case Reviewer.',
      });
      return;
    }

    const now = new Date().toISOString();
    const emp = db.prepare('SELECT * FROM employees WHERE staff_id = ?').get(existing.staff_id) as
      | {
          staff_id: string;
          full_name: string;
          station_id: string;
          post_id: string;
          gross_pay: number;
          net_pay: number;
          payroll_placed: number;
        }
      | undefined;

    let actionSummary = `Applied approved resolution (${existing.resolution_decision}) for ${existing.case_number}`;

    if (emp) {
      if (
        existing.rule_code === 'placement_ageing' ||
        existing.resolution_decision === 'Approved Placement'
      ) {
        const station = db
          .prepare('SELECT code FROM stations WHERE id = ?')
          .get(emp.station_id) as { code: string } | undefined;
        const post = db
          .prepare('SELECT post_code FROM approved_posts WHERE id = ?')
          .get(emp.post_id) as { post_code: string } | undefined;

        db.prepare(`
          UPDATE employees
          SET payroll_placed = 1, employment_status = 'Active', updated_at = ?
          WHERE staff_id = ?
        `).run(now, emp.staff_id);

        const pmecExists = db
          .prepare('SELECT id FROM pmec_extracts WHERE staff_id = ?')
          .get(emp.staff_id);
        if (!pmecExists) {
          db.prepare(`
            INSERT INTO pmec_extracts (id, pay_period, staff_id, full_name, pmec_station_code, pmec_post_code, pmec_gross_pay, pmec_net_pay, pmec_status)
            VALUES (?, '2026-11', ?, ?, ?, ?, ?, ?, 'Paid')
          `).run(
            `PMEC-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
            emp.staff_id,
            emp.full_name,
            station?.code ?? 'MOE-CHB-101',
            post?.post_code ?? 'EST-CHB-0105',
            emp.gross_pay,
            emp.net_pay
          );
        }
        actionSummary = `Placed verified recruit ${emp.full_name} (${emp.staff_id}) onto active PMEC payroll via approved case ${existing.case_number}.`;
      } else if (
        existing.rule_code === 'net_pay_threshold' &&
        existing.resolution_decision === 'Confirmed Discrepancy - Apply Adjustment'
      ) {
        const adjustedNet = Math.round(emp.gross_pay * 0.45);
        db.prepare('UPDATE employees SET net_pay = ?, updated_at = ? WHERE staff_id = ?').run(
          adjustedNet,
          now,
          emp.staff_id
        );
        db.prepare('UPDATE pmec_extracts SET pmec_net_pay = ? WHERE staff_id = ?').run(
          adjustedNet,
          emp.staff_id
        );
        actionSummary = `Adjusted net take-home pay to K${adjustedNet.toLocaleString()} (>= 40% statutory floor) for ${emp.staff_id} under ${existing.case_number}.`;
      } else if (
        existing.rule_code === 'station_match' &&
        existing.resolution_decision === 'Confirmed Discrepancy - Apply Adjustment'
      ) {
        const station = db
          .prepare('SELECT code FROM stations WHERE id = ?')
          .get(emp.station_id) as { code: string } | undefined;
        if (station) {
          db.prepare('UPDATE pmec_extracts SET pmec_station_code = ? WHERE staff_id = ?').run(
            station.code,
            emp.staff_id
          );
        }
        db.prepare(`
          UPDATE employees
          SET last_verified_at = ?, last_verification_outcome = 'Present & Verified', absence_months = 0, employment_status = 'Active', updated_at = ?
          WHERE staff_id = ?
        `).run(now, now, emp.staff_id);
        actionSummary = `Synchronized PMEC station code and verification status for ${emp.staff_id} per approved case ${existing.case_number}.`;
      } else if (existing.resolution_decision === 'Cleared - Leave or Transfer Updated') {
        db.prepare(`
          UPDATE employees
          SET last_verified_at = ?, last_verification_outcome = 'Approved Leave / Study', updated_at = ?
          WHERE staff_id = ?
        `).run(now, now, emp.staff_id);
      } else if (existing.resolution_decision === 'Cleared - Verified Present') {
        db.prepare(`
          UPDATE employees
          SET last_verified_at = ?, last_verification_outcome = 'Present & Verified', absence_months = 0, employment_status = 'Active', updated_at = ?
          WHERE staff_id = ?
        `).run(now, now, emp.staff_id);
      }
    }

    db.prepare(`
      UPDATE exception_cases
      SET status = 'Applied to Payroll',
          payroll_applied_by = ?,
          payroll_applied_at = ?
      WHERE id = ?
    `).run(actor.full_name, now, existing.id);

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'APPLY_PAYROLL_ACTION',
      target_type: 'exception_case',
      target_id: existing.case_number,
      summary: actionSummary,
    });

    res.json({ ok: true, summary: actionSummary });
  }
);

// Immutable Audit Trail & Cryptographic Chain Verification
app.get('/api/audit', requireAuth, (_req, res) => {
  const logs = db
    .prepare('SELECT * FROM audit_logs ORDER BY seq DESC LIMIT 200')
    .all();
  const verification = verifyAuditChain();
  res.json({ logs, verification });
});

app.get('/api/audit/verify', requireAuth, (req: AuthenticatedRequest, res) => {
  const verification = verifyAuditChain();
  res.json({
    ...verification,
    verified_by: req.user?.full_name ?? 'System',
    verified_at: new Date().toISOString(),
  });
});

// User Accounts & RBAC Management (System Administrator ONLY for mutations)
app.get('/api/users', requireAuth, (_req, res) => {
  const users = db
    .prepare(`
      SELECT u.*, s.name AS assigned_station_name
      FROM users u
      LEFT JOIN stations s ON s.id = u.assigned_station_id
      ORDER BY u.created_at ASC
    `)
    .all();
  res.json({ users });
});

app.patch(
  '/api/users/:id',
  requireAuth,
  requireRoles(
    ['system_admin'],
    'Only the System Administrator may manage user accounts and RBAC role assignments.'
  ),
  (req: AuthenticatedRequest, res) => {
    const actor = req.user!;
    const targetId = req.params.id;
    const { role, is_active } = req.body as { role?: unknown; is_active?: unknown };

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId) as
      | UserAccount
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const validRoles: UserRole[] = [
      'station_officer',
      'district_verifier',
      'case_reviewer',
      'payroll_officer',
      'auditor',
      'system_admin',
    ];
    const nextRole =
      typeof role === 'string' && validRoles.includes(role as UserRole)
        ? (role as UserRole)
        : target.role;
    const nextActive = typeof is_active === 'number' ? (is_active === 1 ? 1 : 0) : target.is_active;

    if (target.id === actor.id && nextActive === 0) {
      res.status(400).json({ error: 'Cannot deactivate your own active administrator account.' });
      return;
    }

    db.prepare('UPDATE users SET role = ?, is_active = ? WHERE id = ?').run(
      nextRole,
      nextActive,
      target.id
    );

    appendAuditLog({
      actor_user_id: actor.id,
      actor_name: actor.full_name,
      actor_role: actor.role,
      action: 'UPDATE_USER_RBAC',
      target_type: 'user',
      target_id: target.id,
      summary: `Updated account ${target.full_name}: role=${nextRole}, active=${nextActive === 1 ? 'Yes' : 'No'}.`,
    });

    res.json({ ok: true });
  }
);

async function startServer(): Promise<void> {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`One Payroll Management System running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
