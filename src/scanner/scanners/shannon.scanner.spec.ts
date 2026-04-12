import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShannonScanner } from './shannon.scanner.js';

const scanner = new ShannonScanner();

describe('ShannonScanner', () => {
  it('parseOutput returns [] for empty input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('parses two findings from a Shannon markdown report', () => {
    const raw = `# Shannon Report

## Finding 1: SQL Injection in /api/users
- severity: HIGH
- target: https://staging.example.com/api/users?id=1
- exploit proof: |
  curl 'https://staging.example.com/api/users?id=1%27+OR+1%3D1--'
  Response: 500 with full DB error trace.

## Finding 2: Reflected XSS in /search
- severity: MEDIUM
- target: https://staging.example.com/search?q=<script>
- exploit proof: |
  Payload <script>alert(1)</script> reflected unescaped in response body.
`;
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(2);
    const [f1, f2] = findings;
    expect(f1?.title).toContain('SQL Injection');
    expect(f1?.severity).toBe('HIGH');
    expect(f1?.endpoint).toContain('staging.example.com/api/users');
    expect(f1?.exploitProof).toContain('OR+1%3D1');
    expect(f2?.title).toContain('XSS');
    expect(f2?.severity).toBe('MEDIUM');
    expect(f2?.exploitProof).toContain('<script>alert(1)</script>');
  });

  it('every finding carries an exploitProof field', () => {
    const raw = `## Finding 1: Test
- severity: HIGH
- target: https://x
- exploit proof: |
  PoC text
`;
    const findings = scanner.parseOutput(raw);
    expect(findings[0]?.exploitProof).toBe('PoC text');
  });

  it('defaults severity to HIGH when missing or unknown', () => {
    const raw = `## Finding 1: Untyped
- target: https://y
`;
    expect(scanner.parseOutput(raw)[0]?.severity).toBe('HIGH');
  });

  describe('execute()', () => {
    // Point at a nonexistent SHANNON_DIR so execute() short-circuits on the
    // `existsSync(shannonCli)` check — we don't want unit tests to actually
    // spawn the real shannon CLI subprocess.
    beforeEach(() => {
      process.env.SHANNON_DIR = '/nonexistent-shannon-dir-for-tests';
    });
    afterEach(() => {
      delete process.env.SHANNON_DIR;
    });

    it('returns failure result when the shannon CLI is not installed', async () => {
      const result = await scanner.execute({
        scanId: 's1',
        targetRepo: '/tmp',
        governed: true,
        scannerTimeoutMs: 1000,
        scannerImage: 'img',
      });
      expect(result.success).toBe(false);
      expect(result.findings).toEqual([]);
      expect(result.error).toContain('shannon CLI not found');
    });

    it('still attempts when targetUrl is missing (code-only mode)', async () => {
      // No targetUrl → scanner uses 'code-only' internally but still tries
      // to spawn shannon. Since SHANNON_DIR is bogus in this test, we hit
      // the CLI-not-found short-circuit, which is fine — the point is that
      // the scanner did NOT early-return on missing targetUrl.
      const result = await scanner.execute({
        scanId: 's1',
        targetRepo: '/tmp',
        governed: true,
        scannerTimeoutMs: 1000,
        scannerImage: 'img',
      });
      expect(result.error).toContain('shannon CLI not found');
      expect(result.error).not.toContain('requires targetUrl');
    });
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('shannon');
    expect(scanner.phase).toBe(3);
    expect(scanner.requiresUrl).toBe(true);
  });
});
