/**
 * Per-scanner strategist iteration loop (plan 018).
 *
 * Drives one scanner through up to 3 governor-CLI consultations:
 *   strategize(ctx)                       → ScannerInvocationPlan
 *   pipeline executes scanner with plan   → ScannerResult
 *   replay(ctx, prev[], lastResult)       → { stop | replay }
 *   loop until 'stop' OR iteration ≥ 3
 *   narrate(ctx, iterations[])            → markdown string
 *
 * Returns:
 *   - collapsed `ScannerResult` (last iteration's result; findings + raw output
 *     surface to correlation as one set, not three)
 *   - full iteration history (also written to disk as JSON)
 *   - narrate markdown (also written to disk as narrate.md)
 *
 * Disk layout under workspaces/<scanId>/per-tool/<scanner>/:
 *   iter-0/plan.json      — strategize() output
 *   iter-0/result.json    — { findingsCount, executionTimeMs, success }
 *   iter-1/plan.json
 *   iter-1/result.json
 *   iter-1/replay.json    — replay decision that triggered this iteration
 *   ...
 *   iterations.json       — full history (mirror of plan 018.5 Prisma column)
 *   narrate.md            — strategist narrate output (or mechanical fallback)
 *
 * Mode 0o600 on every file (CLAUDE.md sensitive-fields rule).
 *
 * Failure handling:
 *   - StrategistFailureError on strategize() → fall back to one mechanical run
 *     with empty extra-args. Logged WARN.
 *   - StrategistFailureError on replay() → stop iteration, keep prior results.
 *   - narrate() implementations handle their own failures (mechanical summary).
 *   - Scanner crash inside an iteration → recorded as { success: false }; loop
 *     ends and narrate runs against whatever iterations completed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../common/logger.js';
import { StrategistFailureError } from '../../common/errors.js';
import type {
  BaseScanner,
  ScanContext,
  ScannerResult,
} from '../../scanner/types/scanner.interface.js';
import type { IPipelineRunner } from '../types.js';
import type { BaseStrategist, StrategistContext } from '../../governor/strategist/base-strategist.js';
import type {
  ReplayDecision,
  ScannerInvocationPlan,
} from '../../governor/strategist/types/strategist-contract.js';
import type { AgentAdapter } from '../../governor/agent-adapter.js';
import type { PhaseRunIteration } from '../../persistence/types/phase-run-iteration.js';

/** Hard cap. Defense-in-depth: strategist's own replay() should also stop here. */
export const MAX_STRATEGIST_ITERATIONS = 3;

const logger = createLogger({ module: 'pipeline.strategist-loop' });

export interface StrategistLoopParams {
  readonly scanner: BaseScanner;
  readonly context: ScanContext;
  readonly runner: IPipelineRunner;
  readonly strategist: BaseStrategist;
  readonly adapter: AgentAdapter;
  readonly workspacesRoot: string;
}

export interface StrategistLoopOutcome {
  readonly collapsed: ScannerResult;
  readonly iterations: readonly PhaseRunIteration[];
  readonly narrateMd: string;
}

/**
 * Run the loop. Pure function — no scanner subprocess spawn here (the
 * `runner.runScanner` call is the only execution path; runner is the only
 * thing that crosses the scanner boundary).
 */
