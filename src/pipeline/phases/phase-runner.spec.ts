import { describe, expect, it } from 'vitest';
import { runPhase } from './phase-runner.js';
import { InMemoryPipelineRunner } from '../in-memory.runner.js';
import { ScannerRegistry } from '../../scanner/scanner.registry.js';
import { ProgressEmitter } from '../../report/progress/progress.emitter.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../../scanner/types/scanner.interface.js';
import type { NormalizedFinding } from '../../scanner/types/finding.interface.js';

class FakeScanner extends BaseScanner {
  constructor(
    public readonly name: string,
    public readonly phase: 1 | 2 | 3,
    public readonly requiresUrl = false,
    private readonly delayMs = 5,
    private readonly shouldFail = false,
  ) {
    super();
  }
  public async execute(_context: ScanContext): Promise<ScannerResult> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.shouldFail) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: this.delayMs,
        success: false,
        error: 'deliberate failure',
      };
    }
    return {
      scanner: this.name,
      findings: [],
      rawOutput: 'ok',
      executionTimeMs: this.delayMs,
      success: true,
    };
  }
  public parseOutput(_raw: string): readonly NormalizedFinding[] {
    return [];
  }
  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const baseContext: ScanContext = {
  scanId: 'test-scan',
  targetRepo: '/tmp/repo',
  governed: false,
  scannerTimeoutMs: 5000,
  scannerImage: 'img',
};

describe('runPhase', () => {
  it('executes all scanners for the requested phase in parallel', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('a', 1, false, 30));
    registry.register(new FakeScanner('b', 1, false, 30));
    registry.register(new FakeScanner('c', 1, false, 30));
    const runner = new InMemoryPipelineRunner();
    const emitter = new ProgressEmitter();
    const start = Date.now();
    const results = await runPhase(1, registry, runner, baseContext, emitter);
    const elapsed = Date.now() - start;
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    // If they ran sequentially it would be ≥ 90ms; parallel should be well under 80ms.
    expect(elapsed).toBeLessThan(80);
  });

  it('continues when one scanner fails', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('ok1', 1, false, 5));
    registry.register(new FakeScanner('broken', 1, false, 5, true));
    registry.register(new FakeScanner('ok2', 1, false, 5));
    const runner = new InMemoryPipelineRunner();
    const emitter = new ProgressEmitter();
    const results = await runPhase(1, registry, runner, baseContext, emitter);
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.success)).toHaveLength(2);
    expect(results.filter((r) => !r.success)).toHaveLength(1);
  });

  it('skips scanners with requiresUrl when targetUrl is absent', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('no-url', 1, false));
    registry.register(new FakeScanner('url-required', 1, true));
    const runner = new InMemoryPipelineRunner();
    const emitter = new ProgressEmitter();
    const results = await runPhase(1, registry, runner, baseContext, emitter);
    expect(results).toHaveLength(2);
    const skipped = results.find((r) => r.scanner === 'url-required');
    expect(skipped?.success).toBe(true);
    expect(skipped?.error).toContain('skipped');
  });

  it('runs requiresUrl scanners when targetUrl is present', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('url-required', 1, true));
    const runner = new InMemoryPipelineRunner();
    const emitter = new ProgressEmitter();
    const results = await runPhase(
      1,
      registry,
      runner,
      { ...baseContext, targetUrl: 'https://example.com' },
      emitter,
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.error).toBeUndefined();
  });

  it('emits phase.start and phase.end events', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('a', 1, false, 1));
    const runner = new InMemoryPipelineRunner();
    const emitter = new ProgressEmitter();
    const events: string[] = [];
    emitter.on((event) => {
      events.push(event.type);
    });
    await runPhase(1, registry, runner, baseContext, emitter);
    expect(events).toContain('phase.start');
    expect(events).toContain('phase.end');
    expect(events).toContain('scanner.start');
    expect(events).toContain('scanner.end');
  });
});
