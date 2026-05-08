/**
 * Phase runner — executes all scanners for a single phase, in parallel,
 * via the injected IPipelineRunner.
 *
 * Invariants:
 *   - Per-scanner failure never cancels the phase (Promise.allSettled).
 *   - Scanners with `requiresUrl: true` are skipped when `context.targetUrl`
 *     is undefined or empty; a SKIPPED result is emitted with a clear reason.
 *   - The phase runner does NOT mutate the input context — it returns the
 *     collected results and the caller merges them.
 */

import { createLogger } from '../../common/logger.js';
import type {
  BaseScanner,
  ScanContext,
  ScannerResult,
} from '../../scanner/types/scanner.interface.js';
import type { ScannerRegistry } from '../../scanner/scanner.registry.js';
import type { ProgressEmitter } from '../../report/progress/progress.emitter.js';
import type { IPipelineRunner } from '../types.js';
import type { StrategistRegistry } from '../../governor/strategist/strategist-registry.js';
import type { AgentAdapter } from '../../governor/agent-adapter.js';
import type { PhaseRunRepository } from '../../persistence/phase-run.repository.js';
import { runScannerIterationLoop } from './scanner-iteration-loop.js';

const logger = createLogger({ module: 'pipeline.phase-runner' });

/**
 * Optional strategist hooks. When all three are provided AND `context.governed`
 * is true AND a scanner has a `strategistName`, the phase runner routes that
 * scanner through the iteration loop. Missing any of these fields collapses
 * to the legacy single-shot mechanical path.
 */
export interface PhaseRunStrategistHooks {
  readonly strategistRegistry: StrategistRegistry;
  readonly adapter: AgentAdapter;
  readonly workspacesRoot: string;
  /**
   * Plan 018.5 — when provided, the phase runner upserts each scanner's
   * iteration history into `PhaseRun.iterations`. Errors swallow with WARN;
   * disk artifacts under `workspaces/<scanId>/per-tool/<scanner>/` remain the
   * source of truth.
   */
  readonly phaseRunRepository?: PhaseRunRepository;
}

export async function runPhase(
  phase: 1 | 2 | 3,
  registry: ScannerRegistry,
  runner: IPipelineRunner,
  context: ScanContext,
  emitter: ProgressEmitter,
  strategistHooks?: PhaseRunStrategistHooks,
): Promise<readonly ScannerResult[]> {
  const allScanners = registry.forPhase(phase);
  const startedAt = Date.now();

  emitter.emit({ type: 'phase.start', phase });

  const results = await Promise.allSettled(
    allScanners.map(async (scanner) => {
      const skipReason = shouldSkipWithReason(scanner, context);
      if (skipReason !== null) {
        const skippedResult: ScannerResult = {
          scanner: scanner.name,
          findings: [],
          rawOutput: '',
          executionTimeMs: 0,
          success: true,
          error: `skipped: ${skipReason}`,
        };
        emitter.emit({
          type: 'scanner.end',
          phase,
          scanner: scanner.name,
          success: true,
          durationMs: 0,
          message: 'skipped',
        });
        return skippedResult;
      }

      emitter.emit({ type: 'scanner.start', phase, scanner: scanner.name });
      const runStart = Date.now();

      // Plan 018: when --governed AND a strategist is registered for this
      // scanner, route through the iteration loop. Otherwise fall back to a
      // single mechanical run (the legacy code path).
      let result: ScannerResult;
      if (
        context.governed &&
        scanner.strategistName !== undefined &&
        strategistHooks !== undefined
      ) {
        const strategist = strategistHooks.strategistRegistry.forScanner(scanner.strategistName);
        if (strategist !== undefined) {
          const outcome = await runScannerIterationLoop({
            scanner,
            context,
            runner,
            strategist,
            adapter: strategistHooks.adapter,
            workspacesRoot: strategistHooks.workspacesRoot,
          });
          result = outcome.collapsed;
          logger.info(
            {
              scanId: context.scanId,
              scanner: scanner.name,
              iterations: outcome.iterations.length,
              findings: result.findings.length,
            },
            'strategist iteration loop completed',
          );
          // Plan 018.5: lift iterations into Prisma. Best-effort — disk
          // artifacts remain authoritative.
          if (
            strategistHooks.phaseRunRepository !== undefined &&
            outcome.iterations.length > 0
          ) {
            try {
              await strategistHooks.phaseRunRepository.upsertIterations({
                scanId: context.scanId,
                scanner: scanner.name,
                phase,
                iterations: outcome.iterations,
              });
            } catch (err) {
              logger.warn(
                {
                  scanId: context.scanId,
                  scanner: scanner.name,
                  err: err instanceof Error ? err.message : String(err),
                },
                'iteration history persistence failed — disk artifacts retain history',
              );
            }
          }
        } else {
          result = await runner.runScanner(scanner, context);
        }
      } else {
        result = await runner.runScanner(scanner, context);
      }

      const durationMs = Date.now() - runStart;
      emitter.emit({
        type: 'scanner.end',
        phase,
        scanner: scanner.name,
        success: result.success,
        durationMs,
      });
      return result;
    }),
  );

  const scannerResults: ScannerResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const settled = results[i];
    const scanner = allScanners[i];
    if (settled.status === 'fulfilled') {
      scannerResults.push(settled.value);
    } else {
      const reason: unknown = settled.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      logger.warn({ scanner: scanner.name, err: message }, 'phase runner promise rejected (should not happen)');
      scannerResults.push({
        scanner: scanner.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: false,
        error: message,
      });
    }
  }

  emitter.emit({ type: 'phase.end', phase, durationMs: Date.now() - startedAt });
  return scannerResults;
}

/**
 * Decide whether this scanner should be skipped before it runs, returning a
 * short human-readable reason or null if it should proceed. The two reasons
 * a scanner gets skipped:
 *   1. It requires a target URL but none was provided.
 *   2. The governor plan-generator produced an enabledScanners allow-list
 *      and this scanner is not on it.
 */
function shouldSkipWithReason(scanner: BaseScanner, context: ScanContext): string | null {
  if (
    context.enabledScannerAllowlist !== undefined &&
    !context.enabledScannerAllowlist.includes(scanner.name)
  ) {
    return 'governor plan did not enable this scanner';
  }
  if (scanner.requiresUrl) {
    const url = context.targetUrl;
    if (url === undefined || url.trim() === '') {
      return 'requiresUrl=true but targetUrl is absent';
    }
  }
  return null;
}
