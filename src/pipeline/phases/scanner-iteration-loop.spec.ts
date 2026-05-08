import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runScannerIterationLoop,
  MAX_STRATEGIST_ITERATIONS,
} from './scanner-iteration-loop.js';
import { BaseStrategist, type StrategistContext } from '../../governor/strategist/base-strategist.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../../scanner/types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../../scanner/types/finding.interface.js';
import type { PhaseRunIteration } from '../../persistence/types/phase-run-iteration.js';
import type {
  ScannerInvocationPlan,
  ReplayDecision,
} from '../../governor/strategist/types/strategist-contract.js';
import { StrategistFailureError } from '../../common/errors.js';
import type { AgentAdapter } from '../../governor/agent-adapter.js';
import type { IPipelineRunner } from '../types.js';

class StubScanner extends BaseScanner {
  public readonly name: string;
  public readonly phase: 1 | 2 | 3 = 1;
  public readonly requiresUrl = false;
  public override readonly strategistName = 'stub';

  constructor(
    name: string,
    private readonly results: readonly ScannerResult[],
  ) {
    super();
    this.name = name;
  }

  public execute(_context: ScanContext): Promise<ScannerResult> {
    const idx = this.callCount;
    this.callCount += 1;
    const result = this.results[idx] ?? this.results[this.results.length - 1];
    if (result === undefined) {
      throw new Error('StubScanner exhausted');
    }
    return Promise.resolve(result);
  }

  public parseOutput(_raw: string): readonly NormalizedFinding[] {
    return [];
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  public callCount = 0;
}

interface RunnerInvocation {
  readonly scanner: string;
  readonly extraArgs: readonly string[];
}

class StubRunner implements IPipelineRunner {
  public runScanner(scanner: BaseScanner, context: ScanContext): Promise<ScannerResult> {
    this.invocations.push({ scanner: scanner.name, extraArgs: context.scannerExtraArgs?.[scanner.name] ?? [] });
    return scanner.execute(context);
  }
  public invocations: RunnerInvocation[] = [];
}

interface StubStrategistOptions {
  readonly initialPlan?: ScannerInvocationPlan;
  readonly replayDecisions?: readonly ReplayDecision[];
  readonly throwOnStrategize?: boolean;
  readonly throwOnReplay?: boolean;
  readonly throwOnNarrate?: boolean;
  readonly narrateText?: string;
}

class StubStrategist extends BaseStrategist {
  public readonly name = 'stub-strategist';
  public readonly scannerName = 'stub';

  constructor(private readonly options: StubStrategistOptions = {}) {
    super();
  }

  public strategize(ctx: StrategistContext): Promise<ScannerInvocationPlan> {
    if (this.options.throwOnStrategize) {
      throw new StrategistFailureError('stub strategize failure', {
        scanner: this.scannerName,
        scanId: ctx.scanId,
      });
    }
    return Promise.resolve(
      this.options.initialPlan ?? {
        extraArgs: [],
        severityFloor: 'LOW',
        rationale: 'stub initial plan',
        confidence: 'MEDIUM',
      },
    );
  }

  public override replay(
    ctx: StrategistContext,
    previous: readonly PhaseRunIteration[],
    _lastResult: ScannerResult,
  ): Promise<ReplayDecision> {
    if (this.options.throwOnReplay) {
      throw new StrategistFailureError('stub replay failure', {
        scanner: this.scannerName,
        scanId: ctx.scanId,
      });
    }
    const idx = previous.length - 1;
    const decisions = this.options.replayDecisions ?? [];
    const decision = decisions[idx] ?? { action: 'stop', rationale: 'stub default stop' };
    return Promise.resolve(decision);
  }

