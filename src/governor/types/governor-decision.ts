/**
 * Zod schemas for the three governor decision payloads.
 *
 * Every CLI response is validated through these before reaching persistence
 * or downstream code. Invalid responses → mechanical fallback (Critical
 * Invariant #7).
 */

import { z } from 'zod';

export const SCAN_PLAN_SCHEMA = z.object({
  scanPlan: z.object({
    enabledScanners: z.array(z.string()),
    disabledScanners: z.array(z.string()).default([]),
    disableReasons: z.record(z.string(), z.string()).default({}),
    scannerConfigs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    rationale: z.string().default(''),
  }),
});
export type ScanPlanDecision = z.infer<typeof SCAN_PLAN_SCHEMA>;

export const EVALUATION_SCHEMA = z.object({
  escalateToShannon: z
    .array(
      z.object({
        findingFingerprint: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  discardFindings: z
    .array(
      z.object({
        findingFingerprint: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  adjustSeverity: z
    .array(
      z.object({
        findingFingerprint: z.string(),
        newSeverity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
        reason: z.string(),
      }),
    )
    .default([]),
  notes: z.string().default(''),
});
export type EvaluationDecision = z.infer<typeof EVALUATION_SCHEMA>;

/**
 * The report payload is just a markdown string with minimal structural validation.
 * The validator checks length and section headers.
 */
export const REPORT_SCHEMA = z.object({
  markdown: z.string().min(50),
  citationFingerprints: z.array(z.string()).default([]),
});
export type ReportDecision = z.infer<typeof REPORT_SCHEMA>;
