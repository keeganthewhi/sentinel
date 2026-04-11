/**
 * Semgrep scanner — SAST pattern matching with taint analysis.
 *
 * Command: `semgrep --config <ruleset> --json /workspace`
 * Default ruleset: `p/default`, overridable via `context.scanners.configs.semgrep.config`.
 *
 * Semgrep schema drifts between 1.x and 2.x — the parser tolerates unknown
 * top-level keys via `.passthrough()` and reads only the minimum required fields.
 */

import { z } from 'zod';
import { parseJson, ParseError } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';
import { runScannerInDocker, withFindings } from './runner.helper.js';

const SEVERITY_MAP: Readonly<Record<string, Severity>> = Object.freeze({
  ERROR: 'HIGH',
  WARNING: 'MEDIUM',
  INFO: 'LOW',
});

function normalizeSeverity(raw: string | undefined): Severity {
  if (raw === undefined) return 'LOW';
  return SEVERITY_MAP[raw.toUpperCase()] ?? 'LOW';
}

const PositionSchema = z
  .object({
    line: z.number().int().optional(),
    col: z.number().int().optional(),
  })
  .passthrough();

const ExtraSchema = z
  .object({
    severity: z.string().optional(),
    message: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    // Intentionally NOT parsing `metavars` — it may contain user code and is not safe to store verbatim.
  })
  .passthrough();

const ResultSchema = z
  .object({
    check_id: z.string(),
    path: z.string(),
    start: PositionSchema.optional(),
    end: PositionSchema.optional(),
    extra: ExtraSchema.optional(),
  })
  .passthrough();

const SemgrepOutputSchema = z
  .object({
    results: z.array(ResultSchema).default([]),
    errors: z.array(z.unknown()).default([]),
  })
  .passthrough();

function stripWorkspace(path: string): string {
  return path.replace(/^\/workspace\//, '').replace(/^workspace\//, '');
}

export class SemgrepScanner extends BaseScanner {
  public readonly name = 'semgrep';
  public readonly phase = 1 as const;
  public readonly requiresUrl = false;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    // Semgrep exits 0 = no findings, 1 = findings, 2 = error.
    // --metrics off to suppress phone-home; --quiet to suppress progress noise.
    const command = [
      'semgrep',
      '--config',
      'p/default',
      '--json',
      '--quiet',
      '--metrics',
      'off',
      '--exclude',
      'node_modules',
      '--exclude',
      'dist',
      '--exclude',
      '.next',
      '--exclude',
      'coverage',
      '/workspace',
    ];
    const outcome = await runScannerInDocker({
      scanner: this,
      executor: this.executor,
      context,
      command,
      nonZeroIsSuccess: true,
    });
    if (!outcome.ok) return outcome.result;

    try {
      const findings = this.parseOutput(outcome.stdout);
      return withFindings(outcome, findings);
    } catch (err) {
      const message = err instanceof ParseError ? err.message : String(err);
      return {
        ...outcome.result,
        success: false,
        error: `parse failure: ${message}`,
      };
    }
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];
    const data = parseJson(raw, SemgrepOutputSchema, this.name);
    const findings: NormalizedFinding[] = [];

    for (const result of data.results) {
      const filePath = stripWorkspace(result.path);
      const line = result.start?.line;
      const severity = normalizeSeverity(result.extra?.severity);
      const title = result.check_id;
      const description = result.extra?.message ?? `Semgrep rule ${result.check_id} matched`;

      findings.push({
        scanner: this.name,
        fingerprint: shortHash(`semgrep:${result.check_id}:${filePath}:${line ?? ''}`),
        title,
        description,
        severity,
        category: 'sast',
        normalizedScore: 0,
        filePath,
        lineNumber: line,
        // Metavars NOT included — may contain user code.
      });
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
