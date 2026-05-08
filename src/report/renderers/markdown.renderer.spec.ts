import { describe, expect, it } from 'vitest';
import { MarkdownRenderer, type ReportInput } from './markdown.renderer.js';
import type { NormalizedFinding } from '../../scanner/types/finding.interface.js';

const renderer = new MarkdownRenderer();

function make(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'fp',
    title: 'Vulnerable package',
    description: 'Description here',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    cveId: 'CVE-2024-1234',
    filePath: 'package.json',
    lineNumber: 10,
    remediation: 'Upgrade to v2',
    ...overrides,
  };
}

const baseInput: ReportInput = {
  scanId: 'scan-123',
  findings: [],
  durationMs: 12345,
  targetRepo: '/tmp/repo',
};

describe('MarkdownRenderer', () => {
  it('renders a "No findings" banner when the list is empty', () => {
    const out = renderer.render(baseInput);
    expect(out).toContain('# Sentinel Scan Report');
    expect(out).toContain('_No findings._');
  });

  it('renders a summary table with per-severity counts', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [
        make({ severity: 'CRITICAL' }),
        make({ severity: 'HIGH' }),
        make({ severity: 'HIGH' }),
        make({ severity: 'LOW' }),
      ],
    });
    expect(out).toContain('| CRITICAL | 1 |');
    expect(out).toContain('| HIGH | 2 |');
    expect(out).toContain('| LOW | 1 |');
    expect(out).toContain('| **Total** | **4** |');
  });

  it('groups findings by category', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [
        make({ category: 'dependency' }),
        make({ category: 'sast', title: 'SAST finding' }),
      ],
    });
    expect(out).toContain('### dependency (1)');
    expect(out).toContain('### sast (1)');
  });

  it('includes file:line location when present', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [make({ filePath: 'src/x.ts', lineNumber: 42 })],
    });
    expect(out).toContain('src/x.ts:42');
  });

  it('includes target URL when provided', () => {
    const out = renderer.render({ ...baseInput, targetUrl: 'https://example.com' });
    expect(out).toContain('https://example.com');
  });

  it('escapes pipes in markdown cells', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [make({ title: 'pipe | in | title' })],
    });
    expect(out).toContain('pipe \\| in \\| title');
  });

  // Plan 019 — per-tool AI strategist narrate section.

  it('renders the verdict heading when verdict is provided (PASS path)', () => {
    const out = renderer.render({ ...baseInput, verdict: { result: 'PASS', findingCount: 0 } });
    expect(out).toMatch(/## Verdict: PASS/);
  });

  it('renders the verdict heading when verdict is provided (FAIL path)', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [make()],
      verdict: { result: 'FAIL', findingCount: 1 },
    });
    expect(out).toMatch(/## Verdict: FAIL/);
    expect(out).toContain('1 finding(s) require attention');
  });

  it('renders Per-Tool AI Reports section when perToolReports is populated', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [make()],
      perToolReports: {
        semgrep: '# Semgrep narrate body\n\nSome AI prose here.',
        trivy: '# Trivy narrate body\n\nDifferent prose.',
      },
    });
    expect(out).toContain('## Per-Tool AI Reports');
    expect(out).toContain('<summary><strong>semgrep</strong></summary>');
    expect(out).toContain('Semgrep narrate body');
    expect(out).toContain('<summary><strong>trivy</strong></summary>');
    expect(out).toContain('Trivy narrate body');
  });

  it('renders per-tool section even when findings is empty', () => {
    const out = renderer.render({
      ...baseInput,
      perToolReports: { semgrep: '# Empty scan narrate' },
    });
    expect(out).toContain('## Per-Tool AI Reports');
    expect(out).toContain('Empty scan narrate');
  });

  it('omits per-tool section when every report body is whitespace-only', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [make()],
      perToolReports: { semgrep: '   \n\n  ' },
    });
    expect(out).not.toContain('## Per-Tool AI Reports');
  });

  it('orders per-tool sections alphabetically by scanner name', () => {
    const out = renderer.render({
      ...baseInput,
      findings: [make()],
      perToolReports: {
        zap: 'zap body',
        semgrep: 'semgrep body',
        nuclei: 'nuclei body',
      },
    });
    const semgrepIdx = out.indexOf('semgrep');
    const nucleiIdx = out.indexOf('nuclei');
    const zapIdx = out.indexOf('zap');
    expect(nucleiIdx).toBeLessThan(semgrepIdx);
    expect(semgrepIdx).toBeLessThan(zapIdx);
  });
});
