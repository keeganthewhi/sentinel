/**
 * Drift-lock spec for the boolean verdict engine (plan 020 / Decision 2).
 *
 * Decision 2 (operator-locked 2026-05-08): the verdict is BOOLEAN ONLY —
 * no CVSS / EPSS / KEV percentages, no "≥ 95%" threshold, no third state.
 *
 * This spec walks `verdict.service.ts` source and asserts that no scoring
 * vocabulary leaks in. Catches a future regression toward numeric scoring
 * before it ships.
 *
 * Comments are stripped before the keyword scan so legitimate doc-comments
 * referencing "score" or "95" do not trip the gate (the JSDoc explicitly
 * documents the rejection rationale and would otherwise self-trigger).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VERDICT_SRC = readFileSync(
  join(__dirname, '..', '..', 'correlation', 'verdict.service.ts'),
  'utf8',
);

/** Strip line + block comments before scanning for forbidden vocabulary. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const CODE_ONLY = stripComments(VERDICT_SRC);

const FORBIDDEN_KEYWORDS: readonly string[] = [
  'cvss',
  'epss',
  'kev',
  'percent',
  'percentage',
  'threshold',
  'normalizedScore',
];

describe('verdict engine drift-lock (plan 020 / Decision 2)', () => {
  for (const keyword of FORBIDDEN_KEYWORDS) {
    it(`source does not reference '${keyword}'`, () => {
      const re = new RegExp(keyword, 'i');
      expect(re.exec(CODE_ONLY)).toBeNull();
    });
  }

  it('Verdict.result is a literal union of PASS | FAIL only', () => {
    expect(VERDICT_SRC).toMatch(/result:\s*'PASS'\s*\|\s*'FAIL'/);
  });

  it('returns the literal PASS or FAIL', () => {
    expect(VERDICT_SRC).toMatch(/result:\s*findings\.length\s*===\s*0\s*\?\s*'PASS'\s*:\s*'FAIL'/);
  });

  it('does not import or compute any threshold / score numeric value', () => {
    // No bare number literals other than 0 (the only legal compare target).
    const numericLiterals = CODE_ONLY.match(/[^a-zA-Z_]\d{2,}[^a-zA-Z_]/g) ?? [];
    expect(numericLiterals).toEqual([]);
  });
});
