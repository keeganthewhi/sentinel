/**
 * Dashboard Prisma client.
 *
 * Reads the same SQLite DB Sentinel writes to. Dashboard never mutates;
 * all pages + routes are read-only.
 *
 * Cached on the Node module-scope so Next.js dev mode hot-reloads do not
 * leak Prisma clients.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

declare global {
  // eslint-disable-next-line no-var
  var __sentinelDashboardPrisma: PrismaClient | undefined;
}

function buildClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL ?? 'file:./data/sentinel.db';
  const filename = databaseUrl.replace(/^file:/, '');
  const adapter = new PrismaBetterSqlite3({ url: filename });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__sentinelDashboardPrisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__sentinelDashboardPrisma = prisma;
}

export interface ScanRow {
  readonly id: string;
  readonly status: string;
  readonly targetRepo: string;
  readonly targetUrl: string | null;
  readonly governed: boolean;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export async function listScans(limit = 20): Promise<ScanRow[]> {
  const rows = await prisma.scan.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      targetRepo: true,
      targetUrl: true,
      governed: true,
      startedAt: true,
      completedAt: true,
    },
  });
  return rows;
}

export async function getScan(id: string): Promise<ScanRow | null> {
  const row = await prisma.scan.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      targetRepo: true,
      targetUrl: true,
      governed: true,
      startedAt: true,
      completedAt: true,
    },
  });
  return row;
}

export interface FindingRow {
  readonly id: string;
  readonly fingerprint: string;
  readonly title: string;
  readonly severity: string;
  readonly scanner: string;
  readonly category: string;
  readonly cveId: string | null;
  readonly cweId: string | null;
  readonly filePath: string | null;
  readonly lineNumber: number | null;
  readonly endpoint: string | null;
  readonly governorAction: string | null;
  readonly remediation: string | null;
}

export async function listFindings(scanId: string): Promise<FindingRow[]> {
  return prisma.finding.findMany({
    where: { scanId, isDuplicate: false },
    orderBy: [{ severity: 'asc' }, { scanner: 'asc' }],
    select: {
      id: true,
      fingerprint: true,
      title: true,
      severity: true,
      scanner: true,
      category: true,
      cveId: true,
      cweId: true,
      filePath: true,
      lineNumber: true,
      endpoint: true,
      governorAction: true,
      remediation: true,
    },
  });
}

export interface DecisionRow {
  readonly id: string;
  readonly phase: number;
  readonly decisionType: string;
  readonly rationale: string | null;
  readonly createdAt: Date;
}

export async function listDecisions(scanId: string): Promise<DecisionRow[]> {
  return prisma.governorDecision.findMany({
    where: { scanId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      phase: true,
      decisionType: true,
      rationale: true,
      createdAt: true,
    },
  });
}

export interface PhaseRunRow {
  readonly id: string;
  readonly phase: number;
  readonly scanner: string;
  readonly status: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly findingCount: number;
}

export async function listPhaseRuns(scanId: string): Promise<PhaseRunRow[]> {
  return prisma.phaseRun.findMany({
    where: { scanId },
    orderBy: [{ phase: 'asc' }, { scanner: 'asc' }],
    select: {
      id: true,
      phase: true,
      scanner: true,
      status: true,
      startedAt: true,
      completedAt: true,
      findingCount: true,
    },
  });
}
