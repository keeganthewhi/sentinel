import { describe, expect, it } from 'vitest';
import { TruffleHogScanner } from './trufflehog.scanner.js';

const scanner = new TruffleHogScanner();

describe('TruffleHogScanner.parseOutput', () => {
  it('emits a secret finding with HIGH severity when Verified=true', () => {
    const line = JSON.stringify({
      DetectorName: 'AWS',
      Verified: true,
      Raw: 'AKIAIOSFODNN7EXAMPLE',
      SourceMetadata: {
        Data: { Filesystem: { file: '/workspace/src/config.ts', line: 10 } },
      },
    });
    const findings = scanner.parseOutput(line);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.severity).toBe('HIGH');
    expect(f?.category).toBe('secret');
    expect(f?.filePath).toBe('src/config.ts');
    expect(f?.lineNumber).toBe(10);
    expect(f?.title).toContain('AWS');
  });

  it('emits MEDIUM severity when Verified=false', () => {
    const line = JSON.stringify({
      DetectorName: 'Generic',
      Verified: false,
      Raw: 'secret-value',
      SourceMetadata: { Data: { Filesystem: { file: '/workspace/x', line: 1 } } },
    });
    expect(scanner.parseOutput(line)[0]?.severity).toBe('MEDIUM');
  });

  it('NEVER leaks the Raw secret value in the evidence field', () => {
    const line = JSON.stringify({
      DetectorName: 'AWS',
      Verified: true,
      Raw: 'AKIAIOSFODNN7EXAMPLE',
      SourceMetadata: { Data: { Filesystem: { file: '/workspace/x', line: 1 } } },
    });
    const f = scanner.parseOutput(line)[0];
    expect(f?.evidence).toMatch(/^\[REDACTED:[a-f0-9]{16}\]$/);
    expect(JSON.stringify(f)).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('NEVER leaks the Raw secret across multiple records', () => {
    const lines = [
      JSON.stringify({ DetectorName: 'AWS', Verified: true, Raw: 'SECRET_A', SourceMetadata: { Data: { Filesystem: { file: '/workspace/a' } } } }),
      JSON.stringify({ DetectorName: 'GCP', Verified: false, Raw: 'SECRET_B', SourceMetadata: { Data: { Filesystem: { file: '/workspace/b' } } } }),
    ].join('\n');
    const findings = scanner.parseOutput(lines);
    expect(findings).toHaveLength(2);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('SECRET_A');
    expect(serialized).not.toContain('SECRET_B');
    for (const f of findings) {
      expect(f.evidence).toMatch(/^\[REDACTED:[a-f0-9]{16}\]$/);
    }
  });

  it('handles blank lines between records', () => {
    const raw = [
      JSON.stringify({ DetectorName: 'A', Verified: true, Raw: 'x', SourceMetadata: { Data: { Filesystem: { file: '/workspace/a' } } } }),
      '',
      '',
      JSON.stringify({ DetectorName: 'B', Verified: false, Raw: 'y', SourceMetadata: { Data: { Filesystem: { file: '/workspace/b' } } } }),
    ].join('\n');
    expect(scanner.parseOutput(raw)).toHaveLength(2);
  });

  it('returns [] on empty input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('derives fingerprint deterministically from the detector+path+secret hash', () => {
    const line = JSON.stringify({
      DetectorName: 'AWS',
      Verified: true,
      Raw: 'ZZZ',
      SourceMetadata: { Data: { Filesystem: { file: '/workspace/x', line: 1 } } },
    });
    const a = scanner.parseOutput(line)[0]?.fingerprint;
    const b = scanner.parseOutput(line)[0]?.fingerprint;
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('trufflehog');
    expect(scanner.phase).toBe(1);
    expect(scanner.requiresUrl).toBe(false);
  });
});