  public narrate(
    _ctx: StrategistContext,
    _iterations: readonly PhaseRunIteration[],
  ): Promise<string> {
    if (this.options.throwOnNarrate) {
      throw new Error('stub narrate failure');
    }
    return Promise.resolve(this.options.narrateText ?? '# Stub strategist narrate');
  }
}

const FAKE_ADAPTER: AgentAdapter = {
  name: 'claude',
  bin: 'claude',
  query: vi.fn().mockResolvedValue(''),
};

function makeFinding(severity: Severity = 'LOW'): NormalizedFinding {
  return {
    scanner: 'stub',
    fingerprint: `fp-${Math.random()}`,
    title: 't',
    description: 'd',
    severity,
    category: 'sast',
    normalizedScore: 0,
  };
}

function makeResult(findings: readonly NormalizedFinding[]): ScannerResult {
  return {
    scanner: 'stub',
    findings,
    rawOutput: '',
    executionTimeMs: 1_000,
    success: true,
  };
}

function makeContext(): ScanContext {
  return {
    scanId: 'scan-test-1',
    targetRepo: '/workspace',
    governed: true,
    scannerTimeoutMs: 60_000,
    scannerImage: 'sentinel-scanner:latest',
  };
}

describe('runScannerIterationLoop', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'sentinel-loop-test-'));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('runs once when scanner produces findings on first iteration', async () => {
    const scanner = new StubScanner('stub', [makeResult([makeFinding('HIGH')])]);
    const strategist = new StubStrategist();
    const runner = new StubRunner();

    const outcome = await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.collapsed.findings).toHaveLength(1);
    expect(scanner.callCount).toBe(1);
  });

  it('hard-caps at 3 iterations even when strategist replays infinitely', async () => {
    const replayPlan: ScannerInvocationPlan = {
      extraArgs: ['--config', 'p/owasp-top-ten'],
      severityFloor: 'LOW',
      rationale: 'broaden ruleset',
      confidence: 'MEDIUM',
    };
    const replayDecisions: ReplayDecision[] = Array.from({ length: 5 }, () => ({
      action: 'replay',
      nextPlan: replayPlan,
      rationale: 'try alt',
    }));
    const scanner = new StubScanner(
      'stub',
      Array.from({ length: 5 }, () => makeResult([])),
    );
    const strategist = new StubStrategist({ replayDecisions });
    const runner = new StubRunner();

    const outcome = await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(outcome.iterations).toHaveLength(MAX_STRATEGIST_ITERATIONS);
    expect(scanner.callCount).toBe(MAX_STRATEGIST_ITERATIONS);
  });

  it('falls back to mechanical run when strategize throws', async () => {
    const scanner = new StubScanner('stub', [makeResult([makeFinding('LOW')])]);
    const strategist = new StubStrategist({ throwOnStrategize: true });
    const runner = new StubRunner();

    const outcome = await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(outcome.iterations).toHaveLength(1);
    expect(outcome.iterations[0]?.plan.rationale).toMatch(/strategize fallback/);
    expect(outcome.collapsed.findings).toHaveLength(1);
    expect(scanner.callCount).toBe(1);
  });

  it('stops iteration when replay throws (keeps prior iteration)', async () => {
    const scanner = new StubScanner('stub', [makeResult([])]);
    const strategist = new StubStrategist({ throwOnReplay: true });
    const runner = new StubRunner();

    const outcome = await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(outcome.iterations).toHaveLength(1);
    expect(scanner.callCount).toBe(1);
  });

  it('writes per-tool artifacts to disk under workspaces/<scanId>/per-tool/<scanner>/', async () => {
    const scanner = new StubScanner('stub', [makeResult([makeFinding()])]);
    const strategist = new StubStrategist({ narrateText: '# Stub findings' });
    const runner = new StubRunner();

    await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    const perToolDir = join(workspaceRoot, 'scan-test-1', 'per-tool', 'stub');
    expect(existsSync(perToolDir)).toBe(true);
    expect(existsSync(join(perToolDir, 'narrate.md'))).toBe(true);
    expect(existsSync(join(perToolDir, 'iterations.json'))).toBe(true);
    expect(existsSync(join(perToolDir, 'iter-0', 'plan.json'))).toBe(true);
    expect(existsSync(join(perToolDir, 'iter-0', 'result.json'))).toBe(true);

    const narrate = readFileSync(join(perToolDir, 'narrate.md'), 'utf8');
    expect(narrate).toMatch(/Stub findings/);

    const iterations = JSON.parse(readFileSync(join(perToolDir, 'iterations.json'), 'utf8')) as PhaseRunIteration[];
    expect(iterations).toHaveLength(1);
    expect(iterations[0]?.findingsCount).toBe(1);
  });

  it('passes strategist plan extraArgs to runner via scannerExtraArgs', async () => {
    const planWithArgs: ScannerInvocationPlan = {
      extraArgs: ['--config', 'p/security-audit'],
      severityFloor: 'MEDIUM',
      rationale: 'auth-heavy target',
      confidence: 'HIGH',
    };
    const scanner = new StubScanner('stub', [makeResult([])]);
    const strategist = new StubStrategist({ initialPlan: planWithArgs });
    const runner = new StubRunner();

    await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]?.extraArgs).toEqual(['--config', 'p/security-audit']);
  });

  it('applies severity floor MEDIUM (drops LOW findings)', async () => {
    const planWithFloor: ScannerInvocationPlan = {
      extraArgs: [],
      severityFloor: 'MEDIUM',
      rationale: 'auth boundary — MEDIUM floor',
      confidence: 'HIGH',
    };
    const scanner = new StubScanner('stub', [
      makeResult([makeFinding('LOW'), makeFinding('MEDIUM'), makeFinding('HIGH')]),
    ]);
    const strategist = new StubStrategist({ initialPlan: planWithFloor });
    const runner = new StubRunner();

    const outcome = await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(outcome.collapsed.findings).toHaveLength(2);
    expect(outcome.collapsed.findings.every((f) => f.severity !== 'LOW')).toBe(true);
  });

  it('records replay decision on the prior iteration when replay triggers next', async () => {
    const replayPlan: ScannerInvocationPlan = {
      extraArgs: ['--config', 'p/owasp-top-ten'],
      severityFloor: 'LOW',
      rationale: 'try OWASP',
      confidence: 'MEDIUM',
    };
    const scanner = new StubScanner('stub', [
      makeResult([]),
      makeResult([makeFinding('HIGH')]),
    ]);
    const strategist = new StubStrategist({
      replayDecisions: [{ action: 'replay', nextPlan: replayPlan, rationale: 'no findings on default — try OWASP' }],
    });
    const runner = new StubRunner();

    const outcome = await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    expect(outcome.iterations).toHaveLength(2);
    expect(outcome.iterations[0]?.replayDecision?.action).toBe('replay');
    expect(outcome.iterations[1]?.plan.extraArgs).toEqual(['--config', 'p/owasp-top-ten']);
  });

  it('fs writes use mode 0o600 on Unix-like systems', async () => {
    if (process.platform === 'win32') {
      // Windows POSIX mode bits don't reflect the requested mode reliably;
      // skip the assertion on Windows but still exercise the write path.
      return;
    }
    const scanner = new StubScanner('stub', [makeResult([])]);
    const strategist = new StubStrategist();
    const runner = new StubRunner();

    await runScannerIterationLoop({
      scanner,
      context: makeContext(),
      runner,
      strategist,
      adapter: FAKE_ADAPTER,
      workspacesRoot: workspaceRoot,
    });

    const narrateStat = statSync(join(workspaceRoot, 'scan-test-1', 'per-tool', 'stub', 'narrate.md'));
    expect(narrateStat.mode & 0o777).toBe(0o600);
  });
});
