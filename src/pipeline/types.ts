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
  /**
   * Populated in governed mode. Every step that called the governor writes
   * the input+output here for persistence / audit. The CLI hands this off to
   * GovernorDecisionRepository when persistence is wired.
   */
  readonly governorDecisions: readonly GovernorDecisionRecord[];
  /**
   * Governor-authored markdown report, when ReportWriter validated a response.
   * Undefined → use the mechanical MarkdownRenderer output instead.
   */
  readonly aiAuthoredMarkdown?: string;
}

/**
 * Audit record of a single governor call. Persisted to the GovernorDecision
 * table in governed + full mode; only kept in-memory in lite mode.
 */
export interface GovernorDecisionRecord {
  readonly decisionType: 'scan_plan' | 'phase1_evaluation' | 'phase2_evaluation' | 'report';
  readonly phase: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly fallback: boolean;
  readonly rationale?: string;
}

export interface IPipelineRunner {
  runScanner(scanner: BaseScanner, context: ScanContext): Promise<ScannerResult>;
}
