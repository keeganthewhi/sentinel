import type { ScanRow } from '@/lib/db';

interface ScanCardProps {
  readonly scan: ScanRow;
  readonly live?: boolean;
}

function statusClass(status: string): string {
  if (status === 'COMPLETED') return 'text-[var(--color-pass)]';
  if (status === 'FAILED') return 'text-[var(--color-fail)]';
  if (status === 'PARTIAL') return 'text-[var(--color-warn)]';
  if (status === 'RUNNING' || status === 'PENDING') return 'text-[var(--color-accent)]';
  return 'text-[var(--color-muted)]';
}

export function ScanCard({ scan, live }: ScanCardProps) {
  const duration =
    scan.completedAt !== null
      ? Math.round((scan.completedAt.getTime() - scan.startedAt.getTime()) / 1000)
      : Math.round((Date.now() - scan.startedAt.getTime()) / 1000);
  return (
    <a
      href={`/scans/${scan.id}`}
      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="font-mono text-xs text-[var(--color-muted)]">{scan.id.slice(0, 12)}</p>
          <p className="text-sm truncate">{scan.targetRepo}</p>
          {scan.targetUrl !== null && (
            <p className="text-xs text-[var(--color-muted)] truncate">{scan.targetUrl}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-semibold ${statusClass(scan.status)}`}>{scan.status}</p>
          <p className="text-xs text-[var(--color-muted)]">{duration}s</p>
          {scan.governed && (
            <p className="text-xs text-[var(--color-accent)] mt-1">governed</p>
          )}
          {live === true && (
            <p className="text-xs text-[var(--color-accent)] mt-1">● live</p>
          )}
        </div>
      </div>
    </a>
  );
}
