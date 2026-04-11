import { describe, expect, it } from 'vitest';
import { normalizeSeverity } from './severity-normalizer.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

function make(overrides: Partial<NormalizedFinding>): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'x',
    title: 't',
    description: '',
    severity: 'MEDIUM',
    category: 'dependency',
    normalizedScore: 0,
    ...overrides,
  };
}

describe('normalizeSeverity', () => {
  it('floors Shannon exploit-confirmed findings at HIGH', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'shannon', severity: 'LOW', exploitProof: 'PoC goes here' }),
    ]);
    expect(result?.severity).toBe('HIGH');
  });

  it('does not lower a CRITICAL when exploit is confirmed', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'shannon', severity: 'CRITICAL', exploitProof: 'PoC' }),
    ]);
    expect(result?.severity).toBe('CRITICAL');
  });

  it('boosts Semgrep taint traces by one level', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'semgrep', severity: 'MEDIUM', description: 'Taint from req.body to db.query' }),
    ]);
    expect(result?.severity).toBe('HIGH');
  });

  it('does not boost Semgrep findings without taint in description', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'semgrep', severity: 'MEDIUM', description: 'Missing return type' }),
    ]);
    expect(result?.severity).toBe('MEDIUM');
  });

  it('reduces Nuclei template matches without exploit proof', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'nuclei', severity: 'HIGH', description: 'Template matched' }),
    ]);
    expect(result?.severity).toBe('MEDIUM');
  });

  it('does not reduce Nuclei when exploit proof is present', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'nuclei', severity: 'HIGH', exploitProof: 'PoC present' }),
    ]);
    expect(result?.severity).toBe('HIGH');
  });

  it('leaves Trivy dependency CVEs unchanged', () => {
    const [result] = normalizeSeverity([
      make({ scanner: 'trivy', severity: 'HIGH', cveId: 'CVE-2024-1' }),
    ]);
    expect(result?.severity).toBe('HIGH');
  });

  it('returns input unchanged for unrelated scanners', () => {
    const input = [
      make({ scanner: 'trufflehog', severity: 'MEDIUM' }),
      make({ scanner: 'nmap', severity: 'INFO' }),
    ];
    const result = normalizeSeverity(input);
    expect(result.map((f) => f.severity)).toEqual(['MEDIUM', 'INFO']);
  });
});
