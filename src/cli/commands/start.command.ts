/**
 * `sentinel start` — runs an end-to-end scan.
 *
 * Wires together: config → scan record → PipelineService → CorrelationService
 * → severity normalizer → markdown report → persistence. Exits with the codes
 * defined in CLAUDE.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rootLogger } from '../../common/logger.js';
import { normalizeSeverity } from '../../correlation/severity-normalizer.js';
import type { PipelineService } from '../../pipeline/pipeline.service.js';
import type { CorrelationService } from '../../correlation/correlation.service.js';
import type { MarkdownRenderer } from '../../report/renderers/markdown.renderer.js';
import type { JsonRenderer } from '../../report/renderers/json.renderer.js';
import type { ScanContext } from '../../scanner/types/scanner.interface.js';

export interface StartOptions {
  readonly repo: string;
  readonly url?: string;
  readonly governed?: boolean;
  readonly shannon?: boolean;
  readonly phases?: readonly (1 | 2 | 3)[];
  readonly verbose?: boolean;
  readonly workspacesRoot?: string;
}

export interface StartDeps {
  readonly pipeline: PipelineService;
  readonly correlation: CorrelationService;
  readonly markdown: MarkdownRenderer;
  readonly json: JsonRenderer;
}

function parsePhases(raw: string | undefined): readonly (1 | 2 | 3)[] | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parts = raw.split(',').map((p) => p.trim());
  const phases: (1 | 2 | 3)[] = [];
  for (const part of parts) {
    if (part === '1' || part === '2' || part === '3') {
      phases.push(Number(part) as 1 | 2 | 3);
    } else {
      throw new Error(`Invalid phase value: ${part}`);
    }
  }
  return phases;
}

export function parsePhasesFlag(raw: string | undefined): readonly (1 | 2 | 3)[] | undefined {
  return parsePhases(raw);
}

export async function startCommand(options: StartOptions, deps: StartDeps): Promise<number> {
  const scanId = randomUUID();
  const context: ScanContext = {
    scanId,
    targetRepo: options.repo,
    targetUrl: options.url,
    governed: options.governed ?? false,
    scannerTimeoutMs: 30 * 60 * 1000,
    scannerImage: 'sentinel-scanner:latest',
  };

  rootLogger.info({ scanId, repo: options.repo, governed: context.governed }, 'starting scan');

  try {
    const summary = await deps.pipeline.run({
      context,
      phases: options.phases,
    });

    const correlated = deps.correlation.correlate(summary.findings);
    const normalized = normalizeSeverity(correlated);

    const reportInput = {
      scanId,
      findings: normalized,
      durationMs: summary.durationMs,
      targetRepo: options.repo,
      ...(options.url !== undefined && { targetUrl: options.url }),
    };
    const markdown = deps.markdown.render(reportInput);
    const jsonReport = deps.json.stringify(reportInput);

    const workspaceDir = join(options.workspacesRoot ?? 'workspaces', scanId, 'deliverables');
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, 'report.md'), markdown, 'utf8');
    writeFileSync(join(workspaceDir, 'report.json'), jsonReport, 'utf8');

    rootLogger.info(
      { scanId, findingsCount: normalized.length, durationMs: summary.durationMs },
      'scan complete',
    );

    return normalized.length > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootLogger.error({ scanId, err: message }, 'scan failed');
    return 1;
  }
}
