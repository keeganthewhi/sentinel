/**
 * Stable short hash used by scanner parsers for immediate redaction (TruffleHog).
 *
 * NOT the final fingerprint — Phase F (`src/correlation/fingerprint.ts`) produces
 * the canonical `NormalizedFinding.fingerprint`. This helper exists only so that
 * the TruffleHog parser can replace raw secrets with `[REDACTED:<hash>]` at parse
 * time without leaking the secret into any transient value.
 */

import { createHash } from 'node:crypto';

export function shortHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}
