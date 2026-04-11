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

const logger = createLogger({ module: 'pipeline.phase-runner' });

export async function runPhase(
  phase: 1 | 2 | 3,
  registry: ScannerRegistry,
  runner: IPipelineRunner,
  context: ScanContext,
  emitter: ProgressEmitter,
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
      const result = await runner.runScanner(scanner, context);
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
