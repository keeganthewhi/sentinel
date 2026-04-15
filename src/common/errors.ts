/**
 * Typed error hierarchy for Sentinel.
 *
 * All user-facing errors extend SentinelError, which implements the
 * terminal output format defined in CLAUDE.md (Error Contract section):
 *
 * ```json
 * {
 *   "error": "<error class name>",
 *   "scanner": "<if applicable>",
 *   "scanId": "<cuid>",
 *   "phase": "<phase number or 'bootstrap'>",
 *   "message": "<human readable>",
 *   "remediation": "<one-line fix hint>"
 * }
 * ```
 *
 * NEVER include secret values (tokens, keys, raw TruffleHog matches) in
 * error messages or remediation hints.
 */

export interface SentinelErrorContext {
  readonly scanner?: string;
  readonly scanId?: string;
  readonly phase?: string | number;
  readonly exitCode?: number;
  readonly timeoutMs?: number;
  readonly cause?: unknown;
}

export interface SerializedSentinelError {
  readonly error: string;
  readonly code: string;
  readonly message: string;
  readonly remediation: string;
  readonly scanner?: string;
  readonly scanId?: string;
  readonly phase?: string | number;
  readonly exitCode?: number;
  readonly timeoutMs?: number;
}

/**
 * Base class for every typed error in Sentinel.
 *
 * Subclasses MUST set a fixed `code` and `remediation`, and MAY attach
 * extra context fields through the constructor.
 */
export abstract class SentinelError extends Error {
  public abstract readonly code: string;
  public abstract readonly remediation: string;
  public readonly context: SentinelErrorContext;

  constructor(message: string, context: SentinelErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }

  public toJSON(): SerializedSentinelError {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      remediation: this.remediation,
      ...(this.context.scanner !== undefined && { scanner: this.context.scanner }),
      ...(this.context.scanId !== undefined && { scanId: this.context.scanId }),
      ...(this.context.phase !== undefined && { phase: this.context.phase }),
      ...(this.context.exitCode !== undefined && { exitCode: this.context.exitCode }),
      ...(this.context.timeoutMs !== undefined && { timeoutMs: this.context.timeoutMs }),
    };
  }
}

/** Scanner binary is not present in the scanner Docker image. */
export class ScannerNotAvailableError extends SentinelError {
  public readonly code = 'SCANNER_NOT_AVAILABLE';
  public readonly remediation =
    'Rebuild the scanner image: `docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .`';
}

/** Scanner subprocess exceeded its timeout and was killed. */
export class ScannerTimeoutError extends SentinelError {
  public readonly code = 'SCANNER_TIMEOUT';
  public readonly remediation =
    'Increase the scanner timeout in sentinel.yaml or via --timeout, or narrow the scan scope.';
}

/** Scanner subprocess exited non-zero. */
export class ScannerCrashError extends SentinelError {
  public readonly code = 'SCANNER_CRASH';
  public readonly remediation =
    'Inspect the scanner stderr in workspaces/<scanId>/deliverables/<scanner>.stderr; re-run with --verbose.';
}

/** Governor CLI query exceeded the 8-hour timeout. */
export class GovernorTimeoutError extends SentinelError {
  public readonly code = 'GOVERNOR_TIMEOUT';
  public readonly remediation =
    'Falling back to mechanical path. Check the governor CLI health or switch providers via SENTINEL_GOVERNOR_CLI.';
}

/** Governor CLI returned output that failed Zod validation. */
export class GovernorInvalidResponseError extends SentinelError {
  public readonly code = 'GOVERNOR_INVALID_RESPONSE';
  public readonly remediation =
    'Falling back to mechanical path. Re-run with --verbose to capture the raw governor response for debugging.';
}

/** Merged config (CLI + YAML + env) failed the Zod schema. */
export class ConfigValidationError extends SentinelError {
  public readonly code = 'CONFIG_VALIDATION';
  public readonly remediation =
    'Fix the highlighted field in sentinel.yaml, the CLI flag, or the environment variable, then re-run.';
}

/** Docker daemon is not reachable during `./sentinel doctor`. */
export class DockerNotRunningError extends SentinelError {
  public readonly code = 'DOCKER_NOT_RUNNING';
  public readonly remediation =
    'Start Docker Desktop (or `sudo systemctl start docker`) and re-run `./sentinel doctor`.';
}
