import { describe, expect, it } from 'vitest';
import { VerdictService } from './verdict.service.js';
import type { NormalizedFinding, Severity } from '../scanner/types/finding.interface.js';

function f(severity: Severity = 'LOW'): NormalizedFinding {
  return {
    scanner: 'test',
    fingerprint: `fp-${Math.random()}`,
    title: 't',
    description: 'd',
    severity,
    category: 'sast',
    normalizedScore: 0,
  };
}

describe('VerdictService', () => {
  const service = new VerdictService();

  it('returns PASS on zero findings', () => {
    expect(service.compute([])).toEqual({ result: 'PASS', findingCount: 0 });
  });

  it('returns FAIL on a single finding (regardless of severity)', () => {
    expect(service.compute([f('LOW')])).toEqual({ result: 'FAIL', findingCount: 1 });
    expect(service.compute([f('CRITICAL')])).toEqual({ result: 'FAIL', findingCount: 1 });
  });

  it('returns FAIL with the right count on a mixed set', () => {
    const findings = [f('LOW'), f('MEDIUM'), f('HIGH'), f('CRITICAL'), f('INFO')];
    expect(service.compute(findings)).toEqual({ result: 'FAIL', findingCount: 5 });
  });

  it('is deterministic — same inputs produce the same verdict', () => {
    const findings = [f('LOW'), f('HIGH')];
    const a = service.compute(findings);
    const b = service.compute(findings);
    expect(a).toEqual(b);
  });

  it('NEVER includes a third value or a numeric score field', () => {
    const verdict = service.compute([f('LOW')]);
    // Type-narrowing assertion — verdict.result is exactly 'PASS' | 'FAIL'.
    const result: 'PASS' | 'FAIL' = verdict.result;
    expect(['PASS', 'FAIL']).toContain(result);
    // Verdict shape is exactly { result, findingCount } — no score / percent / cvss etc.
    expect(Object.keys(verdict).sort()).toEqual(['findingCount', 'result']);
  });
});
