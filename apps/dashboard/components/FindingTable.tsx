'use client';

import { useMemo, useState } from 'react';
import type { FindingRow } from '@/lib/db';

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

function severityClass(sev: string): string {
  if (sev === 'CRITICAL') return 'bg-[var(--color-fail)]/15 text-[var(--color-fail)]';
  if (sev === 'HIGH') return 'bg-[var(--color-fail)]/15 text-[var(--color-fail)]';
  if (sev === 'MEDIUM') return 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]';
  if (sev === 'LOW') return 'bg-[var(--color-muted)]/15 text-[var(--color-muted)]';
  return 'bg-[var(--color-muted)]/15 text-[var(--color-muted)]';
}

interface FindingTableProps {
  readonly findings: readonly FindingRow[];
}

export function FindingTable({ findings }: FindingTableProps) {
  const [filter, setFilter] = useState('');
  const [showDiscarded, setShowDiscarded] = useState(false);

  const rows = useMemo(() => {
    const base = showDiscarded
      ? findings
      : findings.filter((f) => f.governorAction !== 'discarded');
    const term = filter.trim().toLowerCase();
    const matched = term.length === 0
      ? base
      : base.filter(
          (f) =>
            f.title.toLowerCase().includes(term) ||
            f.scanner.toLowerCase().includes(term) ||
            (f.filePath ?? '').toLowerCase().includes(term) ||
            (f.cveId ?? '').toLowerCase().includes(term),
        );
    return [...matched].sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 9;
      const sb = SEVERITY_ORDER[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return a.scanner.localeCompare(b.scanner);
    });
  }, [findings, filter, showDiscarded]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <input
          type="search"
          placeholder="filter (title, scanner, path, CVE)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 max-w-sm rounded border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={showDiscarded}
            onChange={(e) => setShowDiscarded(e.target.checked)}
          />
          show governor-discarded
        </label>
        <span className="text-sm text-[var(--color-muted)]">{rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-muted)]">
            <tr>
              <th className="py-2 pr-3">Severity</th>
              <th className="py-2 pr-3">Scanner</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Title</th>
              <th className="py-2 pr-3">File · Line</th>
              <th className="py-2 pr-3">CVE</th>
              <th className="py-2 pr-3">Governor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="border-t border-[var(--color-border)] align-top">
                <td className="py-2 pr-3">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${severityClass(f.severity)}`}
                  >
                    {f.severity}
                  </span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{f.scanner}</td>
                <td className="py-2 pr-3 text-xs text-[var(--color-muted)]">{f.category}</td>
                <td className="py-2 pr-3">{f.title}</td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {f.filePath !== null ? `${f.filePath}${f.lineNumber !== null ? `:${f.lineNumber}` : ''}` : f.endpoint ?? '—'}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{f.cveId ?? f.cweId ?? '—'}</td>
                <td className="py-2 pr-3 text-xs">{f.governorAction ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-[var(--color-muted)]">
                  no findings match
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
