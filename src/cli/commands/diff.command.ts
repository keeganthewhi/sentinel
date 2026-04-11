/**
 * `sentinel diff <baseline-id> <current-id>` — compare two scans.
 *
 * The current implementation delegates to RegressionService for the
 * fingerprint-level diff. Per CLAUDE.md, the regression service uses
 * `targetRepo`-scoped baseline lookup; this command lets the user supply
 * an explicit baseline pair instead.
 */

import type { FindingRepository } from '../../persistence/finding.repository.js';
import type { ScanRepository } from '../../persistence/scan.repository.js';

export interface DiffOptions {
  readonly baselineScanId: string;
  readonly currentScanId: string;
}

export interface DiffDeps {
  readonly scans: ScanRepository;
  readonly findings: FindingRepository;
}

export interface DiffResult {
  readonly baselineScanId: string;
  readonly currentScanId: string;
  readonly newFingerprints: readonly string[];
  readonly fixedFingerprints: readonly string[];
  readonly persistedFingerprints: readonly string[];
}

export async function diffCommand(options: DiffOptions, deps: DiffDeps): Promise<DiffResult> {
  const baseline = await deps.scans.findById(options.baselineScanId);
  if (baseline === null) {
    throw new Error(`Baseline scan not found: ${options.baselineScanId}`);
  }
  const current = await deps.scans.findById(options.currentScanId);
  if (current === null) {
    throw new Error(`Current scan not found: ${options.currentScanId}`);
  }

  const baselineRows = await deps.findings.findAllByScanId(options.baselineScanId);
  const currentRows = await deps.findings.findAllByScanId(options.currentScanId);

  const baselineFps = new Set(baselineRows.map((r) => r.fingerprint));
  const currentFps = new Set(currentRows.map((r) => r.fingerprint));

  const newFingerprints: string[] = [];
  const persistedFingerprints: string[] = [];
  for (const fp of currentFps) {
    if (baselineFps.has(fp)) persistedFingerprints.push(fp);
    else newFingerprints.push(fp);
  }
  const fixedFingerprints: string[] = [];
  for (const fp of baselineFps) {
    if (!currentFps.has(fp)) fixedFingerprints.push(fp);
  }

  return {
    baselineScanId: options.baselineScanId,
    currentScanId: options.currentScanId,
    newFingerprints,
    fixedFingerprints,
    persistedFingerprints,
  };
}
