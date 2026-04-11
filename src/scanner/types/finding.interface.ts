/**
 * In-memory shape for a normalized finding, produced by a scanner's
 * `parseOutput()` method and consumed by correlation, governor, and reporting.
 *
 * The DB row shape (added in Phase G / Prisma) is a superset of this interface —
 * it adds `id`, `correlationId`, `isRegression`, `governorAction`, `createdAt`.
 * Keep those persistence concerns out of this file.
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = Object.freeze({
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
});

export type FindingCategory =
  | 'dependency'
  | 'secret'
  | 'iac'
  | 'sast'
  | 'network'
  | 'api'
  | 'dast'
  | 'misconfig'
  | 'other';

export interface NormalizedFinding {
  /** Scanner name that produced the finding (trivy, semgrep, ...). */
  readonly scanner: string;
  /** SHA-256 hex, stable across runs. Computed by `fingerprint(finding)` in Phase F. */
  readonly fingerprint: string;
  /** Short, human-readable title. */
  readonly title: string;
  /** Longer description from the scanner. */
  readonly description: string;
  readonly severity: Severity;
  readonly category: FindingCategory;
  /** Mechanical base score before governor adjustment. 0 when the scanner gives no numeric score. */
  readonly normalizedScore: number;
  readonly cveId?: string;
  readonly cweId?: string;
  /** Repo-relative path — NEVER absolute. Strip the container mount prefix in the parser. */
  readonly filePath?: string;
  readonly lineNumber?: number;
  /** URL or `tcp/22` style port label for network/api findings. */
  readonly endpoint?: string;
  /** Truncated. TruffleHog `Raw` is replaced with `[REDACTED:<fingerprint>]` here. */
  readonly evidence?: string;
  /** Shannon exploitation proof-of-concept (Phase I). Never populated by mechanical scanners. */
  readonly exploitProof?: string;
  readonly remediation?: string;
}
