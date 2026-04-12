import { describe, expect, it } from 'vitest';
import { PipelineService } from './pipeline.service.js';
import { InMemoryPipelineRunner } from './in-memory.runner.js';
import { ScannerRegistry } from '../scanner/scanner.registry.js';
import { ProgressEmitter } from '../report/progress/progress.emitter.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../scanner/types/finding.interface.js';

class FakeScanner extends BaseScanner {
  constructor(
    public readonly name: string,
    public readonly phase: 1 | 2 | 3,
    public readonly requiresUrl: boolean,
    private readonly findings: readonly NormalizedFinding[] = [],
  ) {
    super();
  }
  public async execute(_context: ScanContext): Promise<ScannerResult> {
    return Promise.resolve({
      scanner: this.name,
      findings: this.findings,
      rawOutput: '',
      executionTimeMs: 1,
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

function makeFinding(scanner: string, severity: Severity = 'HIGH'): NormalizedFinding {
  return {
    scanner,
    fingerprint: `${scanner}-fp`,
    title: `${scanner} finding`,
    description: 'test',
    severity,
    category: 'sast',
    normalizedScore: 0,
  };
}

function makeService(registry: ScannerRegistry): {
  service: PipelineService;
  emitter: ProgressEmitter;
} {
  const runner = new InMemoryPipelineRunner();
  const emitter = new ProgressEmitter();
  const service = new PipelineService(registry, runner, emitter);
  return { service, emitter };
}

// Pre-set workspaceVolume to bypass the real docker volume prep step —
// unit tests use InMemoryPipelineRunner with FakeScanners that don't
// read /workspace, so there's no point paying the ~5 s docker cost.
const context: ScanContext = {
  scanId: 'scan-1',
  targetRepo: '/tmp/repo',
  workspaceVolume: 'test-stub-volume',
  governed: false,
  scannerTimeoutMs: 5000,
  scannerImage: 'img',
};

describe('PipelineService', () => {
  it('runs Phase 1 → Phase 2 in order and aggregates findings', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('p1-scanner', 1, false, [makeFinding('p1-scanner')]));
    registry.register(new FakeScanner('p2-scanner', 2, false, [makeFinding('p2-scanner')]));
    const { service } = makeService(registry);
    const summary = await service.run({ context });
    expect(summary.executedPhases).toEqual([1, 2]);
    expect(summary.findings).toHaveLength(2);
    expect(summary.scannerResults.map((r) => r.scanner)).toEqual(['p1-scanner', 'p2-scanner']);
  });

  it('respects the phases filter', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('p1-scanner', 1, false, [makeFinding('p1-scanner')]));
    registry.register(new FakeScanner('p2-scanner', 2, false, [makeFinding('p2-scanner')]));
    const { service } = makeService(registry);
    const summary = await service.run({ context, phases: [1] });
    expect(summary.executedPhases).toEqual([1]);
    expect(summary.findings).toHaveLength(1);
    expect(summary.findings[0]?.scanner).toBe('p1-scanner');
  });

  it('records durationMs and scan id', async () => {
    const registry = new ScannerRegistry();
    registry.register(new FakeScanner('s', 1, false));
    const { service } = makeService(registry);
    const summary = await service.run({ context });
    expect(summary.scanId).toBe(context.scanId);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});
