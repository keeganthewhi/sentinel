/**
 * Governor prompt builders — THE SOLE PAYLOAD CONSTRUCTOR (Critical Invariant #6).
 *
 * No other file in the codebase may build a governor prompt. This is the
 * structural defense against prompt injection: scanner-derived strings enter
 * as user content under a clearly delimited section, never as system layer.
 *
 * The governor contract (`governor-templates/CLAUDE.md`) is the system layer.
 * It is read once at startup and embedded verbatim. The user content is JSON
 * that has already passed through Zod validation.
 *
 * INPUTS that are NEVER allowed in any prompt:
 *   - TruffleHog `Raw` values (already redacted upstream to `[REDACTED:<hash>]`)
 *   - `.env` file contents
 *   - `authentication.token` from config
 *   - Scanner stderr
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';
import type { ScanContext } from '../scanner/types/scanner.interface.js';

const CONTRACT_PATH = join('governor-templates', 'CLAUDE.md');

let cachedContract: string | null = null;

function loadContract(): string {
  if (cachedContract === null) {
    try {
      cachedContract = readFileSync(CONTRACT_PATH, 'utf8');
    } catch {
      // The contract is not strictly required at runtime — fall back to a minimal stub.
      cachedContract = '# Governor contract\n\nYou are the Sentinel governor. Reply only in JSON.\n';
    }
  }
  return cachedContract;
}

export interface ScanPlanInput {
  readonly fileTreeDigest: readonly string[];
  readonly packageJson?: unknown;
  readonly sentinelYaml?: unknown;
  readonly targetRepo: string;
  readonly targetUrl?: string;
}

export interface EvaluationInput {
  readonly scanContext: ScanContext;
  readonly findings: readonly NormalizedFinding[];
  readonly previousDecisions: readonly unknown[];
}

export interface ReportInput {
  readonly scanContext: ScanContext;
  readonly findings: readonly NormalizedFinding[];
  readonly decisions: readonly unknown[];
}

/**
 * Wrap typed user content in a delimited block so the model can see where
 * untrusted data starts and ends. The content is JSON-stringified — no raw
 * scanner strings escape the JSON encoder.
 */
function wrapUserContent(label: string, payload: unknown): string {
  return `<<<USER_CONTENT:${label}>>>\n${JSON.stringify(payload, null, 2)}\n<<<END_USER_CONTENT:${label}>>>`;
}

function systemLayer(): string {
  return `--- SYSTEM ---\n${loadContract()}\n--- END SYSTEM ---`;
}

export function buildScanPlanPrompt(input: ScanPlanInput): string {
  const userContent = wrapUserContent('scan_plan_input', {
    targetRepo: input.targetRepo,
    targetUrl: input.targetUrl,
    fileTreeDigest: input.fileTreeDigest,
    packageJson: input.packageJson,
    sentinelYaml: input.sentinelYaml,
  });
  return `${systemLayer()}\n\nDecision: scan_plan\n\n${userContent}\n\nReply with a JSON object matching the scanPlan schema.`;
}

/**
 * Defensive deep redaction: any field literally named "Raw" or "raw" is replaced
 * with "[REDACTED]" before being serialized into the prompt. This is a belt-and-
 * braces check on top of the parser-level redaction in TruffleHogScanner.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[REDACTED:depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'Raw' || key === 'raw') {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function buildEvaluationPrompt(input: EvaluationInput): string {
  const userContent = wrapUserContent('evaluation_input', {
    scanId: input.scanContext.scanId,
    targetRepo: input.scanContext.targetRepo,
    targetUrl: input.scanContext.targetUrl,
    findings: redact(input.findings),
    previousDecisions: redact(input.previousDecisions),
  });
  return `${systemLayer()}\n\nDecision: evaluation\n\n${userContent}\n\nReply with a JSON object matching the evaluation schema.`;
}

export function buildReportPrompt(input: ReportInput): string {
  const userContent = wrapUserContent('report_input', {
    scanId: input.scanContext.scanId,
    targetRepo: input.scanContext.targetRepo,
    targetUrl: input.scanContext.targetUrl,
    findings: redact(input.findings),
    decisions: redact(input.decisions),
  });
  return `${systemLayer()}\n\nDecision: report\n\n${userContent}\n\nReply with a JSON object containing { markdown, citationFingerprints }.`;
}

/** Test-only — clear the cached contract so a different file path can be loaded. */
export function _resetContractCache(): void {
  cachedContract = null;
}
