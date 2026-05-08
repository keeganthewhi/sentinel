import { notFound } from 'next/navigation';
import { getScan, listFindings } from '@/lib/db';
import { FindingTable } from '@/components/FindingTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function FindingsPage({ params }: PageProps) {
  const { id } = await params;
  const scan = await getScan(id);
  if (scan === null) notFound();
  const findings = await listFindings(id);

  return (
    <div className="space-y-6">
      <div>
        <a
          href={`/scans/${id}`}
          className="text-sm text-[var(--color-accent)] hover:underline"
        >
          ← back to scan {id.slice(0, 8)}
        </a>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Findings · {findings.length} entries
      </h1>
      <FindingTable findings={findings} />
    </div>
  );
}
