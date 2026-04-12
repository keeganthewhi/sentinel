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
    //   --metrics off     — suppress phone-home
    //   --quiet           — suppress progress noise (we parse JSON on stdout)
    //   --timeout 30      — per-rule wall-clock cap in seconds (semgrep internal)
    //   --timeout-threshold 3 — bail on files that trip the per-rule timeout 3+ times
    //   --max-target-bytes 1000000 — skip files > 1 MB (usually minified bundles / snapshots)
    // The --exclude list mirrors trivy.scanner.ts so large monorepos with
    // editor/agent caches don't tip the 30-min executor timeout.
    // Rule pack selection:
    //   `p/default` is Semgrep's curated meta-pack (~2400 rules). It's the
    //   highest-signal config and fast enough now that the pipeline mounts a
    //   pre-populated Docker volume instead of a 9P bind mount. Smaller packs
    //   like `p/ci`, `p/javascript`, `p/typescript`, and `p/security-audit`
    //   were tested on this monorepo and produced zero findings for obvious
    //   issues (eval, hardcoded secrets) — only `p/default` actually fires.
    const command = [
      'semgrep',
      '--config',
      'p/default',
      '--json',
      '--quiet',
      '--metrics',
      'off',
      '--timeout',
      '30',
      '--timeout-threshold',
      '3',
      '--max-target-bytes',
      '1000000',
      '--exclude', 'node_modules',
      '--exclude', 'dist',
      '--exclude', 'build',
      '--exclude', '.next',
      '--exclude', 'coverage',
      '--exclude', '.claude',
      '--exclude', '.cursor',
      '--exclude', '.agent',
      '--exclude', '.agents',
      '--exclude', '.cache',
      '--exclude', '.playwright-mcp',
      '--exclude', '.husky',
      '--exclude', '.github',
      '--exclude', '*.min.js',
      '--exclude', '*.bundle.js',
      '--exclude', '*.map',
      '--exclude', 'pnpm-lock.yaml',
      '--exclude', 'package-lock.json',
      '--exclude', 'yarn.lock',
      '/workspace',
    ];
    // Semgrep needs network to fetch rules from semgrep.dev when using
    // --config p/default. Cannot use network: 'none'.
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
