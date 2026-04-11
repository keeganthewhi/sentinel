/**
 * `sentinel report <id>` — render a previously persisted scan report.
 */

import type { ScanRepository } from '../../persistence/scan.repository.js';
import type { FindingRepository } from '../../persistence/finding.repository.js';
import type { MarkdownRenderer } from '../../report/renderers/markdown.renderer.js';
import type { JsonRenderer } from '../../report/renderers/json.renderer.js';
import type { NormalizedFinding } from '../../scanner/types/finding.interface.js';

export type ReportFormat = 'markdown' | 'json';

export interface ReportOptions {
  readonly scanId: string;
  // Widened to string so the runtime guard below can reject unknown formats from the CLI.
  readonly format: string;
}

export interface ReportDeps {
  readonly scans: ScanRepository;
  readonly findings: FindingRepository;
  readonly markdown: MarkdownRenderer;
  readonly json: JsonRenderer;
}

export async function reportCommand(options: ReportOptions, deps: ReportDeps): Promise<string> {
  if (options.format !== 'markdown' && options.format !== 'json') {
    throw new Error(`Unknown --format value: ${options.format} (expected markdown or json)`);
  }

  const scan = await deps.scans.findById(options.scanId);
  if (scan === null) {
    throw new Error(`Scan not found: ${options.scanId}`);
  }

  const rows = await deps.findings.findAllByScanId(options.scanId);
  // Drop DB-only columns to fit the NormalizedFinding interface used by renderers.
  const findings: NormalizedFinding[] = rows.map((row) => ({
    scanner: row.scanner,
    fingerprint: row.fingerprint,
    title: row.title,
    description: row.description,
    severity: row.severity as NormalizedFinding['severity'],
    category: row.category as NormalizedFinding['category'],
    normalizedScore: row.normalizedScore,
    cveId: row.cveId ?? undefined,
    cweId: row.cweId ?? undefined,
    filePath: row.filePath ?? undefined,
    lineNumber: row.lineNumber ?? undefined,
    endpoint: row.endpoint ?? undefined,
    evidence: row.evidence ?? undefined,
    exploitProof: row.exploitProof ?? undefined,
    remediation: row.remediation ?? undefined,
  }));

  const reportInput = {
    scanId: scan.id,
    findings,
    durationMs:
      scan.completedAt !== null ? scan.completedAt.getTime() - scan.startedAt.getTime() : 0,
    targetRepo: scan.targetRepo,
    ...(scan.targetUrl !== null && { targetUrl: scan.targetUrl }),
  };

  if (options.format === 'json') {
    return deps.json.stringify(reportInput);
  }
  return deps.markdown.render(reportInput);
}
