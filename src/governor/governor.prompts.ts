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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';
import type { ScanContext } from '../scanner/types/scanner.interface.js';

// Resolve relative to the package root (two levels up from src/governor/),
// not process.cwd(), so the contract is found regardless of invocation directory.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'governor-templates', 'CLAUDE.md');

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
  /**
   * Auto-discovered OpenAPI spec URL (when the target URL serves one at a
   * well-known path) OR user-supplied --openapi value. When present, the
   * governor should enable schemathesis in its scan plan. When absent,
   * schemathesis is skipped per the governor contract.
   */
  readonly openApiSpec?: string;
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
    openApiSpec: input.openApiSpec,
    fileTreeDigest: input.fileTreeDigest,
    packageJson: input.packageJson,
    sentinelYaml: input.sentinelYaml,
  });
  return [
    systemLayer(),
    '',
    'Decision: scan_plan',
    '',
    userContent,
    '',
    'Instructions:',
    '1. Detect the exact tech stack from the file tree and package manifest. Be specific (e.g., "NestJS 11 with Prisma ORM" not "Node.js app").',
    '2. Choose Semgrep rule packs that match the stack precisely. NEVER use p/default alone — it generates cross-language noise.',
    '3. Disable scanners that do not apply. If no targetUrl is provided, disable subfinder, httpx, nuclei, nmap, schemathesis.',
    '4. If a targetUrl is provided, configure Nuclei templates for the detected stack only. Never run the full template set.',
    '5. Identify the top 5 attack surface priorities based on the file tree (auth, payment, file upload, admin, user input).',
    '',
    'Reply with a JSON object matching the scanPlan schema.',
  ].join('\n');
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
  return [
    systemLayer(),
    '',
    'Decision: evaluation',
    '',
    userContent,
    '',
    'Instructions:',
    '1. Apply the False Positive Verification Checklist to EVERY finding before deciding to keep, discard, or escalate.',
    '2. For each finding, check: Tech Stack Match, Code Reachability, Contextual Justification, Scanner Confidence, Evidence Completeness.',
    '3. Discard findings that fail 2+ checklist items. Document WHICH items failed and WHY.',
    '4. Only escalate findings at HIGH or MEDIUM confidence with explicit scanner evidence. Never escalate LOW confidence findings.',
    '5. Cross-correlate findings across scanners. Trivy CVE + Semgrep taint on the same code path = upgrade severity. Nuclei match without corroboration = downgrade.',
    '6. Maximum 10 escalations to Shannon. Rank by exploitability and take the top candidates.',
    '7. Include confidence level (HIGH/MEDIUM/LOW) and evidenceChain for every escalation.',
    '8. Common false positives to watch for:',
    '   - Dockerfile lint rules (WORKDIR, HEALTHCHECK, USER) from Trivy IaC — these are NOT security vulnerabilities',
    '   - spawn-shell-true in code with documented Windows .cmd compatibility justification — intentional pattern',
    '   - devDependency CVEs — test/build tools that never run in production',
    '   - Nuclei template matches for wrong tech stack (WordPress templates on NestJS)',
    '   - Test fixture secrets in __tests__/ or *.spec.* files',
    '   - Public keys reported as secrets by TruffleHog',
    '',
    'Reply with a JSON object matching the evaluation schema.',
  ].join('\n');
}

export function buildReportPrompt(input: ReportInput): string {
  const userContent = wrapUserContent('report_input', {
    scanId: input.scanContext.scanId,
    targetRepo: input.scanContext.targetRepo,
    targetUrl: input.scanContext.targetUrl,
    findings: redact(input.findings),
    decisions: redact(input.decisions),
  });
  return [
    systemLayer(),
    '',
    'Decision: report',
    '',
    userContent,
    '',
    'Instructions:',
    '1. Before writing, verify EVERY finding you plan to include:',
    '   - The fingerprint MUST exist in the findings array above. If it does not exist, the finding does not exist.',
    '   - The file path MUST match the finding\'s filePath field exactly. Do not invent or guess file paths.',
    '   - The CVE ID MUST match the finding\'s cveId field exactly. Do not cite CVEs from memory.',
    '   - The scanner name MUST match the finding\'s scanner field. Do not attribute findings to scanners that did not report them.',
    '2. Do NOT describe vulnerabilities that no scanner reported. Every claim must trace to a fingerprint.',
    '3. Do NOT use speculative language ("could potentially", "might allow") without scanner evidence.',
    '4. Do NOT pad the report with generic security advice. Only include remediation specific to actual findings.',
    '5. Do NOT inflate severity. Match severity to evidence, not intuition.',
    '6. Include a "Noise Filtered" section listing discarded findings and reasons — transparency builds trust.',
    '7. Include a "Caveats" section noting any scanner that was skipped, any auth limitations, any scope restrictions.',
    '8. Cross-correlate findings from different scanners and explain the connections explicitly.',
    '9. The citationFingerprints array must contain ONLY fingerprints from the findings array. No invented fingerprints.',
    '',
    'Reply with a JSON object containing { markdown, citationFingerprints }.',
  ].join('\n');
}

/** Test-only — clear the cached contract so a different file path can be loaded. */
export function _resetContractCache(): void {
  cachedContract = null;
}
