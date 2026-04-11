/**
 * Shared runtime helpers for scanner.execute() implementations.
 *
 * Each concrete scanner builds its argv array, calls `runScannerInDocker`, and
 * either parses the stdout into findings (vuln-style scanners) or hands the raw
 * stdout to a scanner-specific method (subfinder.collectSubdomains, httpx.collectEndpoints).
 *
 * Failure normalisation: every non-zero exit, every spawn error, every timeout
 * becomes a `ScannerResult` with `success: false` and a non-secret stderr blurb.
 * Scanners NEVER throw from `execute()` — they return failure results instead
 * (CLAUDE.md Critical Invariant #3).
 */

import type { DockerExecutor } from '../../execution/docker.executor.js';
import type {
  NormalizedFinding,
} from '../types/finding.interface.js';
import type {
  BaseScanner,
  ScanContext,
  ScannerResult,
} from '../types/scanner.interface.js';
import { createLogger } from '../../common/logger.js';

const logger = createLogger({ module: 'scanner.runner' });

export interface RunOptions {
  readonly scanner: BaseScanner;
  readonly executor: DockerExecutor | undefined;
  readonly context: ScanContext;
  readonly command: readonly string[];
  /** When true, the scanner counts a non-zero exit as success (e.g. trivy returns 1 when it finds vulns). */
  readonly nonZeroIsSuccess?: boolean;
  /** When set, override the per-scan timeout for this specific scanner. */
  readonly timeoutMs?: number;
}

export interface RunOutcome {
  readonly result: ScannerResult;
  readonly stdout: string;
  /** True when the scanner succeeded and parseOutput should be called. */
  readonly ok: boolean;
}

const STDERR_TRUNCATE_BYTES = 2000;

function buildSkippedResult(scanner: BaseScanner, reason: string): ScannerResult {
  return {
    scanner: scanner.name,
    findings: [],
    rawOutput: '',
    executionTimeMs: 0,
    success: true,
    error: `skipped: ${reason}`,
  };
}

function buildFailureResult(
  scanner: BaseScanner,
  exitCode: number | null,
  stderr: string,
  durationMs: number,
  timedOut: boolean,
): ScannerResult {
  const truncated = stderr.length > STDERR_TRUNCATE_BYTES
    ? `${stderr.slice(0, STDERR_TRUNCATE_BYTES)}\n[STDERR TRUNCATED]`
    : stderr;
  return {
    scanner: scanner.name,
    findings: [],
    rawOutput: '',
    executionTimeMs: durationMs,
    success: false,
    error: timedOut
      ? `timeout after ${durationMs}ms`
      : `exit ${exitCode ?? 'null'}: ${truncated || '<no stderr>'}`,
    timedOut,
  };
}

/**
 * Run a scanner inside the Sentinel scanner image. Returns a parsed
 * RunOutcome that the caller uses to populate `findings` via `parseOutput`.
 */
export async function runScannerInDocker(options: RunOptions): Promise<RunOutcome> {
  const { scanner, executor, context, command, nonZeroIsSuccess, timeoutMs } = options;

  if (executor === undefined) {
    const result: ScannerResult = {
      scanner: scanner.name,
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: false,
      error: 'DockerExecutor not wired (ScannerModule.onModuleInit did not run)',
    };
    return { result, stdout: '', ok: false };
  }

  const runResult = await executor.run({
    image: context.scannerImage,
    command,
    // Prefer a pre-populated docker volume (fast on Docker Desktop / Windows)
    // over the raw 9P bind mount when the pipeline has set one up.
    ...(context.workspaceVolume !== undefined
      ? { workspaceVolume: context.workspaceVolume }
      : { workspaceRepo: context.targetRepo }),
    timeoutMs: timeoutMs ?? context.scannerTimeoutMs,
    scanner: scanner.name,
  });

  const success = runResult.exitCode === 0 || (nonZeroIsSuccess === true && runResult.exitCode !== null && !runResult.timedOut);

  if (!success) {
    return {
      result: buildFailureResult(
        scanner,
        runResult.exitCode,
        runResult.stderr,
        runResult.durationMs,
        runResult.timedOut,
      ),
      stdout: runResult.stdout,
      ok: false,
    };
  }

  return {
    result: {
      scanner: scanner.name,
      findings: [],
      rawOutput: runResult.stdout,
      executionTimeMs: runResult.durationMs,
      success: true,
    },
    stdout: runResult.stdout,
    ok: true,
  };
}

/** Build a successful ScannerResult from parsed findings. */
export function withFindings(outcome: RunOutcome, findings: readonly NormalizedFinding[]): ScannerResult {
  return {
    ...outcome.result,
    findings,
  };
}

export { buildSkippedResult, buildFailureResult };

export function logSkip(scanner: string, scanId: string, reason: string): void {
  logger.info({ scanner, scanId }, `scanner skipped: ${reason}`);
}
