import { notFound } from 'next/navigation';
import { getScan, listDecisions, listFindings, listPhaseRuns } from '@/lib/db';
import { readAllPerToolReports } from '@/lib/per-tool';
import { PerToolReport } from '@/components/PerToolReport';
import { VerdictBadge } from '@/components/VerdictBadge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

function nonDiscarded(governorAction: string | null): boolean {
  return governorAction !== 'discarded';
}

export default async function ScanPage({ params }: PageProps) {
  const { id } = await params;
  const scan = await getScan(id);
  if (scan === null) notFound();

  const [findings, decisions, phaseRuns] = await Promise.all([
    listFindings(id),
    listDecisions(id),
    listPhaseRuns(id),
  ]);

  const perTool = readAllPerToolReports(id);
  const liveCount = findings.filter((f) => nonDiscarded(f.governorAction)).length;
  const verdict = liveCount === 0 ? 'PASS' : 'FAIL';

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Scan {id.slice(0, 8)}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {scan.targetRepo}
              {scan.targetUrl !== null && <> · {scan.targetUrl}</>}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              {scan.governed ? 'governed' : 'mechanical'} · status {scan.status} · started{' '}
              {scan.startedAt.toISOString()}
            </p>
          </div>
          <VerdictBadge verdict={verdict} />
        </div>
        <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-[var(--color-muted)]">Findings (live)</dt>
            <dd className="text-lg font-semibold">{liveCount}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Findings (total)</dt>
            <dd className="text-lg font-semibold">{findings.length}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Phase runs</dt>
            <dd className="text-lg font-semibold">{phaseRuns.length}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted)]">Governor decisions</dt>
            <dd className="text-lg font-semibold">{decisions.length}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <a
            href={`/scans/${id}/findings`}
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            view full finding table →
          </a>
        </div>
      </section>

      {phaseRuns.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Phase runs</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--color-muted)]">
              <tr>
                <th className="py-2 pr-4">Phase</th>
                <th className="py-2 pr-4">Scanner</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Findings</th>
              </tr>
            </thead>
            <tbody>
              {phaseRuns.map((p) => (
                <tr key={p.id} className="border-t border-[var(--color-border)]">
                  <td className="py-2 pr-4">{p.phase}</td>
                  <td className="py-2 pr-4 font-mono">{p.scanner}</td>
                  <td className="py-2 pr-4">{p.status}</td>
                  <td className="py-2 pr-4">{p.findingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {decisions.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Governor decisions</h2>
          <ul className="space-y-2 text-sm">
            {decisions.map((d) => (
              <li
                key={d.id}
                className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-card)]"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[var(--color-accent)] font-mono">{d.decisionType}</span>
                  <span className="text-[var(--color-muted)]">phase {d.phase}</span>
                </div>
                {d.rationale !== null && d.rationale.length > 0 && (
                  <p className="mt-1 text-[var(--color-muted)] whitespace-pre-wrap">
                    {d.rationale}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {perTool.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-3">Per-tool AI reports</h2>
          <div className="space-y-3">
            {perTool.map((entry) => (
              <details
                key={entry.scanner}
                className="border border-[var(--color-border)] rounded bg-[var(--color-card)]"
              >
                <summary className="cursor-pointer px-3 py-2 font-mono text-sm">
                  {entry.scanner}
                </summary>
                <div className="px-4 py-3 border-t border-[var(--color-border)]">
                  <PerToolReport markdown={entry.narrate} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
