import { describe, expect, it } from 'vitest';
import { fingerprint } from './fingerprint.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

function makeFinding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'placeholder',
    title: 'Test finding',
    description: 'Test description',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    cveId: 'CVE-2024-1234',
    filePath: 'src/index.ts',
    lineNumber: 42,
    ...overrides,
  };
}

describe('fingerprint', () => {
  it('produces a hex SHA-256 string', () => {
    const fp = fingerprint(makeFinding());
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic across 1000 iterations (property test)', () => {
    const finding = makeFinding();
    const baseline = fingerprint(finding);
    for (let i = 0; i < 1000; i++) {
      expect(fingerprint(finding)).toBe(baseline);
    }
  });

  it('differs when cveId changes', () => {
    const a = fingerprint(makeFinding({ cveId: 'CVE-2024-1111' }));
    const b = fingerprint(makeFinding({ cveId: 'CVE-2024-2222' }));
    expect(a).not.toBe(b);
  });

  it('differs when filePath changes (location-based axis)', () => {
    // Remove cveId so the file/line axis is used.
    const a = fingerprint(makeFinding({ cveId: undefined, filePath: 'src/a.ts' }));
    const b = fingerprint(makeFinding({ cveId: undefined, filePath: 'src/b.ts' }));
    expect(a).not.toBe(b);
  });

  it('differs when lineNumber changes (location-based axis)', () => {
    const a = fingerprint(makeFinding({ cveId: undefined, lineNumber: 10 }));
    const b = fingerprint(makeFinding({ cveId: undefined, lineNumber: 20 }));
    expect(a).not.toBe(b);
  });

  it('ignores filePath/lineNumber changes when a cveId is present', () => {
    const a = fingerprint(makeFinding({ cveId: 'CVE-2024-1', filePath: 'a.ts', lineNumber: 1 }));
    const b = fingerprint(makeFinding({ cveId: 'CVE-2024-1', filePath: 'b.ts', lineNumber: 99 }));
    expect(a).toBe(b);
  });

  it('is stable when unrelated fields (description) change', () => {
    const a = fingerprint(makeFinding({ description: 'first text' }));
    const b = fingerprint(makeFinding({ description: 'second text' }));
    expect(a).toBe(b);
  });

  it('is scanner-agnostic when CVE/location axes are present (cross-scanner dedup)', () => {
    const a = fingerprint(makeFinding({ scanner: 'trivy' }));
    const b = fingerprint(makeFinding({ scanner: 'semgrep' }));
    expect(a).toBe(b);
  });

  it('falls back to scanner+title when CVE/location/endpoint axes are all empty', () => {
    const a = fingerprint(
      makeFinding({ scanner: 'trivy', title: 't', cveId: undefined, filePath: undefined, lineNumber: undefined, endpoint: undefined }),
    );
    const b = fingerprint(
      makeFinding({ scanner: 'semgrep', title: 't', cveId: undefined, filePath: undefined, lineNumber: undefined, endpoint: undefined }),
    );
    expect(a).not.toBe(b);
  });

  it('handles undefined optional fields', () => {
    const finding = makeFinding({ cveId: undefined, filePath: undefined, lineNumber: undefined });
    expect(() => fingerprint(finding)).not.toThrow();
    expect(fingerprint(finding)).toMatch(/^[a-f0-9]{64}$/);
  });
});
