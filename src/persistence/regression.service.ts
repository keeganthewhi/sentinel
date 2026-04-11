/**
 * RegressionService — diffs the current scan against the most recent
 * completed scan for the same target repo.
 *
 * A finding is a "regression" if it appears in the new scan but not in the
 * baseline scan (matched by fingerprint). A finding is "fixed" if it appears
 * in the baseline but not in the current scan.
 *
 * Pure operation: does not write to the DB. The caller updates `Finding.isRegression`
 * via the FindingRepository if persistence is desired.
 */

import { Injectable } from '@nestjs/common';
import type { Finding, PrismaClient, Scan } from '@prisma/client';

export interface RegressionDiff {
  readonly newFingerprints: readonly string[];
  readonly fixedFingerprints: readonly string[];
  readonly persistedFingerprints: readonly string[];
  readonly baselineScanId: string | null;
}

@Injectable()
export class RegressionService {
  constructor(private readonly prisma: PrismaClient) {}

  public async diff(currentScanId: string): Promise<RegressionDiff> {
    const current = await this.prisma.scan.findUnique({ where: { id: currentScanId } });
    if (current === null) {
      return { newFingerprints: [], fixedFingerprints: [], persistedFingerprints: [], baselineScanId: null };
    }

    const baseline = await this.findBaseline(current);
    const currentFps = await this.fingerprintSet(currentScanId);
    if (baseline === null) {
      return {
        newFingerprints: [...currentFps],
        fixedFingerprints: [],
        persistedFingerprints: [],
        baselineScanId: null,
      };
    }
    const baselineFps = await this.fingerprintSet(baseline.id);

    const newFingerprints: string[] = [];
    const persistedFingerprints: string[] = [];
    for (const fp of currentFps) {
      if (baselineFps.has(fp)) {
        persistedFingerprints.push(fp);
      } else {
        newFingerprints.push(fp);
      }
    }

    const fixedFingerprints: string[] = [];
    for (const fp of baselineFps) {
      if (!currentFps.has(fp)) {
        fixedFingerprints.push(fp);
      }
    }

    return {
      newFingerprints,
      fixedFingerprints,
      persistedFingerprints,
      baselineScanId: baseline.id,
    };
  }

  /** Find the most recent COMPLETED scan for the same target repo, excluding the current. */
  private async findBaseline(current: Scan): Promise<Scan | null> {
    return this.prisma.scan.findFirst({
      where: {
        targetRepo: current.targetRepo,
        status: { in: ['COMPLETED', 'PARTIAL'] },
        id: { not: current.id },
        startedAt: { lt: current.startedAt },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async fingerprintSet(scanId: string): Promise<Set<string>> {
    const findings = await this.prisma.finding.findMany({
      where: { scanId },
      select: { fingerprint: true },
    });
    return new Set(findings.map((f: Pick<Finding, 'fingerprint'>) => f.fingerprint));
  }
}
