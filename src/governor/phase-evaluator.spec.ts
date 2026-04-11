import { describe, expect, it, vi } from 'vitest';
import { PhaseEvaluator } from './phase-evaluator.js';
import type { AgentAdapter } from './agent-adapter.js';
import { GovernorInvalidResponseError } from '../common/errors.js';
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

describe('PhaseEvaluator', () => {
  it('parses a valid response into the typed evaluation decision', async () => {
    const response = JSON.stringify({
      escalateToShannon: [{ findingFingerprint: 'fp-1', reason: 'reachable' }],
      discardFindings: [{ findingFingerprint: 'fp-2', reason: 'wordpress on nestjs' }],
      adjustSeverity: [{ findingFingerprint: 'fp-3', newSeverity: 'CRITICAL', reason: 'auth bypass' }],
      notes: 'analysis complete',
    });
    const evaluator = new PhaseEvaluator(adapter(() => Promise.resolve(response)));
    const decision = await evaluator.evaluate({ scanContext: ctx, findings: [], previousDecisions: [] });
    expect(decision.escalateToShannon).toHaveLength(1);
    expect(decision.discardFindings[0]?.findingFingerprint).toBe('fp-2');
    expect(decision.adjustSeverity[0]?.newSeverity).toBe('CRITICAL');
  });

  it('falls back to no-op evaluation on adapter error', async () => {
    const evaluator = new PhaseEvaluator(
      adapter(() => Promise.reject(new GovernorInvalidResponseError('boom'))),
    );
    const decision = await evaluator.evaluate({ scanContext: ctx, findings: [], previousDecisions: [] });
    expect(decision.escalateToShannon).toEqual([]);
    expect(decision.discardFindings).toEqual([]);
    expect(decision.adjustSeverity).toEqual([]);
    expect(decision.notes).toContain('mechanical fallback');
  });

  it('falls back when the response is malformed JSON', async () => {
    const evaluator = new PhaseEvaluator(adapter(() => Promise.resolve('not json at all')));
    const decision = await evaluator.evaluate({ scanContext: ctx, findings: [], previousDecisions: [] });
    expect(decision.notes).toContain('mechanical fallback');
  });

  it('falls back when the response misses required structure', async () => {
    const evaluator = new PhaseEvaluator(
      adapter(() => Promise.resolve('{"escalateToShannon": [{"foo": "bar"}]}')),
    );
    const decision = await evaluator.evaluate({ scanContext: ctx, findings: [], previousDecisions: [] });
    expect(decision.notes).toContain('mechanical fallback');
  });
});
