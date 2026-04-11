/**
 * Deterministic SHA-256 fingerprint for a NormalizedFinding.
 *
 * Critical invariant #8 (CLAUDE.md): same finding → same hash, always.
 * Non-determinism invalidates dedup, correlation, and regression detection.
 *
 * Fingerprint axis (BLUEPRINT SM-28): the FIRST available of
 *   1. `cveId`                         — cross-scanner CVE dedup
 *   2. `filePath + ':' + lineNumber`   — file-anchored finding
 *   3. `endpoint + ':' + category`     — network/API finding
 *   4. `scanner + ':' + title`          — last-resort tie-breaker
 *
 * Cross-scanner correlation relies on the first three axes being scanner-agnostic.
 * The final axis keeps otherwise-identical scanner messages distinct when none of
 * the location/CVE axes are populated.
 */

import { createHash } from 'node:crypto';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

const PREFIX = {
  cve: 'cve:',
  loc: 'loc:',
  endpoint: 'endpoint:',
  fallback: 'fallback:',
} as const;

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function deriveAxis(finding: NormalizedFinding): string {
  if (nonEmpty(finding.cveId)) {
    return `${PREFIX.cve}${finding.cveId}`;
  }
  if (nonEmpty(finding.filePath)) {
    const line = finding.lineNumber ?? 0;
    return `${PREFIX.loc}${finding.filePath}:${line}`;
  }
  if (nonEmpty(finding.endpoint)) {
    return `${PREFIX.endpoint}${finding.endpoint}:${finding.category}`;
  }
  return `${PREFIX.fallback}${finding.scanner}:${finding.title}`;
}

export function fingerprint(finding: NormalizedFinding): string {
  const axis = deriveAxis(finding);
  return createHash('sha256').update(axis, 'utf8').digest('hex');
}
