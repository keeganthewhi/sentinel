/**
 * PhaseEvaluator (Decisions 2 + 3) — what to escalate, what to discard.
 *
 * Called after Phase 1 and Phase 2. Reads the normalized findings, queries
 * the agent adapter, and returns a typed decision. On any failure → returns
 * a no-op evaluation (nothing escalated, nothing discarded) and logs WARN.
 *
 * Persistence is handled by the caller via `GovernorDecisionRepository.record(...)`.
 */

import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import { parseJson } from '../execution/output-parser.js';
import { buildEvaluationPrompt, type EvaluationInput } from './governor.prompts.js';
import { EVALUATION_SCHEMA, type EvaluationDecision } from './types/governor-decision.js';
import type { AgentAdapter } from './agent-adapter.js';

@Injectable()
export class PhaseEvaluator {
  private readonly logger = createLogger({ module: 'governor.phase-evaluator' });

  constructor(private readonly adapter: AgentAdapter) {}

  public async evaluate(input: EvaluationInput): Promise<EvaluationDecision> {
    const prompt = buildEvaluationPrompt(input);
    try {
      const response = await this.adapter.query(prompt);
      const idx = response.indexOf('{');
      const cleaned = idx >= 0 ? response.slice(idx) : response;
      const decision = parseJson(cleaned, EVALUATION_SCHEMA, 'governor.phase-evaluator');
      return decision;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { scanId: input.scanContext.scanId, err: message },
        'phase-evaluator failed — falling back to no-op evaluation',
      );
      return {
        escalateToShannon: [],
        discardFindings: [],
        adjustSeverity: [],
        notes: 'governor unavailable — mechanical fallback',
      };
    }
  }
}
