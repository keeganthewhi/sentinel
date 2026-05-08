/**
 * Semgrep strategist prompt builders.
 *
 * Per CLAUDE.md Critical Invariant #6 (Prompt-Injection Structural Defense),
 * THIS FILE IS THE ONLY CONSTRUCTOR of Semgrep strategist prompts. Scanner
 * findings enter as user content only. The system layer is hardcoded text in
 * this module — no string interpolation of scanner-provided data into it.
 */

import type {
  ScannerInvocationPlan,
  StrategistIteration,
} from '../types/strategist-contract.js';

const SYSTEM_LAYER = [
  'You are the Semgrep strategist for Sentinel.',
  'You decide CLI arguments and replay strategy. You do NOT execute scanners.',
  'Your output MUST be a single JSON object — no prose, no code fences, no commentary.',
  'Allowed --config values: p/default, p/security-audit, p/javascript, p/typescript, p/python, p/owasp-top-ten, p/r2c-security-audit.',
  'Forbidden flags: --autofix, --autofix-replace, --replacement, --include (write rules NOT permitted), any flag that mutates the workspace.',
  'Severity floor default = LOW. Raise to MEDIUM only when the target is a high-stakes auth / payment / PHI surface.',
  'Confidence default = MEDIUM. Use HIGH only when the target type is unambiguous (e.g., a NestJS auth module).',
].join('\n');

const PLAN_SHAPE = '{ "extraArgs": [...], "severityFloor": "LOW|MEDIUM|HIGH|CRITICAL", "rationale": "...", "confidence": "LOW|MEDIUM|HIGH" }';

const REPLAY_SHAPE =
  '{ "action": "stop|replay", "nextPlan"?: ScannerInvocationPlan, "rationale": "..." }';

export const buildSemgrepStrategistPrompts = {
  strategize(input: {
    scanId: string;
    targetRepo: string;
    discoveredEndpointCount: number;
  }): string {
    return [
      SYSTEM_LAYER,
      '',
      '--- Task: produce the initial Semgrep ScannerInvocationPlan. ---',
      `scanId: ${input.scanId}`,
      `targetRepo: ${input.targetRepo}`,
      `discoveredEndpointCount: ${input.discoveredEndpointCount}`,
      '',
      `Return ScannerInvocationPlan JSON: ${PLAN_SHAPE}`,
    ].join('\n');
  },

  replay(input: {
    scanId: string;
    iterationCount: number;
    previousPlans: readonly ScannerInvocationPlan[];
    lastFindingCount: number;
  }): string {
    const previousPlansJson = JSON.stringify(input.previousPlans);
    return [
      SYSTEM_LAYER,
      '',
      '--- Task: decide whether to replay Semgrep with alternative parameters. ---',
      `scanId: ${input.scanId}`,
      `iterationCount: ${input.iterationCount}`,
      `previousPlans: ${previousPlansJson}`,
      `lastFindingCount: ${input.lastFindingCount}`,
      '',
      'If lastFindingCount > 0 OR iterationCount >= 3, return action=stop.',
      'Otherwise consider replay with a broader rule pack from the allowed list.',
      '',
      `Return ReplayDecision JSON: ${REPLAY_SHAPE}`,
    ].join('\n');
  },

  narrate(input: {
    scanId: string;
    iterations: readonly StrategistIteration[];
  }): string {
    const iterationsJson = JSON.stringify(input.iterations);
    return [
      SYSTEM_LAYER,
      '',
      '--- Task: write a per-tool Markdown report. ---',
      `scanId: ${input.scanId}`,
      `iterations: ${iterationsJson}`,
      '',
      'Output rules:',
      '- Plain GitHub-flavored Markdown. No code-fenced JSON. No HTML.',
      '- ≤ 500 words.',
      '- Sections (in order): "Summary", "What was scanned", "What was tried", "Findings overview", "Decision rationale".',
      '- Never include raw secret values, raw stack traces, or raw stderr.',
      '- Reference findings by count and category, not by raw content.',
    ].join('\n');
  },
};
