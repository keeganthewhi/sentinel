import { listScans, type ScanRow } from '@/lib/db';
import { ScanCard } from '@/components/ScanCard';
import { LiveStream } from '@/components/LiveStream';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function pickActive(scans: ScanRow[]): ScanRow | undefined {
  return scans.find((s) => s.status === 'RUNNING' || s.status === 'PENDING');
}

export default async function Home() {
  let scans: ScanRow[] = [];
  let dbError: string | null = null;
  try {
    scans = await listScans(20);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const active = pickActive(scans);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-xl font-semibold mb-4">Active scan</h1>
        {dbError !== null && (
          <p className="text-sm text-[var(--color-fail)]">
            Database unavailable: {dbError}. Run a scan first to materialise the SQLite file.
          </p>
        )}
        {dbError === null && active === undefined && (
          <p className="text-sm text-[var(--color-muted)]">
            No active scan. Run{' '}
            <code className="text-[var(--color-accent)]">./sentinel start --repo &lt;path&gt;</code>{' '}
            from another terminal.
          </p>
        )}
        {active !== undefined && <ScanCard scan={active} live />}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Live stream</h2>
        <LiveStream />
      </section>

      {scans.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-4">Recent scans</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scans.filter((s) => s.id !== active?.id).map((s) => (
              <ScanCard key={s.id} scan={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
