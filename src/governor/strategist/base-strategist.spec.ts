import { describe, expect, it } from 'vitest';
import { BaseStrategist, type StrategistContext } from './base-strategist.js';
import type {
  ScannerInvocationPlan,
  StrategistIteration,
} from './types/strategist-contract.js';
import type { ScannerResult } from '../../scanner/types/scanner.interface.js';

class StubStrategist extends BaseStrategist {
  public readonly name = 'stub';
  public readonly scannerName = 'stub';

  public strategize(_ctx: StrategistContext): Promise<ScannerInvocationPlan> {
    return Promise.resolve({
      extraArgs: [],
      severityFloor: 'LOW',
      rationale: 'stub',
      confidence: 'LOW',
    });
  }

  public narrate(
    _ctx: StrategistContext,
    _iterations: readonly StrategistIteration[],
  ): Promise<string> {
    return Promise.resolve('# stub');
  }
}

describe('BaseStrategist default replay', () => {
  it('returns action="stop" with a non-empty rationale', async () => {
    const strategist = new StubStrategist();

    // The default replay implementation does not consult ctx, previous, or
    // lastResult — but the signatures still demand them. We pass minimal
    // fakes that satisfy the types without exercising any code path.
    const ctx = { scanId: 's1', scanner: 'stub' } as unknown as StrategistContext;
    const previous: readonly StrategistIteration[] = [];
    const lastResult: ScannerResult = {
      scanner: 'stub',
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    };

    const decision = await strategist.replay(ctx, previous, lastResult);

    expect(decision.action).toBe('stop');
    expect(decision.rationale.length).toBeGreaterThan(0);
  });
});
