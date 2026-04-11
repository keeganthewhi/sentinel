import { describe, expect, it } from 'vitest';
import { SchemathesisScanner } from './schemathesis.scanner.js';

const scanner = new SchemathesisScanner();

describe('SchemathesisScanner.parseOutput', () => {
  it('extracts a finding from a single failing testcase', () => {
    const raw = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="schemathesis">
    <testcase name="GET /api/users" classname="schemathesis.api">
      <failure message="Response status 500 not in expected set" type="AssertionError">Stack trace here</failure>
    </testcase>
  </testsuite>
</testsuites>`;
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f?.category).toBe('api');
    expect(f?.severity).toBe('MEDIUM');
    expect(f?.endpoint).toBe('GET /api/users');
    expect(f?.description).toContain('500');
  });

  it('ignores passing testcases', () => {
    const raw = `<?xml version="1.0"?>
<testsuites>
  <testsuite>
    <testcase name="GET /ok"/>
    <testcase name="GET /bad"><failure message="boom" type="E"/></testcase>
  </testsuite>
</testsuites>`;
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.endpoint).toBe('GET /bad');
  });

  it('handles a root-level <testsuite> (no <testsuites> wrapper)', () => {
    const raw = `<?xml version="1.0"?>
<testsuite name="single">
  <testcase name="POST /x"><failure message="f" type="E"/></testcase>
</testsuite>`;
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.endpoint).toBe('POST /x');
  });

  it('returns [] on empty input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('execute() skips cleanly when openApiSpec is undefined', async () => {
    const result = await scanner.execute({
      scanId: 's1',
      targetRepo: '/tmp',
      governed: false,
      scannerTimeoutMs: 1000,
      scannerImage: 'img',
    });
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('schemathesis');
    expect(scanner.phase).toBe(2);
    expect(scanner.requiresUrl).toBe(true);
  });
});
