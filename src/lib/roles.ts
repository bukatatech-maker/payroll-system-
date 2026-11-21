import type { UserRole } from '../types/payroll.ts';

export interface RoleDefinition {
  role: UserRole;
  label: string;
  permissions: string;
  restriction: string;
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    role: 'station_officer',
    label: 'Station Officer',
    permissions: 'Enters and updates station returns and staff status.',
    restriction: 'Own station only',
  },
  {
    role: 'district_verifier',
    label: 'District Verifier',
    permissions: 'Records physical and digital verification results and evidence.',
    restriction: 'Cannot approve own cases',
  },
  {
    role: 'case_reviewer',
    label: 'Case Reviewer',
    permissions: 'Investigates flagged cases and records formal resolution.',
    restriction: 'Cannot change pay data',
  },
  {
    role: 'payroll_officer',
    label: 'Payroll Officer',
    permissions: 'Applies approved changes to payroll records and places verified recruits.',
    restriction: 'Approved cases only',
  },
  {
    role: 'auditor',
    label: 'Auditor',
    permissions: 'Reads records, cases, reconciliation outputs, and audit trail.',
    restriction: 'Read-only access',
  },
  {
    role: 'system_admin',
    label: 'System Administrator',
    permissions: 'Manages user accounts and role assignments.',
    restriction: 'No approval of payroll changes',
  },
];

export function getRoleDefinition(role: UserRole): RoleDefinition {
  return (
    ROLE_DEFINITIONS.find((r) => r.role === role) ?? {
      role,
      label: role,
      permissions: '',
      restriction: '',
    }
  );
}

export function formatZmw(amount: number): string {
  return `K${Math.round(amount).toLocaleString('en-US')}`;
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return 'Not recorded';
  return iso.slice(0, 10);
}
