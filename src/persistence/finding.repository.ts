/**
 * FindingRepository — persistence for the Finding entity.
 *
 * Critical invariants:
 *   - Every query scoped by `scanId` (anti-BOLA, even though Sentinel is single-tenant).
 *   - Bulk insert wrapped in `prisma.$transaction` so partial writes are impossible.
 *   - Unique constraint `(scanId, fingerprint)` enforced at the schema level — duplicate
 *     fingerprints from a re-run are caught at the DB layer, not in code.
 *
 * NEVER call `findUnique({ where: { id } })` on a client-supplied id — always scope
 * by `(scanId, fingerprint)` (CLAUDE.md anti-pattern table).
 */

import { Injectable } from '@nestjs/common';
import type { Finding, Prisma, PrismaClient } from '@prisma/client';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

export interface PersistFindingInput extends NormalizedFinding {
  readonly isDuplicate?: boolean;
  readonly correlationId?: string;
  readonly isRegression?: boolean;
  readonly governorAction?: string;
}

@Injectable()
export class FindingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Insert all findings for a scan in a single transaction. The unique
   * constraint on `(scanId, fingerprint)` ensures duplicates are rejected.
   * Caller must run `correlate()` first to mark duplicates with `isDuplicate`.
   */
  public async insertMany(scanId: string, findings: readonly PersistFindingInput[]): Promise<number> {
    if (findings.length === 0) return 0;

    const data: Prisma.FindingCreateManyInput[] = findings.map((f) => ({
      scanId,
      fingerprint: f.fingerprint,
      title: f.title,
      description: f.description,
      severity: f.severity,
      normalizedScore: f.normalizedScore,
      scanner: f.scanner,
      category: f.category,
      cveId: f.cveId,
      cweId: f.cweId,
      filePath: f.filePath,
      lineNumber: f.lineNumber,
      endpoint: f.endpoint,
      evidence: f.evidence,
      exploitProof: f.exploitProof,
      remediation: f.remediation,
      isDuplicate: f.isDuplicate ?? false,
      correlationId: f.correlationId,
      isRegression: f.isRegression ?? false,
      governorAction: f.governorAction,
    }));

    const result = await this.prisma.$transaction(async (tx) => {
      return tx.finding.createMany({ data });
    });
    return result.count;
  }

  public findAllByScanId(scanId: string): Promise<Finding[]> {
    return this.prisma.finding.findMany({
      where: { scanId },
      orderBy: [{ severity: 'asc' }, { category: 'asc' }],
    });
  }

  /** Look up a single finding by its (scanId, fingerprint) coordinate. */
  public findByFingerprint(scanId: string, fingerprint: string): Promise<Finding | null> {
    return this.prisma.finding.findUnique({
      where: { scanId_fingerprint: { scanId, fingerprint } },
    });
  }

  public countByScanId(scanId: string): Promise<number> {
    return this.prisma.finding.count({ where: { scanId } });
  }
}
