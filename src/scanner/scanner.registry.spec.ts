import { describe, expect, it, beforeEach } from 'vitest';
import { ScannerRegistry } from './scanner.registry.js';
import { BaseScanner, type ScanContext, type ScannerResult } from './types/scanner.interface.js';
import type { NormalizedFinding } from './types/finding.interface.js';

class FakeScanner extends BaseScanner {
  public readonly name: string;
  public readonly phase: 1 | 2 | 3;
  public readonly requiresUrl: boolean;

  constructor(name: string, phase: 1 | 2 | 3, requiresUrl = false) {
    super();
    this.name = name;
    this.phase = phase;
    this.requiresUrl = requiresUrl;
  }

  public async execute(_context: ScanContext): Promise<ScannerResult> {
    return Promise.resolve({
      scanner: this.name,
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    });
  }

  public parseOutput(_raw: string): readonly NormalizedFinding[] {
    return [];
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('ScannerRegistry', () => {
  let registry: ScannerRegistry;

  beforeEach(() => {
    registry = new ScannerRegistry();
  });

  it('registers and retrieves a scanner by name', () => {
    const scanner = new FakeScanner('trivy', 1);
    registry.register(scanner);
    expect(registry.get('trivy')).toBe(scanner);
  });

  it('returns undefined for unknown scanner names', () => {
    expect(registry.get('missing')).toBeUndefined();
  });

  it('throws when the same name is registered twice', () => {
    registry.register(new FakeScanner('trivy', 1));
    expect(() => {
      registry.register(new FakeScanner('trivy', 1));
    }).toThrow(/already registered/);
  });

  it('returns all scanners in insertion order', () => {
    registry.register(new FakeScanner('trivy', 1));
    registry.register(new FakeScanner('semgrep', 1));
    registry.register(new FakeScanner('nuclei', 2));
    expect(registry.all().map((s) => s.name)).toEqual(['trivy', 'semgrep', 'nuclei']);
  });

  it('forPhase filters to the requested phase only', () => {
    registry.register(new FakeScanner('trivy', 1));
    registry.register(new FakeScanner('semgrep', 1));
    registry.register(new FakeScanner('nuclei', 2));
    registry.register(new FakeScanner('nmap', 2));
    registry.register(new FakeScanner('shannon', 3));
    expect(registry.forPhase(1).map((s) => s.name)).toEqual(['trivy', 'semgrep']);
    expect(registry.forPhase(2).map((s) => s.name)).toEqual(['nuclei', 'nmap']);
    expect(registry.forPhase(3).map((s) => s.name)).toEqual(['shannon']);
  });

  it('forPhase returns an empty array when no scanners registered for that phase', () => {
    registry.register(new FakeScanner('trivy', 1));
    expect(registry.forPhase(2)).toEqual([]);
  });

  it('clear() empties the registry (test helper)', () => {
    registry.register(new FakeScanner('trivy', 1));
    registry.clear();
    expect(registry.all()).toEqual([]);
  });
});
