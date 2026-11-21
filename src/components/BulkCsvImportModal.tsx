import { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Upload, X } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { ApprovedPost, EmployeeRecord, Station } from '../types/payroll.ts';

interface ParsedCsvRow {
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
}

interface BulkCsvImportModalProps {
  employees: EmployeeRecord[];
  stations: Station[];
  posts: ApprovedPost[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

const REQUIRED_HEADERS = ['staff_id', 'station_code'];

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvText(rawText: string): { headers: string[]; rows: ParsedCsvRow[]; error: string | null } {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      headers: [],
      rows: [],
      error: 'CSV must contain a header row and at least one data row.',
    };
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  for (const req of REQUIRED_HEADERS) {
    if (!headers.includes(req)) {
      return {
        headers,
        rows: [],
        error: `Missing required CSV column "${req}".`,
      };
    }
  }

  const rows: ParsedCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const get = (key: string) => {
      const idx = headers.indexOf(key);
      return idx >= 0 && idx < cols.length ? cols[idx] : '';
    };
    rows.push({
      staff_id: get('staff_id').toUpperCase(),
      nrc_number: get('nrc_number'),
      full_name: get('full_name'),
      date_of_birth: get('date_of_birth'),
      bank_account: get('bank_account'),
      station_code: get('station_code').toUpperCase(),
      post_code: get('post_code').toUpperCase(),
      employment_status: get('employment_status') || 'Active',
      gross_pay: get('gross_pay'),
      net_pay: get('net_pay'),
      recruit_date: get('recruit_date'),
    });
  }

  return { headers, rows, error: null };
}

