/**
 * Per-iteration record for the strategist loop.
 *
 * Plan 018 writes these to disk under
 *   workspaces/<scanId>/per-tool/<scanner>/iter-<N>/{plan.json, result.json, replay.json}
 * and a roll-up
 *   workspaces/<scanId>/per-tool/<scanner>/iterations.json
 *
 * Plan 018.5 lifts the roll-up into a `PhaseRun.iterations Json` Prisma column
 * after the running restoranpos audit drains. Until then, history lives on
 * disk and the dashboard / final report read from there.
 */

import { z } from 'zod';
import {
  ReplayDecisionSchema,
  ScannerInvocationPlanSchema,
} from '../../governor/strategist/types/strategist-contract.js';

export const PhaseRunIterationSchema = z.object({
  iteration: z.number().int().nonnegative(),
  plan: ScannerInvocationPlanSchema,
  findingsCount: z.number().int().nonnegative(),
  executionTimeMs: z.number().int().nonnegative(),
  success: z.boolean(),
  /** Present iff this iteration was triggered by a replay decision. */
  replayDecision: ReplayDecisionSchema.optional(),
});
export type PhaseRunIteration = z.infer<typeof PhaseRunIterationSchema>;

export const PhaseRunIterationHistorySchema = z.array(PhaseRunIterationSchema);
export type PhaseRunIterationHistory = z.infer<typeof PhaseRunIterationHistorySchema>;
