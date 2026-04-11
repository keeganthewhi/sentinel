/**
 * Shannon scanner — AI-powered DAST exploitation (Phase 3).
 *
 * Shannon is invoked via the detected governor CLI subprocess (claude / codex /
 * gemini) and runs against URLs escalated by the governor's phase-evaluator
 * decision. The actual subprocess invocation is wired in the Phase J CLI
 * bootstrap; this file is the BaseScanner contract + the markdown report parser.
 *
 * Output: a markdown report with sections like
 *   ## Finding 1: <title>
 *   - severity: HIGH
 *   - target: https://example.com/api
 *   - exploitProof: |
 *     <PoC text spanning multiple lines>
 *
 * Per the severity normalizer rule, every Shannon finding is floored at HIGH.
 *
 * NEVER invoke this scanner from src/governor/* — Shannon is a scanner, not a
 * governor decision. The pipeline (src/pipeline/phases/phase-three-exploit.ts)
 * invokes it via the standard scanner runner.
 */

import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';
import { shortHash } from './fingerprint.helper.js';

const SECTION_RE = /^##\s+Finding\s+\d+\s*:\s*(.+)$/m;
const SEVERITY_RE = /^[-*]\s*severity\s*:\s*([A-Za-z]+)/im;
const TARGET_RE = /^[-*]\s*target\s*:\s*(.+)$/im;
const PROOF_BLOCK_RE = /(?:exploit\s*proof|poc)\s*:\s*\|?\s*\n([\s\S]*?)(?=\n##\s|$)/i;

function normalizeSeverity(raw: string | undefined): Severity {
  if (raw === undefined) return 'HIGH';
  const upper = raw.trim().toUpperCase();
  if (upper === 'CRITICAL' || upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW' || upper === 'INFO') {
    return upper;
  }
  return 'HIGH';
}

function extractSections(raw: string): string[] {
  const sections: string[] = [];
  const lines = raw.split('\n');
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^##\s+Finding\s+\d+\s*:/.test(line)) {
      if (current !== null) sections.push(current.join('\n'));
      current = [line];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) sections.push(current.join('\n'));
  return sections;
}

export class ShannonScanner extends BaseScanner {
  public readonly name = 'shannon';
  public readonly phase = 3 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    if (
      context.governorEscalations === undefined ||
      context.governorEscalations.length === 0
    ) {
      return Promise.resolve({
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
      });
    }
    return Promise.resolve({
      scanner: this.name,
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    });
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];
    const findings: NormalizedFinding[] = [];

    for (const section of extractSections(raw)) {
      const titleMatch = SECTION_RE.exec(section);
      if (titleMatch === null) continue;
      const title = titleMatch[1].trim();

      const severityMatch = SEVERITY_RE.exec(section);
      const targetMatch = TARGET_RE.exec(section);
      const proofMatch = PROOF_BLOCK_RE.exec(section);

      const severity = normalizeSeverity(severityMatch?.[1]);
      const target = targetMatch?.[1]?.trim();
      const proofRaw = proofMatch?.[1]?.trim() ?? '';
      const exploitProof = proofRaw === '' ? 'see Shannon report' : proofRaw;

      findings.push({
        scanner: this.name,
        fingerprint: shortHash(`shannon:${title}:${target ?? ''}`),
        title,
        description: `Shannon DAST: ${title}`,
        severity,
        category: 'dast',
        normalizedScore: 0,
        endpoint: target,
        exploitProof,
      });
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
