import { describe, expect, it } from 'vitest';
import { NucleiScanner } from './nuclei.scanner.js';

const scanner = new NucleiScanner();

describe('NucleiScanner.parseOutput', () => {
  it('emits a dast finding with severity mapping', () => {
    const raw = JSON.stringify({
      'template-id': 'cve-2024-1234',
      info: {
        name: 'Example RCE',
        severity: 'critical',
        description: 'Remote code execution',
        classification: { 'cve-id': 'CVE-2024-1234', 'cwe-id': ['CWE-78'] },
      },
      'matched-at': 'https://target.example.com/api/v1/echo',
      host: 'target.example.com',
      type: 'http',
    });
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.category).toBe('dast');
    expect(f?.severity).toBe('CRITICAL');
    expect(f?.endpoint).toBe('https://target.example.com/api/v1/echo');
    expect(f?.cveId).toBe('CVE-2024-1234');
    expect(f?.cweId).toBe('CWE-78');
    expect(f?.title).toBe('Example RCE');
  });

  it('maps lowercase severity values', () => {
    const lines = [
      JSON.stringify({ 'template-id': 'a', info: { severity: 'high', name: 'a' }, 'matched-at': 'x' }),
      JSON.stringify({ 'template-id': 'b', info: { severity: 'medium', name: 'b' }, 'matched-at': 'y' }),
      JSON.stringify({ 'template-id': 'c', info: { severity: 'low', name: 'c' }, 'matched-at': 'z' }),
      JSON.stringify({ 'template-id': 'd', info: { severity: 'info', name: 'd' }, 'matched-at': 'w' }),
    ].join('\n');
    const findings = scanner.parseOutput(lines);
    expect(findings.map((f) => f.severity)).toEqual(['HIGH', 'MEDIUM', 'LOW', 'INFO']);
  });

  it('handles unknown severity by defaulting to INFO', () => {
    const line = JSON.stringify({
      'template-id': 'x',
      info: { severity: 'obscure', name: 'x' },
      'matched-at': 'y',
    });
    expect(scanner.parseOutput(line)[0]?.severity).toBe('INFO');
  });

  it('returns [] on empty input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('handles classification.cve-id as a plain string (not array)', () => {
    const line = JSON.stringify({
      'template-id': 'x',
      info: { severity: 'high', classification: { 'cve-id': 'CVE-2024-9999' } },
      'matched-at': 'z',
    });
    expect(scanner.parseOutput(line)[0]?.cveId).toBe('CVE-2024-9999');
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('nuclei');
    expect(scanner.phase).toBe(2);
    expect(scanner.requiresUrl).toBe(true);
  });
});
