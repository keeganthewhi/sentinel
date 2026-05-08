/**
 * Semgrep per-tool AI strategist.
 *
 * Owns three lifecycle calls (driven by the pipeline in plan 018):
 *   strategize → ScannerInvocationPlan          (initial CLI args)
 *   replay     → ReplayDecision { stop|replay } (after each iteration)
 *   narrate    → markdown report                (once iteration ends)
 *
 * Every adapter call funnels through `queryAdapter()` so the typed
 * `StrategistFailureError` is the only error class that escapes this module.
 * Narrate is best-effort and falls back to a mechanical summary on failure
 * rather than re-throwing — losing the per-tool MD entirely is worse than
 * losing the AI prose.
 */

import { extractJsonObject, parseJson } from '../../../execution/output-parser.js';
import { createLogger } from '../../../common/logger.js';
import { StrategistFailureError } from '../../../common/errors.js';
import { BaseStrategist, type StrategistContext } from '../base-strategist.js';
import {
  ReplayDecisionSchema,
  ScannerInvocationPlanSchema,
  type ReplayDecision,
  type ScannerInvocationPlan,
  type StrategistIteration,
} from '../types/strategist-contract.js';
import { buildSemgrepStrategistPrompts } from '../prompts/semgrep.prompts.js';
import type { ScannerResult } from '../../../scanner/types/scanner.interface.js';

const REPLAY_BUDGET = 3;

export class SemgrepStrategist extends BaseStrategist {
  public readonly name = 'semgrep-strategist';
  public readonly scannerName = 'semgrep';

  private readonly logger = createLogger({ module: 'strategist.semgrep' });

  public async strategize(ctx: StrategistContext): Promise<ScannerInvocationPlan> {
    const prompt = buildSemgrepStrategistPrompts.strategize({
      scanId: ctx.scanId,
      targetRepo: ctx.scanContext.targetRepo,
      discoveredEndpointCount: ctx.scanContext.discoveredEndpoints?.length ?? 0,
    });
    const raw = await this.queryAdapter(ctx, prompt);
    return this.parsePlan(ctx, raw);
  }

  public async replay(
    ctx: StrategistContext,
    previous: readonly StrategistIteration[],
    lastResult: ScannerResult,
  ): Promise<ReplayDecision> {
    if (previous.length >= REPLAY_BUDGET) {
      return { action: 'stop', rationale: 'replay budget exhausted (3 iterations)' };
    }
    if (lastResult.findings.length > 0) {
      return {
        action: 'stop',
        rationale: `findings produced (${lastResult.findings.length}); no replay needed`,
      };
    }

    const prompt = buildSemgrepStrategistPrompts.replay({
      scanId: ctx.scanId,
      iterationCount: previous.length,
      previousPlans: previous.map((it) => it.plan),
      lastFindingCount: lastResult.findings.length,
    });
    const raw = await this.queryAdapter(ctx, prompt);
    return this.parseReplay(ctx, raw);
  }

  public async narrate(
    ctx: StrategistContext,
    iterations: readonly StrategistIteration[],
  ): Promise<string> {
    const prompt = buildSemgrepStrategistPrompts.narrate({
      scanId: ctx.scanId,
      iterations,
    });
    try {
      const raw = await ctx.adapter.query(prompt);
      const trimmed = raw.trim();
      if (trimmed === '') {
        this.logger.warn(
          { scanId: ctx.scanId, scanner: this.scannerName },
          'narrate returned empty output — using mechanical summary',
        );
        return this.mechanicalSummary(iterations);
      }
      return trimmed;
    } catch (err) {
      this.logger.warn(
        {
          scanId: ctx.scanId,
          scanner: this.scannerName,
          err: err instanceof Error ? err.message : String(err),
        },
        'narrate fell back to mechanical summary',
      );
      return this.mechanicalSummary(iterations);
    }
  }

  private async queryAdapter(ctx: StrategistContext, prompt: string): Promise<string> {
    try {
      return await ctx.adapter.query(prompt);
    } catch (err) {
      throw new StrategistFailureError(
        `Semgrep strategist adapter failure: ${err instanceof Error ? err.message : String(err)}`,
        { scanner: this.scannerName, scanId: ctx.scanId, cause: err },
      );
    }
  }

  private parsePlan(ctx: StrategistContext, raw: string): ScannerInvocationPlan {
    try {
      const json = extractJsonObject(raw);
      return parseJson(json, ScannerInvocationPlanSchema, this.name);
    } catch (err) {
      throw new StrategistFailureError(
        `Semgrep strategist returned invalid plan JSON: ${err instanceof Error ? err.message : String(err)}`,
        { scanner: this.scannerName, scanId: ctx.scanId, cause: err },
      );
    }
  }

  private parseReplay(ctx: StrategistContext, raw: string): ReplayDecision {
    try {
      const json = extractJsonObject(raw);
      return parseJson(json, ReplayDecisionSchema, this.name);
    } catch (err) {
      throw new StrategistFailureError(
        `Semgrep strategist returned invalid replay JSON: ${err instanceof Error ? err.message : String(err)}`,
        { scanner: this.scannerName, scanId: ctx.scanId, cause: err },
      );
    }
  }

  private mechanicalSummary(iterations: readonly StrategistIteration[]): string {
    const total = iterations.reduce((acc, it) => acc + it.findingsCount, 0);
    const elapsed = iterations.reduce((acc, it) => acc + it.executionTimeMs, 0);
    const lines: string[] = [
      '# Semgrep — mechanical fallback summary',
      '',
      `Iterations: ${iterations.length}`,
      `Total findings: ${total}`,
      `Total execution time: ${elapsed} ms`,
      '',
      '| # | Findings | Time (ms) | Plan rationale |',
      '|---|----------|-----------|----------------|',
    ];
    for (const it of iterations) {
      const rationale = it.plan.rationale.length > 80 ? `${it.plan.rationale.slice(0, 77)}...` : it.plan.rationale;
      lines.push(`| ${it.iteration} | ${it.findingsCount} | ${it.executionTimeMs} | ${rationale.replace(/\|/g, '\\|')} |`);
    }
    return lines.join('\n');
  }
}

export const SEMGREP_REPLAY_BUDGET = REPLAY_BUDGET;
