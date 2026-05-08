/**
 * Verdict service — boolean PASS / FAIL after correlation.
 *
 * Per Decision 2 (operator-locked 2026-05-08): NO scoring math, NO
 * CVSS / EPSS / KEV percentages, NO "≥ 95%" threshold. The verdict is
 * a literal boolean.
 *
 * In governed mode, the governor's phase-evaluator has already removed
 * discarded findings from the set before correlation runs. In non-governed
 * mode, every mechanical finding is treated as real. Either way, the
 * decision rule is identical:
 *
 *   PASS iff findings.length === 0
 *   FAIL otherwise
 *
 * The CLI's `--require-clean` flag flips a FAIL verdict into exit code 1
 * for CI gates (operator's stated workflow: "if all tools pass clean, I
 * myself assume 95% safe").
 */

import { Injectable } from '@nestjs/common';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

export interface Verdict {
  readonly result: 'PASS' | 'FAIL';
  readonly findingCount: number;
}

@Injectable()
export class VerdictService {
  public compute(findings: readonly NormalizedFinding[]): Verdict {
    return {
      result: findings.length === 0 ? 'PASS' : 'FAIL',
      findingCount: findings.length,
    };
  }
}
