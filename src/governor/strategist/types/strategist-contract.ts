/**
 * Per-tool AI strategist contracts.
 *
 * The strategist NEVER spawns the scanner — it returns a structured
 * `ScannerInvocationPlan`, the pipeline applies it. This keeps the governor
 * (and its strategist sibling) read-only on scanner execution per CLAUDE.md
 * Critical Invariant #4 (Governor Never Executes Tools).
 *
 * Zod is the single source of truth. Hand-rolled interfaces below derive from
 * the schemas via `z.infer` so a schema widening propagates everywhere.
 */

import { z } from 'zod';

/** Severities aligned with `src/scanner/types/finding.interface.ts`. */
export const SeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/** Strategist's confidence in its own decision — surfaced to the user. */
export const ConfidenceSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/**
 * What the strategist asks the pipeline to run for one scanner iteration.
 * The pipeline merges these `extraArgs` into the scanner-default argv
 * before spawning the Docker container. `severityFloor` gates findings AT
 * persistence time — findings below the floor are dropped from the
 * `Finding[]` set fed into correlation.
 */
export const ScannerInvocationPlanSchema = z.object({
  extraArgs: z.array(z.string()).default([]),
  severityFloor: SeveritySchema.default('LOW'),
  rationale: z.string().min(1).max(2000),
  confidence: ConfidenceSchema.default('MEDIUM'),
});
export type ScannerInvocationPlan = z.infer<typeof ScannerInvocationPlanSchema>;

/**
 * After a scanner run, the strategist decides whether to re-run with
 * alternative parameters. The pipeline caps replay iterations at 3 to
 * bound governor-CLI subscription spend.
 */
export const ReplayDecisionSchema = z
  .object({
    action: z.enum(['stop', 'replay']),
    nextPlan: ScannerInvocationPlanSchema.optional(),
    rationale: z.string().min(1).max(2000),
  })
  .refine((data) => data.action === 'stop' || data.nextPlan !== undefined, {
    message: 'replay action requires nextPlan',
    path: ['nextPlan'],
  });
export type ReplayDecision = z.infer<typeof ReplayDecisionSchema>;

/**
 * Per-iteration record. The strategist's `narrate()` consumes the full
 * iteration history, so structure is immutable and append-only.
 */
export interface StrategistIteration {
  readonly iteration: number;
  readonly plan: ScannerInvocationPlan;
  readonly findingsCount: number;
  readonly executionTimeMs: number;
  readonly success: boolean;
  readonly replayDecision?: ReplayDecision;
}
