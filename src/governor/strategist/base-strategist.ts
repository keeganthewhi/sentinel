/**
 * BaseStrategist — abstract per-tool AI sibling of `BaseScanner`.
 *
 * One concrete subclass per scanner that opts in (referenced via
 * `BaseScanner.strategistName`). Lifecycle (driven by the pipeline in plan 018):
 *
 *   strategize(ctx)                       → ScannerInvocationPlan
 *   pipeline runs scanner with the plan   → ScannerResult
 *   replay(ctx, prev, lastResult)         → ReplayDecision { stop | replay }
 *   loop until 'stop' OR iteration ≥ 3
 *   narrate(ctx, iterations)              → markdown report
 *
 * Every method MUST raise `StrategistFailureError` (typed) on failure so the
 * pipeline can fall back to the mechanical scanner default cleanly.
 *
 * This file MUST NOT import `node:child_process` or any scanner concrete class.
 * The strategist receives an `AgentAdapter` and reads scanner output — it
 * never spawns the scanner. (CLAUDE.md Critical Invariant #4.)
 */

import type { ScanContext, ScannerResult } from '../../scanner/types/scanner.interface.js';
import type { AgentAdapter } from '../agent-adapter.js';
import type {
  ReplayDecision,
  ScannerInvocationPlan,
  StrategistIteration,
} from './types/strategist-contract.js';

export interface StrategistContext {
  readonly scanId: string;
  readonly scanner: string;
  readonly adapter: AgentAdapter;
  readonly scanContext: ScanContext;
}

export abstract class BaseStrategist {
  public abstract readonly name: string;
  public abstract readonly scannerName: string;

  /** Initial scan plan, before any execution. */
  public abstract strategize(ctx: StrategistContext): Promise<ScannerInvocationPlan>;

  /**
   * After each iteration, decide whether to replay with alternative params.
   * Default: stop. Subclasses override when they have a meaningful retry
   * heuristic (e.g., empty findings + budget remaining ⇒ broaden ruleset).
   */
  public replay(
    _ctx: StrategistContext,
    _previous: readonly StrategistIteration[],
    _lastResult: ScannerResult,
  ): Promise<ReplayDecision> {
    return Promise.resolve({
      action: 'stop',
      rationale: 'BaseStrategist default — no replay heuristic configured',
    });
  }

  /**
   * Render the per-tool MD report once iteration ends. Best-effort: a
   * narrate failure must NOT lose the per-tool report entirely — concrete
   * strategists should fall back to a mechanical summary in their own
   * implementation rather than re-throwing.
   */
  public abstract narrate(
    ctx: StrategistContext,
    iterations: readonly StrategistIteration[],
  ): Promise<string>;
}
