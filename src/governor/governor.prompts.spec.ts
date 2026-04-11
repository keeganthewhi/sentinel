import { describe, expect, it } from 'vitest';
import {
  buildEvaluationPrompt,
  buildReportPrompt,
  buildScanPlanPrompt,
} from './governor.prompts.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';
import type { ScanContext } from '../scanner/types/scanner.interface.js';

const ctx: ScanContext = {
  scanId: 'scan-1',
  targetRepo: '/tmp/repo',
  governed: true,
  scannerTimeoutMs: 1000,
  scannerImage: 'sentinel-scanner:latest',
};

function makeFinding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'fp-1',
    title: 'CVE-2024-1',
    description: 'desc',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    ...overrides,
  };
}

describe('governor.prompts', () => {
  it('buildScanPlanPrompt embeds the SYSTEM layer and a delimited user content block', () => {
    const prompt = buildScanPlanPrompt({
      fileTreeDigest: ['package.json', 'src/main.ts'],
      packageJson: { name: 'sentinel' },
      targetRepo: '/tmp/repo',
    });
    expect(prompt).toContain('--- SYSTEM ---');
    expect(prompt).toContain('--- END SYSTEM ---');
    expect(prompt).toContain('<<<USER_CONTENT:scan_plan_input>>>');
    expect(prompt).toContain('<<<END_USER_CONTENT:scan_plan_input>>>');
    expect(prompt).toContain('"sentinel"');
  });

  it('buildEvaluationPrompt redacts any field literally named "Raw" or "raw"', () => {
    const prompt = buildEvaluationPrompt({
      scanContext: ctx,
      findings: [makeFinding({ evidence: '[REDACTED:abc123]' })],
      previousDecisions: [{ Raw: 'should-not-appear', other: 'visible' }],
    });
    expect(prompt).not.toContain('should-not-appear');
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).toContain('visible');
  });

  it('buildEvaluationPrompt embeds the SYSTEM layer', () => {
    const prompt = buildEvaluationPrompt({
      scanContext: ctx,
      findings: [makeFinding()],
      previousDecisions: [],
    });
    expect(prompt).toContain('--- SYSTEM ---');
    expect(prompt).toContain('Decision: evaluation');
  });

  it('buildReportPrompt includes the findings array', () => {
    const prompt = buildReportPrompt({
      scanContext: ctx,
      findings: [makeFinding({ fingerprint: 'unique-fp-xyz' })],
      decisions: [],
    });
    expect(prompt).toContain('unique-fp-xyz');
    expect(prompt).toContain('Decision: report');
  });

  it('redact handles arbitrarily nested "raw" keys (defense in depth)', () => {
    const prompt = buildEvaluationPrompt({
      scanContext: ctx,
      findings: [makeFinding()],
      previousDecisions: [{ outer: { inner: { raw: 'leaked-secret-value' } } }],
    });
    expect(prompt).not.toContain('leaked-secret-value');
  });

  it('redact handles arrays that contain raw fields', () => {
    const prompt = buildEvaluationPrompt({
      scanContext: ctx,
      findings: [makeFinding()],
      previousDecisions: [[{ raw: 'array-secret' }]],
    });
    expect(prompt).not.toContain('array-secret');
  });
});
