/**
 * `sentinel start` — runs an end-to-end scan.
 *
 * Wires together: config → scan record → PipelineService → CorrelationService
 * → severity normalizer → markdown report → persistence. Exits with the codes
 * defined in CLAUDE.md.
 *
 * Two-layer design:
 *   - `startCommand(options, deps)` is the pure orchestrator — accepts injected
 *     dependencies, easy to test
 *   - `runStartCommand(options)` is the runtime entry — bootstraps a NestJS
 *     application context, resolves the dependencies, and calls `startCommand`
 *
 * The CLI in `src/cli.ts` invokes `runStartCommand`. Tests invoke `startCommand`
 * directly with mocked deps.
 */

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rootLogger } from '../../common/logger.js';
import { normalizeSeverity } from '../../correlation/severity-normalizer.js';
import { CorrelationService } from '../../correlation/correlation.service.js';
import { PipelineService } from '../../pipeline/pipeline.service.js';
import { MarkdownRenderer } from '../../report/renderers/markdown.renderer.js';
import { JsonRenderer } from '../../report/renderers/json.renderer.js';
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

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

export async function startCommand(options: StartOptions, deps: StartDeps): Promise<number> {
  const scanId = randomUUID();
  const repoAbs = toForwardSlash(resolvePath(options.repo));
  const context: ScanContext = {
    scanId,
    targetRepo: repoAbs,
    targetUrl: options.url,
    governed: options.governed ?? false,
    scannerTimeoutMs: 30 * 60 * 1000,
    scannerImage: 'sentinel-scanner:latest',
  };

  // Validate the repo exists before kicking off the pipeline.
  try {
    const stat = statSync(repoAbs);
    if (!stat.isDirectory()) {
      rootLogger.error({ repo: repoAbs }, 'target repo is not a directory');
      return 3;
    }
  } catch (err) {
    rootLogger.error(
      { repo: repoAbs, err: (err as Error).message },
      'target repo not found',
    );
    return 3;
  }

  rootLogger.info(
    { scanId, repo: repoAbs, url: options.url, governed: context.governed, phases: options.phases },
    'starting scan',
  );

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
      targetRepo: repoAbs,
      ...(options.url !== undefined && { targetUrl: options.url }),
    };
    const markdown = deps.markdown.render(reportInput);
    const jsonReport = deps.json.stringify(reportInput);

    const workspaceDir = join(options.workspacesRoot ?? 'workspaces', scanId, 'deliverables');
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(join(workspaceDir, 'report.md'), markdown, 'utf8');
    writeFileSync(join(workspaceDir, 'report.json'), jsonReport, 'utf8');

    // Print a per-scanner summary so the user can see what actually ran.
    for (const r of summary.scannerResults) {
      const status = r.success ? 'OK' : 'FAIL';
      const note = r.error !== undefined ? ` (${r.error.split('\n')[0]?.slice(0, 120) ?? ''})` : '';
      rootLogger.info(
        { scanner: r.scanner, status, findings: r.findings.length, durationMs: r.executionTimeMs },
        `[${status}] ${r.scanner}: ${r.findings.length} findings, ${r.executionTimeMs}ms${note}`,
      );
    }

    rootLogger.info(
      {
        scanId,
        findingsCount: normalized.length,
        durationMs: summary.durationMs,
        reportPath: join(workspaceDir, 'report.md'),
      },
      `scan complete — ${normalized.length} findings, ${summary.durationMs}ms`,
    );

    return normalized.length > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootLogger.error({ scanId, err: message }, 'scan failed');
    return 1;
  }
}

/**
 * Runtime entry for the CLI — bootstraps a NestJS application context,
 * resolves PipelineService + CorrelationService + renderers, calls
 * `startCommand`, and closes the context.
 */
export async function runStartCommand(options: StartOptions): Promise<number> {
  // Lazy-loaded so unit tests of `startCommand` don't pull NestJS bootstrap in.
  const nestCore = await import('@nestjs/core');
  const appModuleMod = await import('../../app.module.js');

  type Ctx = Awaited<ReturnType<typeof nestCore.NestFactory.createApplicationContext>>;
  let app: Ctx | null = null;
  try {
    app = await nestCore.NestFactory.createApplicationContext(appModuleMod.AppModule, {
      logger: false,
    });

    const deps: StartDeps = {
      pipeline: app.get(PipelineService),
      correlation: app.get(CorrelationService),
      markdown: app.get(MarkdownRenderer),
      json: app.get(JsonRenderer),
    };
    return await startCommand(options, deps);
  } catch (err) {
    rootLogger.error(
      { err: (err as Error).message },
      'failed to bootstrap NestJS application context',
    );
    return 1;
  } finally {
    if (app !== null) {
      try {
        await app.close();
      } catch {
        // ignore
      }
    }
  }
}
