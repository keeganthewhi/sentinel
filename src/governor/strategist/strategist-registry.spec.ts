import { describe, expect, it, beforeEach } from 'vitest';
import { StrategistRegistry } from './strategist-registry.js';
import { BaseStrategist, type StrategistContext } from './base-strategist.js';
import type {
  ScannerInvocationPlan,
  StrategistIteration,
} from './types/strategist-contract.js';

class FakeStrategist extends BaseStrategist {
  public readonly name: string;
  public readonly scannerName: string;

  constructor(scannerName: string) {
    super();
    this.scannerName = scannerName;
    this.name = `${scannerName}-strategist`;
  }

  public strategize(_ctx: StrategistContext): Promise<ScannerInvocationPlan> {
    return Promise.resolve({
      extraArgs: [],
      severityFloor: 'LOW',
      rationale: 'fake',
      confidence: 'LOW',
    });
  }

  public narrate(
    _ctx: StrategistContext,
    _iterations: readonly StrategistIteration[],
  ): Promise<string> {
    return Promise.resolve('# fake');
  }
}

describe('StrategistRegistry', () => {
  let registry: StrategistRegistry;

  beforeEach(() => {
    registry = new StrategistRegistry();
  });

  it('registers and retrieves a strategist by scanner name', () => {
    const strategist = new FakeStrategist('semgrep');
    registry.register(strategist);
    expect(registry.forScanner('semgrep')).toBe(strategist);
  });

  it('returns undefined for unknown scanner names', () => {
    expect(registry.forScanner('missing')).toBeUndefined();
  });

  it('throws when the same scanner is registered twice', () => {
    registry.register(new FakeStrategist('semgrep'));
    expect(() => {
      registry.register(new FakeStrategist('semgrep'));
    }).toThrow(/already registered/);
  });

  it('returns all strategists in insertion order', () => {
    registry.register(new FakeStrategist('trivy'));
    registry.register(new FakeStrategist('semgrep'));
    registry.register(new FakeStrategist('nuclei'));
    expect(registry.all().map((s) => s.scannerName)).toEqual(['trivy', 'semgrep', 'nuclei']);
  });

  it('clear() empties the registry (test helper)', () => {
    registry.register(new FakeStrategist('trivy'));
    registry.clear();
    expect(registry.all()).toEqual([]);
  });
});
