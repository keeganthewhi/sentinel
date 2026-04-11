import { describe, expect, it } from 'vitest';
import { InMemoryPipelineRunner } from './in-memory.runner.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';

class SuccessScanner extends BaseScanner {
  public readonly name = 'success';
  public readonly phase = 1 as const;
  public readonly requiresUrl = false;

  public async execute(_context: ScanContext): Promise<ScannerResult> {
    return Promise.resolve({
      scanner: this.name,
      findings: [],
      rawOutput: 'ok',
      executionTimeMs: 10,
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

class ThrowingScanner extends BaseScanner {
  public readonly name = 'throwing';
  public readonly phase = 1 as const;
  public readonly requiresUrl = false;

  public async execute(_context: ScanContext): Promise<ScannerResult> {
    await Promise.resolve();
    throw new Error('boom');
  }
  public parseOutput(_raw: string): readonly NormalizedFinding[] {
    return [];
  }
  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const context: ScanContext = {
  scanId: 'test-scan',
  targetRepo: '/tmp/repo',
  governed: false,
  scannerTimeoutMs: 1000,
  scannerImage: 'img',
};

describe('InMemoryPipelineRunner', () => {
  it('forwards a successful scanner result', async () => {
    const runner = new InMemoryPipelineRunner();
    const result = await runner.runScanner(new SuccessScanner(), context);
    expect(result.success).toBe(true);
    expect(result.rawOutput).toBe('ok');
  });

  it('converts a throwing scanner into a failure result', async () => {
    const runner = new InMemoryPipelineRunner();
    const result = await runner.runScanner(new ThrowingScanner(), context);
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
    expect(result.scanner).toBe('throwing');
  });
});
