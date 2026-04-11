import { describe, expect, it } from 'vitest';
import { CorrelationService } from './correlation.service.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

function makeFinding(overrides: Partial<NormalizedFinding>): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'old-placeholder',
    title: 'test',
    description: '',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    ...overrides,
  };
}

describe('CorrelationService', () => {
  const service = new CorrelationService();

  it('leaves unique findings unchanged (1 primary, 0 duplicates)', () => {
    const results = service.correlate([
      makeFinding({ cveId: 'CVE-2024-1', filePath: 'a.ts' }),
      makeFinding({ cveId: 'CVE-2024-2', filePath: 'b.ts' }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((f) => !f.isDuplicate)).toBe(true);
  });

  it('merges two findings sharing the same canonical fingerprint', () => {
    const shared = { cveId: 'CVE-2024-1', filePath: 'a.ts', lineNumber: 10, title: 'same-title' };
    const results = service.correlate([
      makeFinding({ scanner: 'trivy', ...shared }),
      makeFinding({ scanner: 'trivy', ...shared }),
    ]);
    expect(results).toHaveLength(2);
    const primaries = results.filter((f) => !f.isDuplicate);
    const dupes = results.filter((f) => f.isDuplicate);
    expect(primaries).toHaveLength(1);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.correlationId).toBe(primaries[0]?.fingerprint);
  });

  it('picks the primary with the most populated optional fields', () => {
    const sparse = makeFinding({
      cveId: 'CVE-2024-9',
      filePath: 'x.ts',
      lineNumber: 1,
      title: 'same',
    });
    const rich = makeFinding({
      cveId: 'CVE-2024-9',
      filePath: 'x.ts',
      lineNumber: 1,
      title: 'same',
      cweId: 'CWE-79',
      remediation: 'Upgrade',
      evidence: '[REDACTED:abc]',
    });
    const results = service.correlate([sparse, rich]);
    const primary = results.find((f) => !f.isDuplicate);
    expect(primary?.cweId).toBe('CWE-79');
    expect(primary?.remediation).toBe('Upgrade');
  });

  it('records supersedesScanners on the primary', () => {
    const shared = { cveId: 'CVE-2024-5', filePath: 'a.ts', lineNumber: 5, title: 'same' };
    const results = service.correlate([
      makeFinding({ scanner: 'trivy', ...shared }),
      makeFinding({ scanner: 'semgrep', ...shared }),
      makeFinding({ scanner: 'nuclei', ...shared }),
    ]);
    const primary = results.find((f) => !f.isDuplicate);
    expect(primary?.supersedesScanners).toHaveLength(2);
  });

  it('returns empty array on empty input', () => {
    expect(service.correlate([])).toEqual([]);
  });
});
