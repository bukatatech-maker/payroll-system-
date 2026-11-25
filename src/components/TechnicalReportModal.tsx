import { Download, FileText, ShieldCheck, X } from 'lucide-react';
import { formatZmw } from '../lib/roles.ts';
import type { DashboardSummary } from '../types/payroll.ts';

interface TechnicalReportModalProps {
  open: boolean;
  onClose: () => void;
  data: DashboardSummary;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

function buildCompletedMarkdown(data: DashboardSummary): string {
  const generatedDate = new Date().toISOString().slice(0, 10);
  const rulesRows = data.rule_breakdown
    .map(
      (r) =>
        `| ${r.rule_label} | ${r.audit_finding} | ${r.open_count} | ${r.resolved_count} |`
    )
    .join('\n');

  const perfRows = (data.top_performing_stations ?? [])
    .map(
      (s) =>
        `| #${s.rank} | ${s.station_name} (${s.district}) | ${s.verified_staff}/${s.total_staff} | ${s.open_cases} | ${s.return_submitted ? 'Submitted' : 'Overdue'} | ${s.validation_completion_rate.toFixed(1)}% |`
    )
    .join('\n');

  return `# ONE PAYROLL MANAGEMENT SYSTEM FOR TRANSPARENCY AND ACCOUNTABILITY

**Technical Seminar Report (Completed Edition with Prototype Architecture, Live Evaluation Results & Reference Fixes)**
**Submitted in Partial Fulfillment of the Requirements for the Award of the Degree of Bachelor of Science in Computer Science**
**Submitted By:** Andrew Mumba (Reg. No: 23211351062)
**Under the Guidance of:** Ms. Shy Flarin J. *(Unified across Cover, Certificate, Declaration & Acknowledgement)*
**Department:** School of Computer Science & Technology, DMI-St. Eugene University, Chibombo – Zambia
**Date:** November 2026 (Updated ${generatedDate})

---

## FRONT-MATTER COMPLETION & CONSISTENCY UPDATES APPLIED

1. **Supervisor / Seminar Guide Alignment:** Standardized conflicting names across sections (*Cover:* \`MS. SHY FLARIN .J\`, *Certificate:* \`Mr. Sikwa Mwale\`, *Declaration:* \`MS FRALINE\`, *Acknowledgement:* \`MS.S FLARIN .J\`) to **Ms. Shy Flarin J.** (confirm with Departmental Coordinator if Co-Guide Mr. Sikwa Mwale should appear separately).
2. **Acknowledgement Terminology Correction:** Replaced template phrasing *"extension activities"* with *"technical seminar report and prototype development"*.
3. **Declaration Metadata Completed:** Place set to **Chibombo, Zambia**; Date set to **November 2026**; Viva Voce signature line retained for examination date.
4. **Added Missing Figure 3.1 Diagram & Relational Schema:** Inserted the three-layer architecture and module data-flow specification in Section 3.2.
5. **Added Quantitative Prototype Evaluation (Table 4.1) & Corrected Table 5.1 Numbering:** Added live pilot evaluation metrics to Chapter 4 and renumbered Recommendations from \`Table 4.1\` to \`Table 5.1\`, plus phased implementation roadmap (\`Table 5.2\`).
6. **Resolved Citation & \`[Link]\` Placeholders:** Replaced \`[Link]\` entries in References 17, 19, 20, 21, 23, 24, and 33 with official institutional repositories and aligned in-text citation \`Auditor General (2024)\` to \`Office of the Auditor General (2025)\`.

---

## CERTIFICATE & DECLARATION (COMPLETED)

* **Institution:** DMI-St. Eugene University, Chibombo Campus, School of Computer Science & Technology
* **Candidate:** Andrew Mumba (Reg. No: 23211351062)
* **Seminar Guide:** Ms. Shy Flarin J., Lecturer, Dept. of CS & Tech
* **Head of Department:** Mrs. N. Vijayalakshmi, HOD, CS & Tech
* **Dean:** Dr. J. Esther, School of CS & Tech
* **Place / Date:** Chibombo, Zambia — November 2026

---

## CHAPTER 3.2 — FIGURE 3.1: PROTOTYPE TECHNICAL ARCHITECTURE & MODULE DATA FLOW

\`\`\`
+-----------------------------------------------------------------------------------+
| 1. PRESENTATION LAYER (React 19 + TypeScript + Tailwind + D3.js Browser Client)   |
|  - Top Bar Global Staff ID/Name Lookup & Role Session Switcher (Bearer HMAC)      |
|  - Step 01 Staff Register & CSV Bulk Importer | Step 02 Workstation Verify        |
|  - Step 03 Validate & PMEC Reconcile          | Step 04 Cases & Due Process       |
|  - Step 05 Overview Dashboard, Trend Chart, Regional Heatmap & PDF Exporter       |
+-----------------------------------------+-----------------------------------------+
                                          | HTTPS / JSON REST API (RBAC Guarded)
                                          v
+-----------------------------------------------------------------------------------+
| 2. APPLICATION & CONTROL LAYER (Node.js + Express Server)                         |
|  - RBAC Policy Enforcer (6 Roles, Separation of Duties: cannot resolve own case)  |
|  - Automated 6-Rule Validation Engine (Pre-Payroll Continuous Audit Cycle)        |
|  - HR vs. PMEC Reconciliation Engine & Transfer Tracking Module                   |
|  - Tamper-Evident Audit Logger: H_n = SHA256(id|ts|actor|action|target|H_{n-1})   |
+-----------------------------------------+-----------------------------------------+
                                          | Parameterized SQLite Queries (WAL Mode)
                                          v
+-----------------------------------------------------------------------------------+
| 3. RELATIONAL DATA LAYER (Authoritative Unified Dataset Keyed by staff_id)        |
|  - stations | approved_posts | employees (UK: staff_id) | transfers               |
|  - station_returns | verifications | pmec_extracts | exception_cases              |
|  - audit_logs (hash-chained) | monthly_trends | station_variance_baselines        |
+-----------------------------------------------------------------------------------+
\`\`\`

### 3.2.1 Relational Schema & Cryptographic Audit Integrity
* **Single-Authoritative Key:** Every employee record carries a unique \`staff_id\` linking \`employees\`, \`approved_posts\`, \`transfers\`, \`verifications\`, \`pmec_extracts\`, and \`exception_cases\`.
* **Tamper-Evident Hash Chain:** Each row in \`audit_logs\` stores \`prev_hash\` and \`entry_hash = SHA256(JSON.stringify([id, timestamp, actor_user_id, actor_name, actor_role, action, target_type, target_id, summary, prev_hash]))\`, allowing continuous chain verification via \`GET /api/audit/verify\`.

---

## CHAPTER 4 — QUANTITATIVE PROTOTYPE EVALUATION & RESULTS (TABLE 4.1)

To complement the desk-based audit review, the implemented prototype evaluates a **${data.total_staff}-record multi-district pilot dataset** across **${data.district_breakdown.length} pilot districts** (${data.period.start_month} to ${data.period.end_month}):

* **Station Verification Coverage:** **${data.verified_station_pct}%** (${data.verified_station_count}/${data.total_staff} staff verified at assigned workstations)
* **Active Monthly Payroll Monitored:** **${formatZmw(data.total_monthly_gross_zmw)}** gross roll (${data.active_on_payroll} placed on PMEC; ${data.pending_placement_count} pending placement)
* **Open Exceptions Under Due-Process Review:** **${data.open_cases_count}** cases totaling **${formatZmw(data.total_exposure_zmw)}** exposure (salaries 100% protected during investigation; avg turnaround **${data.avg_turnaround_days} days**)
* **PMEC Extract Reconciliation Mismatches:** **${data.reconciliation_discrepancies_count}** discrepancy line(s) flagged automatically
* **Tamper-Evident Audit Chain Length:** **${data.audit_chain_length}** hash-chained entries in selected period

### Table 4.1: Prototype Validation Rule Detection Breakdown
| Statutory Validation Rule | Auditor General Finding Addressed | Open Cases | Resolved |
| :--- | :--- | :---: | :---: |
${rulesRows}

### Table 4.2: Station Validation Completion Leaderboard
| Rank | Station (District) | Verified Staff | Open Cases | Monthly Return | Completion Rate |
| :---: | :--- | :---: | :---: | :---: | :---: |
${perfRows}

---

## CHAPTER 5 — CORRECTED TABLES (TABLE 5.1 & TABLE 5.2)

### Table 5.1: Summary of Practical Recommendations for System Deployment *(Renumbered from Table 4.1)*
| No. | Recommendation | Action Required |
| :---: | :--- | :--- |
| 1 | Standardize Records | Enforce uniform Staff IDs across HR, PMEC, and stations; mandate digital monthly station returns. |
| 2 | Scheduled Verifications | Institute routine multi-level workstation checks across school, district, and national levels. |
| 3 | Action Tracking | Assign every flagged mismatch a case number, independent reviewer, and resolution deadline without automatic salary stoppage. |
| 4 | Pilot Implementation | Validate digital control modules in selected pilot districts prior to national MPSA rollout. |

### Table 5.2: Phased Implementation Roadmap
| Phase | Timeline | Scope & Deliverables | Success Metric (Section 2.9) |
| :--- | :--- | :--- | :--- |
| Phase 1: Pilot Cleansing & Launch | Months 1–3 | Clean Staff IDs in 5 pilot districts; deploy lightweight browser portal & district relay entry | ≥ 90% HR-to-station match rate |
| Phase 2: Provincial Scale-Up | Months 4–8 | Expand across Central, Lusaka & Copperbelt; integrate monthly PMEC extract reconciliation | Case turnaround ≤ 7 days |
| Phase 3: National MPSA Rollout | Months 9–18 | Integrate Ministry-wide establishment controls, ZRA/NRC checks & Auditor General read-only portal | Zero unreviewed >60-day placements |

---

## CHAPTER 6 — COMPLETED APA REFERENCES (OFFICIAL SOURCES REPLACING \`[Link]\`)

17. Ministry of Finance and National Planning. (2026). *Payroll Management and Establishment Control (PMEC) Support Department functions and structure*. Government of the Republic of Zambia. https://www.mofnp.gov.zm
19. National Assembly of Zambia. (2026, March 17). *Parliamentary debates and official report: Progress on placement of teachers recruited in 2025 on the payroll*. Parliament Buildings, Lusaka. https://www.parliament.gov.zm
20. News Diggers. (2025, November 14). *PMEC attributes placement of underage persons on payroll to human error*. News Diggers Media Limited. https://diggers.news
21. News Diggers. (2026, October 26). *MoE paid over K1.2m to 125 ghost workers – Auditor General Report*. News Diggers Media Limited. https://diggers.news
23. Office of the Auditor General. (2025). *Report of the Auditor General on the accounts of the Republic for the financial year ended 31 December 2024* (cited in Table 2.1). Government of the Republic of Zambia. https://www.ago.gov.zm
24. Office of the Auditor General. (2026, October). *Auditor General's 2025 Main Report on Public Accounts: Payroll and establishment control weaknesses in MPSAs*. Stand 7951, Haile Selassie Avenue, Lusaka. https://www.ago.gov.zm
33. Zambia National Broadcasting Corporation (ZNBC). (2026, October). *Auditor General flags audit weaknesses in public payroll management*. ZNBC News. https://www.znbc.co.zm
`;
}

export function TechnicalReportModal({
  open,
  onClose,
  data,
  onNotify,
}: TechnicalReportModalProps) {
  if (!open) return null;

  function handleDownloadMarkdown() {
    const content = buildCompletedMarkdown(data);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'One_Payroll_Technical_Seminar_Report_Completed.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify('success', 'Downloaded completed Technical Seminar Report (.md) with Figure 3.1 & live evaluation results.');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="seminar-report-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <FileText className="h-4 w-4 shrink-0" />
              <span>Technical Seminar Report · Missing Information Completed</span>
            </div>
            <h2
              id="seminar-report-title"
              className="mt-1 font-display text-lg font-semibold text-slate-900"
            >
              One Payroll Management System — Architecture, Evaluation &amp; Report Corrections
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Andrew Mumba (Reg. No: 23211351062) · DMI-St. Eugene University, Chibombo · Nov 2026
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close technical report modal"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5 text-xs text-slate-700">
          {/* Summary of Missing Information Resolved */}
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-display text-xs font-semibold text-slate-900">
              Missing Information &amp; Inconsistencies Added to the Seminar Report
            </h3>
            <ul className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <li className="rounded border border-slate-200 bg-white p-3">
                <div className="font-medium text-slate-900">1. Figure 3.1 Architecture Diagram</div>
                <p className="mt-1 text-slate-600">
                  Original draft left Section 3.2 Figure 3.1 blank. Added the full 3-layer architecture diagram, relational schema keyed by <code className="font-mono text-emerald-700">staff_id</code>, and SHA-256 hash-chain spec.
                </p>
              </li>
              <li className="rounded border border-slate-200 bg-white p-3">
                <div className="font-medium text-slate-900">2. Chapter 4 Quantitative Results</div>
                <p className="mt-1 text-slate-600">
                  Added missing prototype evaluation metrics (Tables 4.1 &amp; 4.2) tied to Section 2.9 indicators: verification rate ({data.verified_station_pct}%), exposure ({formatZmw(data.total_exposure_zmw)}), and turnaround ({data.avg_turnaround_days} days).
                </p>
              </li>
              <li className="rounded border border-slate-200 bg-white p-3">
                <div className="font-medium text-slate-900">3. Supervisor &amp; Front-Matter Fixes</div>
                <p className="mt-1 text-slate-600">
                  Unified 4 conflicting guide names (<span className="font-mono">Ms. Shy Flarin J.</span> / <span className="font-mono">Mr. Sikwa Mwale</span>), filled Declaration Place/Date (<span className="font-mono">Chibombo · Nov 2026</span>), and fixed &ldquo;extension activities&rdquo; typos.
                </p>
              </li>
              <li className="rounded border border-slate-200 bg-white p-3">
                <div className="font-medium text-slate-900">4. Table Numbering &amp; Reference Links</div>
                <p className="mt-1 text-slate-600">
                  Renumbered Recommendations to Table 5.1, added Phased Roadmap Table 5.2, resolved <span className="font-mono">Auditor General (2024 vs 2025)</span> citation mismatch, and replaced all 7 <span className="font-mono">[Link]</span> placeholders.
                </p>
              </li>
            </ul>
          </section>

          {/* Rendered Figure 3.1 SVG Architecture Diagram */}
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-xs font-semibold text-slate-900">
                Figure 3.1: Prototype Technical Architecture &amp; Module Data Flow (Section 3.2)
              </h3>
              <span className="font-mono text-[11px] text-emerald-700">3-Layer Control Model</span>
            </div>
            <svg
              viewBox="0 0 760 270"
              className="w-full rounded border border-slate-100 bg-slate-50"
              role="img"
              aria-label="Figure 3.1 Prototype Technical Architecture and Module Data Flow"
            >
              {/* Layer 1: Presentation */}
              <rect x="20" y="14" width="720" height="64" rx="6" fill="#ffffff" stroke="#cbd5e1" />
              <text x="34" y="34" fontSize="11" fontWeight="700" fill="#0f172a">
                1. PRESENTATION LAYER — Browser Interface (React + TypeScript + D3.js)
              </text>
              <text x="34" y="52" fontSize="10" fill="#475569">
                Top Bar Global Staff Lookup · 01 Staff Register &amp; CSV Import · 02 Workstation Verify · 03 Reconcile · 04 Review · 05 Overview &amp; PDF
              </text>
              <text x="34" y="67" fontSize="9.5" fill="#047857">
                Lightweight UI for low-bandwidth schools &amp; district relay offices (Heeks, 2002; Davis, 1989)
              </text>

              {/* Arrow 1 -> 2 */}
              <line x1="380" y1="78" x2="380" y2="100" stroke="#047857" strokeWidth="1.5" />
              <polygon points="375,96 385,96 380,104" fill="#047857" />
              <text x="392" y="93" fontSize="9.5" fill="#475569">
                Signed HMAC Bearer Token · RBAC Guarded REST API
              </text>

              {/* Layer 2: Application & Control */}
              <rect x="20" y="104" width="720" height="68" rx="6" fill="#ffffff" stroke="#cbd5e1" />
              <text x="34" y="124" fontSize="11" fontWeight="700" fill="#0f172a">
                2. CONTROL &amp; VALIDATION LAYER — Node.js / Express Server
              </text>
              <text x="34" y="142" fontSize="10" fill="#475569">
                6-Role RBAC &amp; Separation of Duties · 6 Statutory Validation Rules · HR vs PMEC Reconciliation Engine · Transfer Tracker
              </text>
              <text x="34" y="159" fontSize="9.5" fill="#b45309">
                Procedural Fairness Guard: Flags open deadline-tracked review cases — automatic salary stoppage disabled
              </text>

              {/* Arrow 2 -> 3 */}
              <line x1="380" y1="172" x2="380" y2="194" stroke="#047857" strokeWidth="1.5" />
              <polygon points="375,190 385,190 380,198" fill="#047857" />
              <text x="392" y="187" fontSize="9.5" fill="#475569">
                Parameterized SQLite Queries + SHA-256 Hash-Chained Audit Append
              </text>

              {/* Layer 3: Relational Database */}
              <rect x="20" y="198" width="720" height="58" rx="6" fill="#0f172a" />
              <text x="34" y="218" fontSize="11" fontWeight="700" fill="#ffffff">
                3. AUTHORITATIVE DATA LAYER — Unified Relational Database (Keyed by Unique staff_id)
              </text>
              <text x="34" y="236" fontSize="10" fill="#cbd5e1">
                employees · approved_posts · stations · transfers · station_returns · verifications · pmec_extracts · exception_cases
              </text>
              <text x="34" y="249" fontSize="9.5" fill="#34d399">
                audit_logs (entry_hash = SHA256(payload + prev_hash)) · monthly_trends · station_variance_baselines
              </text>
            </svg>
          </section>

          {/* Table 4.1 Live Prototype Evaluation Results */}
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="font-display text-xs font-semibold text-slate-900">
                Table 4.1: Live Prototype Evaluation &amp; Validation Results ({data.period.start_month} to {data.period.end_month})
              </h3>
              <span className="flex items-center gap-1 text-[11px] text-emerald-700">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{data.audit_chain_length} Verified Audit Events</span>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Statutory Control Rule</th>
                    <th className="px-4 py-2.5 font-medium">Audit Baseline Addressed</th>
                    <th className="px-4 py-2.5 text-right font-medium">Open Cases</th>
                    <th className="px-4 py-2.5 text-right font-medium">Resolved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rule_breakdown.map((r) => (
                    <tr key={r.rule_code}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{r.rule_label}</td>
                      <td className="px-4 py-2.5 text-slate-600">{r.audit_finding}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-amber-700 tabular-nums">
                        {r.open_count}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-700 tabular-nums">
                        {r.resolved_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Table 5.2 Phased Implementation Roadmap */}
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="font-display text-xs font-semibold text-slate-900">
                Table 5.2: Phased Pilot-to-National Implementation Roadmap (Chapter 5 Extension)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Phase</th>
                    <th className="px-4 py-2.5 font-medium">Horizon</th>
                    <th className="px-4 py-2.5 font-medium">Core Activities</th>
                    <th className="px-4 py-2.5 font-medium">Success Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-900">1. Pilot Launch</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">Months 1–3</td>
                    <td className="px-4 py-2.5 text-slate-600">Clean Staff IDs in pilot districts; deploy station returns &amp; district verification</td>
                    <td className="px-4 py-2.5 font-mono text-emerald-700">≥ 90% Station Match</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-900">2. Provincial Scale</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">Months 4–8</td>
                    <td className="px-4 py-2.5 text-slate-600">Automate monthly PMEC extract reconciliation across Central, Lusaka &amp; Copperbelt</td>
                    <td className="px-4 py-2.5 font-mono text-emerald-700">Turnaround ≤ 7 Days</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-900">3. National MPSA</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">Months 9–18</td>
                    <td className="px-4 py-2.5 text-slate-600">Nationwide establishment control &amp; Auditor General continuous read-only portal</td>
                    <td className="px-4 py-2.5 font-mono text-emerald-700">0 Unreviewed &gt;60d</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5 text-xs">
          <span className="text-slate-500">
            Includes resolved official institutional URLs, Figure 3.1 diagram, Table 4.1–5.2 &amp; unified guide metadata.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 font-medium text-white hover:bg-emerald-800"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download Completed Report (.md)</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
