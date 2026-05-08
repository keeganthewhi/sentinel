import { NextResponse } from 'next/server';
import { getScan, listDecisions, listFindings, listPhaseRuns } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const scan = await getScan(id);
    if (scan === null) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const [findings, decisions, phaseRuns] = await Promise.all([
      listFindings(id),
      listDecisions(id),
      listPhaseRuns(id),
    ]);
    return NextResponse.json({
      scan,
      findingCount: findings.length,
      decisionCount: decisions.length,
      phaseRunCount: phaseRuns.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
