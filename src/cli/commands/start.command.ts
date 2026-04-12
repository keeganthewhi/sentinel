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
import { discoverOpenApiSpec } from '../../scanner/scanners/schemathesis.scanner.js';
import type { ScanContext } from '../../scanner/types/scanner.interface.js';
import type { NormalizedFinding } from '../../scanner/types/finding.interface.js';
import type { ScanSummary } from '../../pipeline/types.js';

export interface StartOptions {
  readonly repo: string;
  readonly url?: string;
  readonly openApiSpec?: string;
  readonly governed?: boolean;
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
  // Auto-discover an OpenAPI spec BEFORE we construct the scan context.
  // Doing it here — rather than inside the schemathesis scanner — lets the
  // governor's scan plan see the spec in its plan input and choose to
  // enable schemathesis. If we leave it to the scanner, the governor's
  // enabledScanners allow-list will already have pruned schemathesis
  // before the scanner's own execute() runs.
  let resolvedOpenApiSpec = options.openApiSpec;
  if (
    (resolvedOpenApiSpec === undefined || resolvedOpenApiSpec.trim() === '') &&
    options.url !== undefined &&
    options.url.trim() !== ''
  ) {
    const discovered = await discoverOpenApiSpec(options.url);
    if (discovered !== null) {
      rootLogger.info({ openApiSpec: discovered }, 'auto-discovered OpenAPI spec');
      resolvedOpenApiSpec = discovered;
    }
  }

