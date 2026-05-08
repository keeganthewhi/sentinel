import { describe, expect, it, vi } from 'vitest';
import { SemgrepStrategist } from './semgrep.strategist.js';
import type { StrategistContext } from '../base-strategist.js';
import type {
  ScannerInvocationPlan,
  StrategistIteration,
} from '../types/strategist-contract.js';
import { StrategistFailureError } from '../../../common/errors.js';
import type { AgentAdapter } from '../../agent-adapter.js';
import type { ScanContext, ScannerResult } from '../../../scanner/types/scanner.interface.js';

function makeAdapter(responses: string[]): AgentAdapter {
  let i = 0;
  return {
    name: 'claude',
    bin: 'claude',
    query: vi.fn().mockImplementation(() => {
      const next = responses[i];
      i += 1;
      if (next === undefined) return Promise.reject(new Error('exhausted'));
      return Promise.resolve(next);
    }),
  };
}

function makeFailingAdapter(error: Error): AgentAdapter {
  return {
    name: 'claude',
    bin: 'claude',
    query: vi.fn().mockRejectedValue(error),
  };
}

function makeContext(adapter: AgentAdapter): StrategistContext {
  const scanContext = {
    scanId: 'scan-1',
    targetRepo: '/workspace',
    governed: true,
    scannerTimeoutMs: 60_000,
    scannerImage: 'sentinel-scanner:latest',
    discoveredEndpoints: ['https://example.com/login'],
  } as unknown as ScanContext;
  return {
    scanId: 'scan-1',
    scanner: 'semgrep',
    adapter,
    scanContext,
  };
}

const VALID_PLAN_JSON = JSON.stringify({
  extraArgs: ['--config', 'p/security-audit'],
  severityFloor: 'MEDIUM',
  rationale: 'Auth-heavy NestJS — broaden ruleset.',
  confidence: 'HIGH',
});

const VALID_REPLAY_STOP_JSON = JSON.stringify({
  action: 'stop',
  rationale: 'No new vectors to try.',
});

const VALID_REPLAY_REPLAY_JSON = JSON.stringify({
  action: 'replay',
  nextPlan: {
    extraArgs: ['--config', 'p/owasp-top-ten'],
    severityFloor: 'LOW',
    rationale: 'Rotate to OWASP rule pack.',
    confidence: 'MEDIUM',
  },
  rationale: 'No findings on default; try OWASP rules.',
});

describe('SemgrepStrategist.strategize', () => {
  it('parses a valid ScannerInvocationPlan from the adapter', async () => {
    const adapter = makeAdapter([VALID_PLAN_JSON]);
    const strategist = new SemgrepStrategist();
    const plan = await strategist.strategize(makeContext(adapter));
    expect(plan.severityFloor).toBe('MEDIUM');
    expect(plan.confidence).toBe('HIGH');
    expect(plan.extraArgs).toEqual(['--config', 'p/security-audit']);
  });

  it('throws StrategistFailureError on malformed JSON', async () => {
    const adapter = makeAdapter(['this is not json']);
    const strategist = new SemgrepStrategist();
    await expect(strategist.strategize(makeContext(adapter))).rejects.toBeInstanceOf(
      StrategistFailureError,
    );
  });

  it('throws StrategistFailureError when the adapter rejects', async () => {
    const adapter = makeFailingAdapter(new Error('CLI timeout'));
    const strategist = new SemgrepStrategist();
    await expect(strategist.strategize(makeContext(adapter))).rejects.toBeInstanceOf(
      StrategistFailureError,
    );
  });
});

