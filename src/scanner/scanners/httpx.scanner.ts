/**
 * httpx scanner — HTTP endpoint prober.
 *
 * Command: `httpx -json -status-code -tech-detect -l /tmp/hosts.txt`
 * Input: hosts list from `context.discoveredSubdomains` (written to a temp file inside the container by the Phase E worker).
 * Output: newline-delimited JSON records, one per probed host.
 *
 * httpx does NOT produce findings — it enriches `context.discoveredEndpoints`.
 */

import { z } from 'zod';
import { parseJsonLines } from '../../execution/output-parser.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding } from '../types/finding.interface.js';

const HttpxLineSchema = z
  .object({
    url: z.string(),
    status_code: z.number().int().optional(),
    tech: z.array(z.string()).optional(),
    title: z.string().optional(),
    webserver: z.string().optional(),
  })
  .passthrough();

export interface HttpxEndpoint {
  readonly url: string;
  readonly statusCode?: number;
  readonly technologies: readonly string[];
}

export class HttpxScanner extends BaseScanner {
  public readonly name = 'httpx';
  public readonly phase = 1 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    if (
      context.targetUrl === undefined &&
      (context.discoveredSubdomains === undefined || context.discoveredSubdomains.length === 0)
    ) {
      return Promise.resolve({
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
      });
    }
    return Promise.resolve({
      scanner: this.name,
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    });
  }

  public parseOutput(_raw: string): readonly NormalizedFinding[] {
    return [];
  }

  /**
   * Collect probed endpoints from raw httpx output.
   * Exposed as a separate method so the Phase E worker can enrich ScanContext.
   */
  public collectEndpoints(raw: string): HttpxEndpoint[] {
    if (raw.trim() === '') return [];
    const records = parseJsonLines(raw, HttpxLineSchema, this.name);
    return records.map((record) => ({
      url: record.url,
      statusCode: record.status_code,
      technologies: record.tech ?? [],
    }));
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
