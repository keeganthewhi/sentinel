/**
 * CorrelationService — groups findings by fingerprint, selects the primary,
 * and marks duplicates with `correlationId` linking back to the primary.
 *
 * Primary selection rule: the finding with the most populated optional fields
 * wins. On a tie, the first-seen (stable insertion order) wins.
 */

import { Injectable } from '@nestjs/common';
import { fingerprint } from './fingerprint.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

export interface CorrelatedFinding extends NormalizedFinding {
  readonly isDuplicate: boolean;
  readonly correlationId?: string;
  readonly supersedesScanners: readonly string[];
}

interface Group {
  readonly key: string;
  readonly entries: NormalizedFinding[];
}

const OPTIONAL_FIELDS: readonly (keyof NormalizedFinding)[] = [
  'cveId',
  'cweId',
  'filePath',
  'lineNumber',
  'endpoint',
  'evidence',
  'exploitProof',
  'remediation',
];

function richness(finding: NormalizedFinding): number {
  let score = 0;
  for (const field of OPTIONAL_FIELDS) {
    if (finding[field] !== undefined) score++;
  }
  return score;
}

function pickPrimaryIndex(entries: readonly NormalizedFinding[]): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < entries.length; i++) {
    const f = entries[i];
    const score = richness(f);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

@Injectable()
export class CorrelationService {
  public correlate(findings: readonly NormalizedFinding[]): readonly CorrelatedFinding[] {
    const groupMap = new Map<string, Group>();
    // Normalise fingerprints: if the scanner already set one (short hash), recompute to
    // the canonical SHA-256 value so correlation is deterministic across scanners.
    const withCanonicalFp: NormalizedFinding[] = findings.map((f) => ({
      ...f,
      fingerprint: fingerprint(f),
    }));

    for (const finding of withCanonicalFp) {
      const group = groupMap.get(finding.fingerprint);
      if (group === undefined) {
        groupMap.set(finding.fingerprint, { key: finding.fingerprint, entries: [finding] });
      } else {
        group.entries.push(finding);
      }
    }

    const correlated: CorrelatedFinding[] = [];
    for (const group of groupMap.values()) {
      const primaryIdx = pickPrimaryIndex(group.entries);
      const primary = group.entries[primaryIdx];
      const supersedesScanners = group.entries
        .filter((_, i) => i !== primaryIdx)
        .map((f) => f.scanner);

      correlated.push({
        ...primary,
        isDuplicate: false,
        supersedesScanners,
      });

      for (let i = 0; i < group.entries.length; i++) {
        if (i === primaryIdx) continue;
        const duplicate = group.entries[i];
        correlated.push({
          ...duplicate,
          isDuplicate: true,
          correlationId: primary.fingerprint,
          supersedesScanners: [],
        });
      }
    }

    return correlated;
  }
}