export async function runScannerIterationLoop(
  params: StrategistLoopParams,
): Promise<StrategistLoopOutcome> {
  const { scanner, context, runner, strategist, adapter, workspacesRoot } = params;
  const perToolDir = join(workspacesRoot, context.scanId, 'per-tool', scanner.name);
  mkdirSync(perToolDir, { recursive: true, mode: 0o700 });

  const strategistCtx: StrategistContext = {
    scanId: context.scanId,
    scanner: scanner.name,
    adapter,
    scanContext: context,
  };

  const iterations: PhaseRunIteration[] = [];
  let lastResult: ScannerResult | undefined;

  // ---------- Iteration 0: initial strategize ----------
  let initialPlan: ScannerInvocationPlan;
  try {
    initialPlan = await strategist.strategize(strategistCtx);
  } catch (err) {
    if (err instanceof StrategistFailureError) {
      logger.warn(
        { scanId: context.scanId, scanner: scanner.name, err: err.message },
        'strategize failed — falling back to mechanical scanner default',
      );
      const result = await runner.runScanner(scanner, context);
      const fallbackPlan: ScannerInvocationPlan = {
        extraArgs: [],
        severityFloor: 'LOW',
        rationale: `strategize fallback: ${err.message.slice(0, 200)}`,
        confidence: 'LOW',
      };
      const iter: PhaseRunIteration = {
        iteration: 0,
        plan: fallbackPlan,
        findingsCount: result.findings.length,
        executionTimeMs: result.executionTimeMs,
        success: result.success,
      };
      iterations.push(iter);
      writeIteration(perToolDir, iter, undefined);
      const narrateMd = await safeNarrate(strategist, strategistCtx, iterations);
      writeArtifacts(perToolDir, iterations, narrateMd);
      return { collapsed: result, iterations, narrateMd };
    }
    throw err;
  }

  let nextPlan = initialPlan;

  // ---------- Iteration 0..N: execute + replay loop ----------
  for (let i = 0; i < MAX_STRATEGIST_ITERATIONS; i += 1) {
    const iterCtx: ScanContext = {
      ...context,
      scannerExtraArgs: { ...(context.scannerExtraArgs ?? {}), [scanner.name]: nextPlan.extraArgs },
    };
    const result = await runner.runScanner(scanner, iterCtx);
    lastResult = result;

    const iter: PhaseRunIteration = {
      iteration: i,
      plan: nextPlan,
      findingsCount: result.findings.length,
      executionTimeMs: result.executionTimeMs,
      success: result.success,
    };
    iterations.push(iter);

    // Apply severityFloor. Findings below the floor are dropped from the
    // collapsed result so plan 020's verdict engine sees the curated set.
    // We do not mutate `iter.findingsCount` (which records the raw count
    // for audit purposes).

    if (i + 1 >= MAX_STRATEGIST_ITERATIONS) {
      writeIteration(perToolDir, iter, undefined);
      break;
    }

    // Decide replay
    let decision: ReplayDecision;
    try {
      decision = await strategist.replay(strategistCtx, iterations, result);
    } catch (err) {
      if (err instanceof StrategistFailureError) {
        logger.warn(
          { scanId: context.scanId, scanner: scanner.name, err: err.message },
          'replay decision failed — stopping iteration',
        );
        writeIteration(perToolDir, iter, undefined);
        break;
      }
      throw err;
    }

    // Replace the prior iteration record with one that includes the replay
    // decision (kept on the record so the disk audit trail is complete).
    const iterWithReplay: PhaseRunIteration = { ...iter, replayDecision: decision };
    iterations[iterations.length - 1] = iterWithReplay;
    writeIteration(perToolDir, iterWithReplay, decision);

    if (decision.action === 'stop' || decision.nextPlan === undefined) {
      break;
    }
    nextPlan = decision.nextPlan;
  }

  // ---------- Narrate ----------
  const narrateMd = await safeNarrate(strategist, strategistCtx, iterations);
  writeArtifacts(perToolDir, iterations, narrateMd);

  // Collapse: latest result wins. Findings from earlier iterations are NOT
  // merged — replay implies the strategist concluded the earlier ruleset
  // missed signal, so the latest run is the authoritative finding set.
  const collapsed: ScannerResult = lastResult ?? {
    scanner: scanner.name,
    findings: [],
    rawOutput: '',
    executionTimeMs: 0,
    success: false,
    error: 'iteration loop produced no result',
  };

  // Apply severityFloor from the final iteration's plan to drop low-signal
  // findings before correlation sees them.
  const finalPlan = iterations.at(-1)?.plan;
  if (finalPlan !== undefined && finalPlan.severityFloor !== 'LOW') {
    const order: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    const floor = order[finalPlan.severityFloor] ?? 0;
    const kept = collapsed.findings.filter((f) => (order[f.severity] ?? 0) >= floor);
    if (kept.length !== collapsed.findings.length) {
      logger.info(
        {
          scanId: context.scanId,
          scanner: scanner.name,
          floor: finalPlan.severityFloor,
          dropped: collapsed.findings.length - kept.length,
          kept: kept.length,
        },
        'severity floor applied',
      );
      return { collapsed: { ...collapsed, findings: kept }, iterations, narrateMd };
    }
  }

  return { collapsed, iterations, narrateMd };
}

async function safeNarrate(
  strategist: BaseStrategist,
  ctx: StrategistContext,
  iterations: readonly PhaseRunIteration[],
): Promise<string> {
  try {
    return await strategist.narrate(ctx, iterations);
  } catch (err) {
    logger.warn(
      {
        scanId: ctx.scanId,
        scanner: ctx.scanner,
        err: err instanceof Error ? err.message : String(err),
      },
      'narrate threw unexpectedly — using mechanical placeholder',
    );
    return `# ${ctx.scanner} — narrate unavailable\n\nIterations: ${iterations.length}\nLast error: ${err instanceof Error ? err.message : String(err)}\n`;
  }
}

function writeIteration(
  perToolDir: string,
  iter: PhaseRunIteration,
  replay: ReplayDecision | undefined,
): void {
  const iterDir = join(perToolDir, `iter-${iter.iteration}`);
  try {
    mkdirSync(iterDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(iterDir, 'plan.json'), JSON.stringify(iter.plan, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    writeFileSync(
      join(iterDir, 'result.json'),
      JSON.stringify(
        {
          findingsCount: iter.findingsCount,
          executionTimeMs: iter.executionTimeMs,
          success: iter.success,
        },
        null,
        2,
      ),
      { encoding: 'utf8', mode: 0o600 },
    );
    if (replay !== undefined) {
      writeFileSync(join(iterDir, 'replay.json'), JSON.stringify(replay, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
  } catch (err) {
    logger.warn(
      {
        perToolDir,
        iteration: iter.iteration,
        err: err instanceof Error ? err.message : String(err),
      },
      'failed to write iteration artifacts — continuing',
    );
  }
}

function writeArtifacts(
  perToolDir: string,
  iterations: readonly PhaseRunIteration[],
  narrateMd: string,
): void {
  try {
    writeFileSync(join(perToolDir, 'iterations.json'), JSON.stringify(iterations, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    writeFileSync(join(perToolDir, 'narrate.md'), narrateMd, { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    logger.warn(
      {
        perToolDir,
        err: err instanceof Error ? err.message : String(err),
      },
      'failed to write per-tool roll-up artifacts — continuing',
    );
  }
}
