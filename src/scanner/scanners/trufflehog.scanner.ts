/**
 * TruffleHog scanner — secret scanning across a filesystem / git history.
 *
 * Command: `trufflehog filesystem --json --only-verified /workspace`
 * Output: JSON lines — one object per line.
 *
 * CRITICAL: The `Raw` field contains the actual secret value. It is replaced
 * with `[REDACTED:<shortHash(Raw)>]` in THIS parser, before any NormalizedFinding
 * leaves the function. The secret NEVER enters correlation, persistence, logger,
 * or governor code paths.
 */

import { z } from 'zod';
import { parseJsonLines } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';

const SourceMetadataSchema = z
  .object({
    Data: z
      .object({
        Filesystem: z
          .object({ file: z.string().optional(), line: z.number().int().optional() })
          .passthrough()
          .optional(),
        Git: z
          .object({
            repository: z.string().optional(),
            file: z.string().optional(),
            line: z.number().int().optional(),
            commit: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const TrufflehogLineSchema = z
  .object({
    SourceID: z.number().int().optional(),
    DetectorType: z.number().int().optional(),
    DetectorName: z.string().optional(),
    Verified: z.boolean().optional().default(false),
    Raw: z.string().optional(),
    RawV2: z.string().optional(),
    SourceMetadata: SourceMetadataSchema.optional(),
    ExtraData: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();

function stripWorkspace(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.replace(/^\/workspace\//, '').replace(/^workspace\//, '');
}

export class TruffleHogScanner extends BaseScanner {
  public readonly name = 'trufflehog';
  public readonly phase = 1 as const;
  public readonly requiresUrl = false;

  public async execute(_context: ScanContext): Promise<ScannerResult> {
    return Promise.resolve({
      scanner: this.name,
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    });
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];
    const records = parseJsonLines(raw, TrufflehogLineSchema, this.name);
    const findings: NormalizedFinding[] = [];

    for (const record of records) {
      const rawSecret = record.Raw ?? record.RawV2 ?? '';
      const secretHash = rawSecret.length > 0 ? shortHash(rawSecret) : 'empty';
      const redactedEvidence = `[REDACTED:${secretHash}]`;

      const severity: Severity = record.Verified === true ? 'HIGH' : 'MEDIUM';
      const fsMeta = record.SourceMetadata?.Data?.Filesystem;
      const gitMeta = record.SourceMetadata?.Data?.Git;
      const filePath = stripWorkspace(fsMeta?.file ?? gitMeta?.file);
      const lineNumber = fsMeta?.line ?? gitMeta?.line;
      const detector = record.DetectorName ?? 'Unknown';

      findings.push({
        scanner: this.name,
        fingerprint: shortHash(`trufflehog:${detector}:${filePath ?? ''}:${lineNumber ?? ''}:${secretHash}`),
        title: `${detector} secret detected`,
        description: `TruffleHog ${record.Verified === true ? 'verified' : 'unverified'} ${detector} match`,
        severity,
        category: 'secret',
        normalizedScore: 0,
        filePath,
        lineNumber,
        evidence: redactedEvidence,
      });
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
