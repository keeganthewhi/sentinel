import { describe, expect, it } from 'vitest';
import { PdfRenderer } from './pdf.renderer.js';
import type { ReportInput } from './markdown.renderer.js';
import type { NormalizedFinding } from '../../scanner/types/finding.interface.js';

const renderer = new PdfRenderer();

function make(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: 'fp',
    title: 'x',
    description: 'y',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    ...overrides,
  };
}

const baseInput: ReportInput = {
  scanId: 'scan-1',
  findings: [],
  durationMs: 100,
  targetRepo: '/tmp/repo',
};

describe('PdfRenderer', () => {
  it('builds a docDefinition with content array', () => {
    const def = renderer.buildDocDefinition(baseInput);
    expect(Array.isArray(def.content)).toBe(true);
    expect(def.content.length).toBeGreaterThan(0);
  });

  it('includes styles and defaultStyle', () => {
    const def = renderer.buildDocDefinition(baseInput);
    expect(def.styles).toBeDefined();
    expect(def.defaultStyle).toBeDefined();
  });

  it('shows "No findings" when the list is empty', () => {
    const def = renderer.buildDocDefinition(baseInput);
    const noFindings = def.content.some(
      (c) => typeof c === 'object' && c !== null && 'text' in c && (c as { text: unknown }).text === 'No findings.',
    );
    expect(noFindings).toBe(true);
  });

  it('adds a block per finding when findings exist', () => {
    const def = renderer.buildDocDefinition({
      ...baseInput,
      findings: [make({ title: 'a' }), make({ title: 'b' })],
    });
    // Count items with `style: 'finding'`
    const findingBlocks = def.content.filter(
      (c) => typeof c === 'object' && c !== null && 'style' in c && (c as { style: string }).style === 'finding',
    );
    expect(findingBlocks.length).toBe(2);
  });
});
