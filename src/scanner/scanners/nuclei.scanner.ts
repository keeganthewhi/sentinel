/**
 * Nuclei scanner — template-based vulnerability scanning.
 *
 * Command: `nuclei -jsonl -silent -t <templates> -u <url> -rate-limit <N>`
 * Default templates: `cves/,misconfiguration/,exposed-panels/`
 *
 * Nuclei emits progress output on stderr even with `-silent` — the Phase E
 * worker must NOT treat non-empty stderr as a crash indicator.
 */

import { z } from 'zod';
import { parseJsonLines, ParseError } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';
import { runScannerInDocker, withFindings } from './runner.helper.js';

const SEVERITY_MAP: Readonly<Record<string, Severity>> = Object.freeze({
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
  unknown: 'INFO',
});

function normalizeSeverity(raw: string | undefined): Severity {
  if (raw === undefined) return 'INFO';
  return SEVERITY_MAP[raw.toLowerCase()] ?? 'INFO';
}

const InfoSchema = z
  .object({
    name: z.string().optional(),
    severity: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    reference: z.array(z.string()).optional(),
    classification: z
      .object({
        'cve-id': z.union([z.string(), z.array(z.string())]).optional(),
        'cwe-id': z.union([z.string(), z.array(z.string())]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const NucleiLineSchema = z
  .object({
    'template-id': z.string().optional(),
    'template-path': z.string().optional(),
    info: InfoSchema.optional(),
    type: z.string().optional(),
    host: z.string().optional(),
    'matched-at': z.string().optional(),
    matcher_name: z.string().optional(),
  })
  .passthrough();

function firstOf(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return value[0];
}

export class NucleiScanner extends BaseScanner {
  public readonly name = 'nuclei';
  public readonly phase = 2 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    const targets: string[] = [];
    if (context.targetUrl !== undefined) targets.push(context.targetUrl);
    for (const ep of context.discoveredEndpoints ?? []) targets.push(ep);
    if (targets.length === 0) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
        error: 'skipped: no targets',
      };
    }
    const command: string[] = [
      'nuclei',
      '-jsonl',
      '-silent',
      '-disable-update-check',
      // Templates are baked into the scanner image at /opt/nuclei-templates via
      // a shallow git clone in docker/scanner.Dockerfile. Scoping to http/cves
      // + http/misconfiguration + http/exposed-panels keeps the scan tractable
      // on a single URL and matches AGENTS-full.md AGF::NucleiScanner defaults.
      '-t',
      '/opt/nuclei-templates/http/cves/',
      '-t',
      '/opt/nuclei-templates/http/misconfiguration/',
      '-t',
      '/opt/nuclei-templates/http/exposed-panels/',
    ];
    for (const t of targets) command.push('-u', t);
    const outcome = await runScannerInDocker({
      scanner: this,
      executor: this.executor,
      context,
      command,
    });
    if (!outcome.ok) return outcome.result;
    try {
      const findings = this.parseOutput(outcome.stdout);
      return withFindings(outcome, findings);
    } catch (err) {
      const message = err instanceof ParseError ? err.message : String(err);
      return { ...outcome.result, success: false, error: `parse failure: ${message}` };
    }
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];
    const records = parseJsonLines(raw, NucleiLineSchema, this.name);
    const findings: NormalizedFinding[] = [];

    for (const record of records) {
      const templateId = record['template-id'] ?? 'nuclei-unknown';
      const info = record.info;
      const title = info?.name ?? templateId;
      const description = info?.description ?? `Nuclei template ${templateId} matched`;
      const matchedAt = record['matched-at'] ?? record.host;
      const severity = normalizeSeverity(info?.severity);
      const cveId = firstOf(info?.classification?.['cve-id']);
      const cweId = firstOf(info?.classification?.['cwe-id']);

      findings.push({
        scanner: this.name,
        fingerprint: shortHash(`nuclei:${templateId}:${matchedAt ?? ''}`),
        title,
        description,
        severity,
        category: 'dast',
        normalizedScore: 0,
        cveId,
        cweId,
        endpoint: matchedAt,
      });
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
