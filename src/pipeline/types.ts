/**
 * Pipeline types — runner interface, scan options, scan summary.
 *
 * The pipeline is pluggable: an in-memory runner is used in tests and
 * for simple CLI runs, while a BullMQ runner backs production scans.
 * Both implementations satisfy `IPipelineRunner`.
 */

import type {
  BaseScanner,
  ScanContext,
  ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

export interface PipelineRunOptions {
  readonly context: ScanContext;
  /** Restrict execution to these phases only. Default: all phases. */
  readonly phases?: readonly (1 | 2 | 3)[];
  readonly abortSignal?: AbortSignal;
}

export interface ScanSummary {
  readonly scanId: string;
  readonly findings: readonly NormalizedFinding[];
  readonly scannerResults: readonly ScannerResult[];
  readonly durationMs: number;
  /** Phases that were actually executed (after filtering). */
  readonly executedPhases: readonly (1 | 2 | 3)[];
}

export interface IPipelineRunner {
  runScanner(scanner: BaseScanner, context: ScanContext): Promise<ScannerResult>;
}