export function BulkCsvImportModal({
  employees,
  stations,
  posts,
  onClose,
  onSuccess,
  onNotify,
}: BulkCsvImportModalProps) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    inserted: number;
    updated: number;
    transfers_logged: number;
    skipped: number;
    errors: Array<{ row: number; staff_id: string; reason: string }>;
  } | null>(null);

  const existingIds = useMemo(
    () => new Set(employees.map((e) => e.staff_id.toUpperCase())),
    [employees]
  );
  const stationCodes = useMemo(
    () => new Set(stations.map((s) => s.code.toUpperCase())),
    [stations]
  );
  const postCodes = useMemo(
    () => new Set(posts.map((p) => p.post_code.toUpperCase())),
    [posts]
  );

  const parsed = useMemo(() => {
    if (!csvText.trim()) return null;
    return parseCsvText(csvText);
  }, [csvText]);

  function handleDownloadTemplate() {
    const sampleStation1 = stations[0]?.code ?? 'MOE-CHB-101';
    const samplePost1 = posts[14]?.post_code ?? posts[0]?.post_code ?? 'EST-CHB-0105';
    const existingSample = employees[0];
    const targetStation2 = stations[2]?.code ?? 'MOE-LSK-201';
    const samplePost2 = posts[6]?.post_code ?? 'EST-LSK-0101';

    const lines = [
      'staff_id,nrc_number,full_name,date_of_birth,bank_account,station_code,post_code,employment_status,gross_pay,net_pay,recruit_date',
      `ZMB-MOE-10540,582310/17/1,Luyando Mwape,1996-07-14,ZANACO-0088123456,${sampleStation1},${samplePost1},Pending Placement,10200,6250,2026-10-01`,
      existingSample
        ? `${existingSample.staff_id},${existingSample.nrc_number},${existingSample.full_name},${existingSample.date_of_birth},${existingSample.bank_account},${targetStation2},${samplePost2},Active,${existingSample.gross_pay},${existingSample.net_pay},${existingSample.recruit_date ?? '2011-01-15'}`
        : `ZMB-MOE-10421,241509/10/1,Bwalya Tembo,1979-04-12,ZANACO-0041928310,${targetStation2},${samplePost2},Active,14850,9200,2011-01-15`,
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'opms_staff_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportResult(null);
    const text = await file.text();
    setCsvText(text);
  }

  async function handleImport() {
    if (!parsed || parsed.error || parsed.rows.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await api.bulkImportEmployees(parsed.rows);
      setImportResult(res);
      await onSuccess();
      onNotify(
        res.inserted > 0 || res.updated > 0 ? 'success' : 'error',
        `CSV import processed: ${res.inserted} registered, ${res.updated} updated (${res.transfers_logged} transfer(s) logged), ${res.skipped} skipped.`
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Bulk CSV import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Bulk CSV Import — Staff Register &amp; Station Updates
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Upload standard payroll CSV files to register new recruits or update existing Staff ID station assignments.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6 text-xs">
          {/* File Upload & Template Controls */}
          <div className="flex flex-col justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="font-medium text-slate-900">
                {fileName ? `Selected file: ${fileName}` : 'Select a CSV file or paste payroll rows below'}
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                Required columns: staff_id, station_code · Optional for updates: post_code, employment_status, gross_pay, net_pay
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-emerald-700" />
                <span>Download Template</span>
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800 whitespace-nowrap">
                <Upload className="h-3.5 w-3.5" />
                <span>Choose CSV File</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileSelect}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {/* Raw CSV Paste Area */}
          <div>
            <label htmlFor="csv-paste-input" className="mb-1 block font-medium text-slate-700">
              CSV Content
            </label>
            <textarea
              id="csv-paste-input"
              rows={5}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setImportResult(null);
              }}
              placeholder="staff_id,nrc_number,full_name,date_of_birth,bank_account,station_code,post_code,employment_status,gross_pay,net_pay,recruit_date"
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-emerald-700 focus:outline-none"
            />
          </div>

          {/* Parse Error */}
          {parsed?.error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{parsed.error}</span>
            </div>
          )}

          {/* Live Preview Table */}
          {parsed && !parsed.error && parsed.rows.length > 0 && (
            <div className="rounded-md border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <span className="font-medium text-slate-900">
                  Preview ({parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'})
                </span>
                <span className="text-slate-500">
                  Existing Staff IDs update station &amp; log transfers; new Staff IDs register
                </span>
              </div>
              <div className="max-h-48 overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-white text-slate-500">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Staff ID</th>
                      <th className="px-3 py-2 font-medium">Operation</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Station / Post</th>
                      <th className="px-3 py-2 font-medium">Pre-Check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {parsed.rows.map((r, i) => {
                      const isUpdate = existingIds.has(r.staff_id);
                      const validStation = stationCodes.has(r.station_code);
                      const validPost = !r.post_code || postCodes.has(r.post_code);
                      return (
                        <tr key={`${r.staff_id}-${i}`} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-500">{i + 1}</td>
                          <td className="px-3 py-2 font-mono font-medium text-slate-900">
                            {r.staff_id || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={isUpdate ? 'font-medium text-amber-700' : 'font-medium text-emerald-700'}>
                              {isUpdate ? 'Station / Record Update' : 'New Staff Entry'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{r.full_name || '(keep existing)'}</td>
                          <td className="px-3 py-2 font-mono text-slate-700">
                            {r.station_code || '—'} {r.post_code ? `· ${r.post_code}` : ''}
                          </td>
                          <td className="px-3 py-2">
                            {validStation && validPost ? (
                              <span className="text-emerald-700">Valid codes</span>
                            ) : (
                              <span className="text-red-700">
                                {!validStation ? 'Unknown station_code' : 'Unknown post_code'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Server Import Summary */}
          {importResult && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 font-medium text-slate-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <span>
                  Import Summary: {importResult.inserted} inserted · {importResult.updated} updated ·{' '}
                  {importResult.transfers_logged} transfer(s) logged · {importResult.skipped} skipped
                </span>
              </div>
              {importResult.errors.length > 0 && (
                <ul className="space-y-1 pl-6 text-red-700">
                  {importResult.errors.map((err) => (
                    <li key={`${err.row}-${err.staff_id}`} className="font-mono">
                      Row {err.row} ({err.staff_id}): {err.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={importing || !parsed || Boolean(parsed.error) || parsed.rows.length === 0}
            onClick={handleImport}
            className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {importing
              ? 'Importing...'
              : `Import ${parsed && !parsed.error ? parsed.rows.length : 0} Row(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
