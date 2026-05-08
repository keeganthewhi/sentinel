import { notFound } from 'next/navigation';
import { getScan, listFindings, type FindingRow } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  readonly params: Promise<{ a: string; b: string }>;
}

interface DiffSet {
  readonly fixed: readonly FindingRow[];
  readonly persisted: readonly FindingRow[];
  readonly regressions: readonly FindingRow[];
}

function diff(baseline: readonly FindingRow[], current: readonly FindingRow[]): DiffSet {
  const baselineMap = new Map(baseline.map((f) => [f.fingerprint, f] as const));
  const currentMap = new Map(current.map((f) => [f.fingerprint, f] as const));
  const fixed: FindingRow[] = [];
  const persisted: FindingRow[] = [];
  const regressions: FindingRow[] = [];
  for (const [fp, f] of baselineMap) {
    if (!currentMap.has(fp)) fixed.push(f);
    else persisted.push(f);
  }
  for (const [fp, f] of currentMap) {
    if (!baselineMap.has(fp)) regressions.push(f);
  }
  return { fixed, persisted, regressions };
}

function severityClass(sev: string): string {
  if (sev === 'CRITICAL' || sev === 'HIGH') return 'text-[var(--color-fail)]';
  if (sev === 'MEDIUM') return 'text-[var(--color-warn)]';
  return 'text-[var(--color-muted)]';
}

function FindingRowList({ rows }: { rows: readonly FindingRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-muted)]">none</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((f) => (
        <li
          key={f.fingerprint}
          className="border border-[var(--color-border)] rounded px-3 py-2 bg-[var(--color-card)]"
        >
          <span className={severityClass(f.severity)}>{f.severity}</span>{' '}
          <span className="font-mono text-[var(--color-muted)]">{f.scanner}</span>{' '}
          <span>{f.title}</span>
          {f.filePath !== null && (
            <span className="text-[var(--color-muted)]"> · {f.filePath}:{f.lineNumber ?? '?'}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function DiffPage({ params }: PageProps) {
  const { a, b } = await params;
  const [baselineScan, currentScan] = await Promise.all([getScan(a), getScan(b)]);
  if (baselineScan === null || currentScan === null) notFound();

  const [baselineFindings, currentFindings] = await Promise.all([listFindings(a), listFindings(b)]);
  const { fixed, persisted, regressions } = diff(baselineFindings, currentFindings);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Diff</h1>
        <p className="text-sm text-[var(--color-muted)] mt-1">
          baseline <code className="font-mono">{a.slice(0, 8)}</code> · current{' '}
          <code className="font-mono">{b.slice(0, 8)}</code>
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold text-[var(--color-fail)] mb-3">
          Regressions ({regressions.length})
        </h2>
        <FindingRowList rows={regressions} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--color-pass)] mb-3">
          Fixed ({fixed.length})
        </h2>
        <FindingRowList rows={fixed} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--color-muted)] mb-3">
          Persisted ({persisted.length})
        </h2>
        <FindingRowList rows={persisted} />
      </section>
    </div>
  );
}
