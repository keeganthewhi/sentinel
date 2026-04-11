import { describe, expect, it } from 'vitest';
import { JsonRenderer } from './json.renderer.js';
import type { ReportInput } from './markdown.renderer.js';
import type { NormalizedFinding } from '../../scanner/types/finding.interface.js';

const renderer = new JsonRenderer();

function make(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'fp',
    title: 'f',
    description: '',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    ...overrides,
  };
}

const baseInput: ReportInput = {
  scanId: 'scan-1',
  findings: [],
  durationMs: 100,
  targetRepo: '/tmp/repo',
};

describe('JsonRenderer', () => {
  it('returns a stable report object', () => {
    const report = renderer.render({
      ...baseInput,
      findings: [make({ severity: 'HIGH' }), make({ severity: 'LOW' })],
    });
    expect(report.summary.total).toBe(2);
    expect(report.summary.bySeverity.HIGH).toBe(1);
    expect(report.summary.bySeverity.LOW).toBe(1);
    expect(report.findings).toHaveLength(2);
  });

  it('stringify output is valid JSON', () => {
    const str = renderer.stringify({ ...baseInput, findings: [make()] });
    expect(() => {
      JSON.parse(str);
    }).not.toThrow();
  });

  it('includes targetUrl only when set', () => {
    const without = renderer.render(baseInput);
    expect(without).not.toHaveProperty('targetUrl');
    const withUrl = renderer.render({ ...baseInput, targetUrl: 'https://x' });
    expect(withUrl.targetUrl).toBe('https://x');
  });

  it('empty findings produce zero counts across severities', () => {
    const report = renderer.render(baseInput);
    expect(report.summary.total).toBe(0);
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const) {
      expect(report.summary.bySeverity[severity]).toBe(0);
    }
  });
});
