import { describe, expect, it } from 'vitest';
import { SemgrepScanner } from './semgrep.scanner.js';

const scanner = new SemgrepScanner();

describe('SemgrepScanner.parseOutput', () => {
  it('emits a sast finding per result row', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'javascript.lang.security.audit.sql-injection',
          path: '/workspace/src/db.ts',
          start: { line: 42, col: 10 },
          end: { line: 42, col: 60 },
          extra: {
            severity: 'ERROR',
            message: 'Possible SQL injection via string concatenation',
          },
        },
      ],
      errors: [],
    });
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.category).toBe('sast');
    expect(f?.severity).toBe('HIGH');
    expect(f?.filePath).toBe('src/db.ts');
    expect(f?.lineNumber).toBe(42);
    expect(f?.title).toContain('sql-injection');
  });

  it('maps WARNING to MEDIUM and INFO to LOW', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'warn-rule',
          path: '/workspace/a.ts',
          start: { line: 1 },
          extra: { severity: 'WARNING', message: 'warn' },
        },
        {
          check_id: 'info-rule',
          path: '/workspace/b.ts',
          start: { line: 2 },
          extra: { severity: 'INFO', message: 'info' },
        },
      ],
    });
    const findings = scanner.parseOutput(raw);
    expect(findings[0]?.severity).toBe('MEDIUM');
    expect(findings[1]?.severity).toBe('LOW');
  });

  it('ignores unknown top-level keys (passthrough)', () => {
    const raw = JSON.stringify({
      results: [
        { check_id: 'r', path: '/workspace/x.ts', start: { line: 1 }, extra: { severity: 'ERROR' } },
      ],
      errors: [],
      schemaVersion: '2.0.0',
      telemetry: { foo: 'bar' },
    });
    expect(scanner.parseOutput(raw)).toHaveLength(1);
  });

  it('does NOT store metavars or other user-code fields in evidence', () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: 'r',
          path: '/workspace/x.ts',
          start: { line: 1 },
          extra: {
            severity: 'ERROR',
            message: 'msg',
            metavars: { $X: { abstract_content: 'secret_from_user_code' } },
          },
        },
      ],
    });
    const f = scanner.parseOutput(raw)[0];
    expect(f?.evidence).toBeUndefined();
  });

  it('returns [] on empty input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('returns [] on empty results array', () => {
    expect(scanner.parseOutput(JSON.stringify({ results: [] }))).toEqual([]);
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('semgrep');
    expect(scanner.phase).toBe(1);
    expect(scanner.requiresUrl).toBe(false);
  });
});
