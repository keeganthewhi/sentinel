/**
 * Subfinder scanner — passive subdomain enumeration.
 *
 * Command: `subfinder -d <domain> -json`
 * Only runs when `context.targetUrl` is set (the domain is extracted from the URL).
 *
 * Subfinder does NOT produce findings — it populates discovered subdomains that
 * httpx, nuclei, and nmap consume. The parser returns a plain string[] via
 * `collectSubdomains`; the Phase E worker writes them into `ScanContext`.
 */

import { z } from 'zod';
import { parseJsonLines } from '../../execution/output-parser.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding } from '../types/finding.interface.js';
import { runScannerInDocker } from './runner.helper.js';

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const SubfinderLineSchema = z
  .object({
    host: z.string(),
    source: z.string().optional(),
  })
  .passthrough();

export class SubfinderScanner extends BaseScanner {
  public readonly name = 'subfinder';
  public readonly phase = 1 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    if (context.targetUrl === undefined || context.targetUrl.trim() === '') {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
        error: 'skipped: no targetUrl',
      };
    }
    const domain = extractDomain(context.targetUrl);
    if (domain === null) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: false,
        error: `invalid targetUrl: ${context.targetUrl}`,
      };
    }
    // Filter domains starting with '-' to prevent flag injection.
    if (domain.startsWith('-')) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: false,
        error: `invalid domain: starts with dash`,
      };
    }
    const command = ['subfinder', '-silent', '-d', domain, '-json'];
    const outcome = await runScannerInDocker({
      scanner: this,
      executor: this.executor,
      context,
      command,
    });
    return outcome.result;
  }

  public parseOutput(_raw: string): readonly NormalizedFinding[] {
    // Subfinder never produces NormalizedFinding entries.
    return [];
  }

  /**
   * Collect discovered hostnames from raw subfinder output.
   * Exposed as a separate method so the Phase E worker can enrich ScanContext.
   */
  public collectSubdomains(raw: string): string[] {
    if (raw.trim() === '') return [];
    const records = parseJsonLines(raw, SubfinderLineSchema, this.name, { lenient: true });
    const seen = new Set<string>();
    for (const record of records) {
      seen.add(record.host);
    }
    return [...seen];
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
