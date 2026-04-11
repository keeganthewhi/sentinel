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
});
