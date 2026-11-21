import { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.ts';
import { getRoleDefinition, ROLE_DEFINITIONS } from '../lib/roles.ts';
import type { AuditLogEntry, UserAccount, UserRole } from '../types/payroll.ts';

interface AuditSecurityViewProps {
  logs: AuditLogEntry[];
  verification: {
    valid: boolean;
    total_entries: number;
    verified_entries: number;
    broken_seq: number | null;
    head_hash: string;
  } | null;
  users: UserAccount[];
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function AuditSecurityView({
  logs,
  verification,
  users,
  onRefresh,
  onNotify,
}: AuditSecurityViewProps) {
  const [verifying, setVerifying] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  async function handleVerifyChain() {
    setVerifying(true);
    try {
      const res = await api.verifyAuditChain();
      await onRefresh();
      if (res.valid) {
        onNotify(
          'success',
          `Cryptographic SHA-256 chain verified: ${res.verified_entries} of ${res.total_entries} audit entries intact.`
        );
      } else {
        onNotify('error', `Tampering detected at sequence #${res.broken_seq}!`);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Chain verification failed.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleRoleChange(userId: string, nextRole: UserRole) {
    setUpdatingUserId(userId);
    try {
      await api.updateUser(userId, { role: nextRole });
      await onRefresh();
      onNotify('success', `Updated user role assignment to ${getRoleDefinition(nextRole).label}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Unable to update user role.');
    } finally {
      setUpdatingUserId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Cryptographic Audit Chain Verification Header */}
      <div className="flex flex-col justify-between gap-4 rounded-lg border border-slate-200 bg-white px-6 py-5 lg:flex-row lg:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <Lock className="h-4 w-4 shrink-0" />
            <span>
              Tamper-Evident SHA-256 Audit Chain ·{' '}
              {verification?.valid ? 'Chain Integrity Verified' : 'Integrity Alert'}
            </span>
          </div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            Immutable Audit Trail &amp; Separation-of-Duties Matrix
          </h2>
          <p className="text-xs text-slate-600">
            Every record view, verification, validation run, case resolution, and payroll change is cryptographically linked to the prior entry ({verification?.total_entries ?? logs.length} entries recorded).
          </p>
          {verification && (
            <div className="pt-1 font-mono text-xs text-slate-500">
              Head Hash: <span className="text-slate-800">{verification.head_hash.slice(0, 32)}...</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleVerifyChain}
          disabled={verifying}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <ShieldCheck className="h-4 w-4" />
          <span>{verifying ? 'Verifying...' : 'Verify SHA-256 Chain Integrity'}</span>
        </button>
      </div>

      {/* Immutable Audit Trail Table */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Append-Only Audit Log (Latest {logs.length} Entries)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-6 py-3 font-medium">Seq / Timestamp</th>
                <th className="px-4 py-3 font-medium">Actor &amp; Role</th>
                <th className="px-4 py-3 font-medium">Action &amp; Target</th>
                <th className="px-4 py-3 font-medium">Audit Summary</th>
                <th className="px-6 py-3 text-right font-medium">Entry SHA-256</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3.5 align-top font-mono tabular-nums">
                    <div className="font-semibold text-slate-900">#{log.seq}</div>
                    <div className="text-slate-500">{log.timestamp.replace('T', ' ').slice(0, 19)}</div>
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <div className="font-medium text-slate-900">{log.actor_name}</div>
                    <div className="text-slate-500">{getRoleDefinition(log.actor_role).label}</div>
                  </td>
                  <td className="px-4 py-3.5 align-top font-mono">
                    <div className="font-medium text-slate-800">{log.action}</div>
                    <div className="text-slate-500">
                      {log.target_type} · {log.target_id}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 align-top max-w-md text-slate-700">{log.summary}</td>
                  <td className="px-6 py-3.5 align-top text-right font-mono text-slate-500">
                    {log.entry_hash.slice(0, 14)}...
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* RBAC Governance Matrix & User Accounts (Table 3.2) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Role-Based Access Control Matrix (Table 3.2)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Least-privilege permissions enforced on every server API route.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Main Permissions</th>
                  <th className="px-6 py-3 font-medium">Key Restriction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {ROLE_DEFINITIONS.map((r) => (
                  <tr key={r.role} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-900">{r.label}</td>
                    <td className="px-4 py-3 text-slate-600">{r.permissions}</td>
                    <td className="px-6 py-3 font-medium text-amber-700">{r.restriction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Active Officer Accounts
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Only the System Administrator may modify role assignments; administrators cannot approve payroll changes.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-6 py-3 font-medium">Officer</th>
                  <th className="px-4 py-3 font-medium">Jurisdiction</th>
                  <th className="px-6 py-3 font-medium">Assigned Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3">
                      <div className="font-medium text-slate-900">{u.full_name}</div>
                      <div className="font-mono text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {u.assigned_station_name ?? u.district}
                    </td>
                    <td className="px-6 py-3">
                      <select
                        value={u.role}
                        disabled={updatingUserId === u.id}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                        aria-label={`Role for ${u.full_name}`}
                        className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
                      >
                        {ROLE_DEFINITIONS.map((r) => (
                          <option key={r.role} value={r.role}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
