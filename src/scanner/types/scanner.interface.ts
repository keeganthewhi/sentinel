/**
 * BaseScanner contract + supporting types.
 *
 * Every scanner under `src/scanner/scanners/` extends `BaseScanner`. The
 * contract is frozen at Phase B and must not drift without a deprecation cycle.
 */

import type { AuthConfig } from '../../config/config.schema.js';
import type { DockerExecutor } from '../../execution/docker.executor.js';
import type { NormalizedFinding } from './finding.interface.js';

/** Per-scan data that flows through every phase. Mutated only at phase boundaries. */
export interface ScanContext {
  readonly scanId: string;
  readonly targetRepo: string;
  /**
   * When set, scanners mount this named Docker volume at `/workspace:ro`
   * instead of bind-mounting `targetRepo`. The pipeline populates the volume
   * once before Phase 1 and removes it after the scan finishes. This avoids
   * Docker Desktop's slow 9P host filesystem on Windows — scanner I/O hits
   * a native docker volume instead of the 9P-backed bind mount.
   */
  readonly workspaceVolume?: string;
  readonly targetUrl?: string;
  readonly openApiSpec?: string;
  readonly authentication?: AuthConfig;
  readonly governed: boolean;
  /** Soft timeout for individual scanner runs, in ms. */
  readonly scannerTimeoutMs: number;
  /** Scanner image tag, pulled from `ConfigService.runtime.scannerImage`. */
  readonly scannerImage: string;
  /** Populated by subfinder in Phase 1, consumed by httpx / nuclei / nmap. */
  discoveredSubdomains?: readonly string[];
  /** Populated by httpx in Phase 1, consumed by nuclei / schemathesis. */
  discoveredEndpoints?: readonly string[];
  phase1Findings?: readonly NormalizedFinding[];
  phase2Findings?: readonly NormalizedFinding[];
  /** Populated by governor phase-evaluator in Phase H, consumed by Shannon in Phase I. */
  governorEscalations?: readonly string[];
}

export interface ScannerResult {
  readonly scanner: string;
  readonly findings: readonly NormalizedFinding[];
  /** Raw tool output. NEVER logged by default. Stored truncated (≤ 5 MB) in PhaseRun. */
  readonly rawOutput: string;
  readonly executionTimeMs: number;
  readonly success: boolean;
  /** Populated when success=false. Contains stderr or timeout explanation, never secret values. */
  readonly error?: string;
  readonly timedOut?: boolean;
}

/**
 * Abstract base class for every scanner. Scanners live in `src/scanner/scanners/`
 * as siblings — no scanner imports another scanner. Cross-scanner logic belongs
 * in `src/correlation/`.
 *
 * Each scanner is constructed without a DockerExecutor so the registration array
 * in `scanners/index.ts` stays declarative. The ScannerModule injects the
 * DockerExecutor via `setExecutor()` during `onModuleInit`, before any scan runs.
 * `execute()` reads `this.executor` and skips with a clear error if unset (which
 * only happens in tests that have not wired the runtime path).
 */
export abstract class BaseScanner {
  public abstract readonly name: string;
  public abstract readonly phase: 1 | 2 | 3;
  public abstract readonly requiresUrl: boolean;

  protected executor: DockerExecutor | undefined;

  /** Wire the runtime DockerExecutor. Called once by `ScannerModule.onModuleInit`. */
  public setExecutor(executor: DockerExecutor): void {
    this.executor = executor;
  }

  /**
   * Run the scanner against the given context. MUST NOT throw for
   * tool-crash / timeout / empty output — return `{ success: false, ...}` instead.
   * MAY throw for programmer errors (missing required context, bad config).
   */
  public abstract execute(context: ScanContext): Promise<ScannerResult>;

  /**
   * Parse raw tool output into normalized findings. Pure: same input → same output,
   * no side effects, no filesystem or network.
   */
  public abstract parseOutput(raw: string): readonly NormalizedFinding[];

  /**
   * Check whether the tool binary is present in the scanner image. Used by
   * the `doctor` command to pre-flight a scan.
   */
  public abstract isAvailable(): Promise<boolean>;
}
