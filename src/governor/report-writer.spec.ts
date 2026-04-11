import { describe, expect, it, vi } from 'vitest';
import { ReportWriter } from './report-writer.js';
import type { AgentAdapter } from './agent-adapter.js';
import { MarkdownRenderer } from '../report/renderers/markdown.renderer.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';
import type { ScanContext } from '../scanner/types/scanner.interface.js';

const ctx: ScanContext = {
  scanId: 'scan-1',
  targetRepo: '/tmp/repo',
  governed: true,
  scannerTimeoutMs: 1000,
  scannerImage: 'img',
};

function adapter(impl: () => Promise<string>): AgentAdapter {
  return { name: 'claude', bin: 'claude', query: vi.fn().mockImplementation(impl) };
}

function makeFinding(fp: string): NormalizedFinding {
  return {
    scanner: 'trivy',
    fingerprint: fp,
    title: 'CVE-2024',
    description: 'desc',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
  };
}

describe('ReportWriter', () => {
  const renderer = new MarkdownRenderer();

  it('returns the AI markdown when citations are valid', async () => {
    const findings = [makeFinding('fp-1'), makeFinding('fp-2')];
    const goodResponse = JSON.stringify({
      markdown:
        '# Sentinel Report\n\nThis is the AI-authored report citing fp-1 and fp-2 with substantial content.',
      citationFingerprints: ['fp-1', 'fp-2'],
    });
    const writer = new ReportWriter(adapter(() => Promise.resolve(goodResponse)), renderer);
    const result = await writer.write({
      promptInput: { scanContext: ctx, findings, decisions: [] },
      fallbackInput: { scanId: ctx.scanId, findings, durationMs: 100, targetRepo: '/tmp/repo' },
    });
    expect(result.aiAuthored).toBe(true);
    expect(result.markdown).toContain('AI-authored');
  });

  it('falls back to mechanical when adapter throws', async () => {
    const writer = new ReportWriter(
      adapter(() => Promise.reject(new Error('CLI down'))),
      renderer,
    );
    const result = await writer.write({
      promptInput: { scanContext: ctx, findings: [makeFinding('fp-1')], decisions: [] },
      fallbackInput: {
        scanId: ctx.scanId,
        findings: [makeFinding('fp-1')],
        durationMs: 100,
        targetRepo: '/tmp/repo',
      },
    });
    expect(result.aiAuthored).toBe(false);
    expect(result.markdown).toContain('Sentinel Scan Report');
  });

  it('falls back when citations reference unknown fingerprints (hallucination)', async () => {
    const goodResponse = JSON.stringify({
      markdown: '# Report\n\nThis is a long enough markdown to pass the schema length check.',
      citationFingerprints: ['fp-999-not-in-findings'],
    });
    const writer = new ReportWriter(adapter(() => Promise.resolve(goodResponse)), renderer);
    const result = await writer.write({
      promptInput: { scanContext: ctx, findings: [makeFinding('fp-1')], decisions: [] },
      fallbackInput: {
        scanId: ctx.scanId,
        findings: [makeFinding('fp-1')],
        durationMs: 100,
        targetRepo: '/tmp/repo',
      },
    });
    expect(result.aiAuthored).toBe(false);
  });

  it('falls back when the markdown is too short for the schema', async () => {
    const writer = new ReportWriter(
      adapter(() => Promise.resolve(JSON.stringify({ markdown: 'short', citationFingerprints: [] }))),
      renderer,
    );
    const result = await writer.write({
      promptInput: { scanContext: ctx, findings: [], decisions: [] },
      fallbackInput: { scanId: ctx.scanId, findings: [], durationMs: 100, targetRepo: '/tmp/repo' },
    });
    expect(result.aiAuthored).toBe(false);
  });
});