  const context: ScanContext = {
    scanId,
    targetRepo: repoAbs,
    targetUrl: options.url,
    openApiSpec: resolvedOpenApiSpec,
    governed: options.governed ?? false,
    // 12-hour per-scanner budget. This is an UPPER BOUND, not a wait — Phase
    // 1 and Phase 2 scanners still finish in single-digit minutes against a
    // volume-backed workspace and return immediately. The ceiling exists for
    // Phase 3 Shannon, which is an autonomous 5-phase AI-DAST pipeline
    // (pre-recon → recon → vuln-exploitation → reporting) whose wall-clock
    // scales with repo size: the 1 MB Sentinel repo took 64 minutes, but
    // real-world monorepos (NestJS + Next.js + workers, 50k+ files) can
    // easily push Shannon past 6-8 hours while it walks each module,
    // reasons about reachability, and tries exploits. 12 hours keeps us
    // bounded while never cutting a legitimate scan short.
    scannerTimeoutMs: 12 * 60 * 60 * 1000,
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
    // `--governed` is the single AI-mode switch. It turns on every AI
    // feature: the governor plan / evaluation / report, Phase 3 Shannon
    // exploitation, and (when no `--url` is given) Shannon's code-only
    // pipeline. Non-governed scans run phases 1+2 only, mechanically, with
    // no AI subprocess anywhere. An explicit `--phases` still wins for
    // advanced users who want to e.g. run Phase 3 without the governor.
    const resolvedPhases: readonly (1 | 2 | 3)[] | undefined =
      options.phases ?? (options.governed === true ? [1, 2, 3] : undefined);

    const summary = await deps.pipeline.run({
      context,
      phases: resolvedPhases,
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
    // Prefer the governor's AI-authored markdown (if present and validated),
    // otherwise fall back to the mechanical renderer. JSON always comes from
    // the mechanical renderer so downstream diff / regression / persistence
    // paths get a deterministic shape.
    const markdown = summary.aiAuthoredMarkdown ?? deps.markdown.render(reportInput);
    const jsonReport = deps.json.stringify(reportInput);

    const workspaceDir = join(options.workspacesRoot ?? 'workspaces', scanId, 'deliverables');
    mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });
    // Deliverables contain full finding details, CVE IDs, governor AI
    // responses, and potentially sensitive file paths. Restrict to
    // owner-read/write only (0o600) so other host users can't access them.
    writeFileSync(join(workspaceDir, 'report.md'), markdown, { encoding: 'utf8', mode: 0o600 });
    writeFileSync(join(workspaceDir, 'report.json'), jsonReport, { encoding: 'utf8', mode: 0o600 });
    writeFileSync(
      join(workspaceDir, 'governor-decisions.json'),
      JSON.stringify(summary.governorDecisions, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );

    // Print a per-scanner summary so the user can see what actually ran.
    for (const r of summary.scannerResults) {
      const status = r.success ? 'OK' : 'FAIL';
      const note = r.error !== undefined ? ` (${r.error.split('\n')[0]?.slice(0, 120) ?? ''})` : '';
      rootLogger.info(
        { scanner: r.scanner, status, findings: r.findings.length, durationMs: r.executionTimeMs },
        `[${status}] ${r.scanner}: ${r.findings.length} findings, ${r.executionTimeMs}ms${note}`,
      );
    }

    // Surface the governor audit trail.
    if (summary.governorDecisions.length > 0) {
      for (const decision of summary.governorDecisions) {
        const tag = decision.fallback ? 'FALLBACK' : 'OK';
        rootLogger.info(
          {
            governor: decision.decisionType,
            phase: decision.phase,
            tag,
            rationale: decision.rationale?.slice(0, 120),
          },
          `[governor ${tag}] ${decision.decisionType} (phase ${decision.phase})`,
        );
      }
    }

    // Best-effort SQLite persistence. If better-sqlite3's native binding is
    // missing (fresh checkout on Windows without MSVC build tools), this is
    // a no-op — the scan and reports still succeed.
    await tryPersistScan({
      scanId,
      targetRepo: repoAbs,
      targetUrl: options.url,
      governed: options.governed === true,
      findings: normalized,
      summary,
    });

    rootLogger.info(
      {
        scanId,
        findingsCount: normalized.length,
        durationMs: summary.durationMs,
        aiAuthored: summary.aiAuthoredMarkdown !== undefined,
        reportPath: join(workspaceDir, 'report.md'),
      },
      `scan complete — ${normalized.length} findings, ${summary.durationMs}ms${summary.aiAuthoredMarkdown !== undefined ? ' (AI-authored report)' : ''}`,
    );

    return normalized.length > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootLogger.error({ scanId, err: message }, 'scan failed');
    return 1;
  }
}

/**
 * Best-effort SQLite persistence: create a Scan row, insert every finding,
 * and append the governor decision audit log. Catches every error — including
 * better-sqlite3 native binding failures — so persistence stays optional and
 * never blocks the mechanical scan path.
 */
interface PersistInput {
  readonly scanId: string;
  readonly targetRepo: string;
  readonly targetUrl?: string;
  readonly governed: boolean;
  readonly findings: readonly NormalizedFinding[];
  readonly summary: ScanSummary;
}

async function tryPersistScan(input: PersistInput): Promise<void> {
  try {
    const { tryCreatePrismaClient } = await import('../../persistence/prisma.client.js');
    const prisma = tryCreatePrismaClient();
    if (prisma === null) {
      // tryCreatePrismaClient already logged the reason.
      return;
    }

    const { ScanRepository } = await import('../../persistence/scan.repository.js');
    const { FindingRepository } = await import('../../persistence/finding.repository.js');
    const { GovernorDecisionRepository } = await import(
      '../../persistence/governor-decision.repository.js'
    );

    const scans = new ScanRepository(prisma);
    const findings = new FindingRepository(prisma);
    const decisions = new GovernorDecisionRepository(prisma);

    // Upsert the scan row.
    // The ID is client-generated (UUID), not prisma-generated cuid, so we use
    // `scan.upsert` via a raw create + ignore-on-conflict pattern. Prisma
    // does not auto-upsert by non-@id unique fields, so we create-only here
    // and accept duplicate scanIds would fail — they won't in practice
    // because scanIds are UUIDv4.
    await prisma.scan.create({
      data: {
        id: input.scanId,
        targetRepo: input.targetRepo,
        targetUrl: input.targetUrl ?? null,
        governed: input.governed,
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - input.summary.durationMs),
        completedAt: new Date(),
      },
    });

    if (input.findings.length > 0) {
      await findings.insertMany(input.scanId, [...input.findings]);
    }

    for (const decision of input.summary.governorDecisions) {
      await decisions.record({
        scanId: input.scanId,
        phase: decision.phase,
        decisionType: decision.decisionType === 'scan_plan'
          ? 'scan_plan'
          : decision.decisionType === 'report'
            ? 'report'
            : 'evaluation',
        input: decision.input,
        output: decision.output,
        rationale: decision.rationale,
      });
    }

    await prisma.$disconnect();

    rootLogger.info(
      {
        scanId: input.scanId,
        findings: input.findings.length,
        governorDecisions: input.summary.governorDecisions.length,
      },
      'persisted scan to sqlite (tolerant)',
    );

    // Mark unused ScanRepository import — it's here as a logical grouping.
    void scans;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rootLogger.warn(
      { scanId: input.scanId, err: message },
      'sqlite persistence skipped — scan + reports unaffected',
    );
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