describe('SemgrepStrategist.replay', () => {
  const samplePlan: ScannerInvocationPlan = {
    extraArgs: [],
    severityFloor: 'LOW',
    rationale: 'first attempt',
    confidence: 'MEDIUM',
  };

  function makeIteration(num: number): StrategistIteration {
    return {
      iteration: num,
      plan: samplePlan,
      findingsCount: 0,
      executionTimeMs: 1_000,
      success: true,
    };
  }

  function makeResult(findings = 0): ScannerResult {
    return {
      scanner: 'semgrep',
      findings: Array.from({ length: findings }, (_, i) => ({
        scanner: 'semgrep',
        fingerprint: `fp-${i}`,
        title: 't',
        description: 'd',
        severity: 'LOW' as const,
        category: 'sast' as const,
        normalizedScore: 0,
      })),
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    };
  }

  it('stops immediately when last result produced findings', async () => {
    const adapter = makeAdapter([]);
    const strategist = new SemgrepStrategist();
    const decision = await strategist.replay(makeContext(adapter), [makeIteration(1)], makeResult(5));
    expect(decision.action).toBe('stop');
    // Adapter must NOT have been called — stop short-circuits.
    expect((adapter.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('stops when budget exhausted (3 iterations)', async () => {
    const adapter = makeAdapter([]);
    const strategist = new SemgrepStrategist();
    const decision = await strategist.replay(
      makeContext(adapter),
      [makeIteration(1), makeIteration(2), makeIteration(3)],
      makeResult(0),
    );
    expect(decision.action).toBe('stop');
    expect(decision.rationale).toMatch(/budget/i);
  });

  it('queries adapter for replay when budget remains and last had no findings', async () => {
    const adapter = makeAdapter([VALID_REPLAY_REPLAY_JSON]);
    const strategist = new SemgrepStrategist();
    const decision = await strategist.replay(makeContext(adapter), [makeIteration(1)], makeResult(0));
    expect(decision.action).toBe('replay');
    if (decision.action === 'replay') {
      expect(decision.nextPlan?.extraArgs).toEqual(['--config', 'p/owasp-top-ten']);
    }
  });

  it('parses adapter stop response correctly', async () => {
    const adapter = makeAdapter([VALID_REPLAY_STOP_JSON]);
    const strategist = new SemgrepStrategist();
    const decision = await strategist.replay(makeContext(adapter), [makeIteration(1)], makeResult(0));
    expect(decision.action).toBe('stop');
  });

  it('throws StrategistFailureError on malformed adapter JSON', async () => {
    const adapter = makeAdapter(['{ not parseable']);
    const strategist = new SemgrepStrategist();
    await expect(
      strategist.replay(makeContext(adapter), [makeIteration(1)], makeResult(0)),
    ).rejects.toBeInstanceOf(StrategistFailureError);
  });
});

describe('SemgrepStrategist.narrate', () => {
  const sampleIteration: StrategistIteration = {
    iteration: 1,
    plan: {
      extraArgs: [],
      severityFloor: 'LOW',
      rationale: 'default',
      confidence: 'LOW',
    },
    findingsCount: 3,
    executionTimeMs: 12_345,
    success: true,
  };

  it('returns adapter prose when adapter succeeds', async () => {
    const adapter = makeAdapter(['# Semgrep results\n\nThree findings.']);
    const strategist = new SemgrepStrategist();
    const md = await strategist.narrate(makeContext(adapter), [sampleIteration]);
    expect(md).toMatch(/Semgrep results/);
  });

  it('falls back to mechanical summary on adapter failure (does NOT throw)', async () => {
    const adapter = makeFailingAdapter(new Error('CLI down'));
    const strategist = new SemgrepStrategist();
    const md = await strategist.narrate(makeContext(adapter), [sampleIteration]);
    expect(md).toMatch(/mechanical fallback/i);
    expect(md).toMatch(/Iterations: 1/);
    expect(md).toMatch(/Total findings: 3/);
  });

  it('falls back to mechanical summary when adapter returns empty output', async () => {
    const adapter = makeAdapter(['']);
    const strategist = new SemgrepStrategist();
    const md = await strategist.narrate(makeContext(adapter), [sampleIteration]);
    expect(md).toMatch(/mechanical fallback/i);
  });
});
