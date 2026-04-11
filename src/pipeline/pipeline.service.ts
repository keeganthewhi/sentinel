/**
 * PipelineService — top-level scan orchestrator.
 *
 * Responsibilities:
 *   - Run Phase 1 (static scanners) via the pipeline runner
 *   - Merge Phase 1 discoveries (subdomains, endpoints) into the Phase 2 context
 *   - Run Phase 2 (infrastructure scanners)
 *   - Collect all findings and scanner results into a ScanSummary
 *   - Honour the `options.phases` filter
 *
 * Scanner failures are recorded, not propagated. A failing scanner never
 * crashes the pipeline.
 */

import { Injectable } from '@nestjs/common';
import { runPhase } from './phases/phase-runner.js';
import { InMemoryPipelineRunner } from './in-memory.runner.js';
import { ScannerRegistry } from '../scanner/scanner.registry.js';
import { ProgressEmitter } from '../report/progress/progress.emitter.js';
import { createLogger } from '../common/logger.js';
import type {
  ScanContext,
  ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { NormalizedFinding } from '../scanner/types/finding.interface.js';
import type { PipelineRunOptions, ScanSummary, IPipelineRunner } from './types.js';
import { HttpxScanner } from '../scanner/scanners/httpx.scanner.js';
import { SubfinderScanner } from '../scanner/scanners/subfinder.scanner.js';

const ALL_PHASES: readonly (1 | 2 | 3)[] = [1, 2];

@Injectable()
export class PipelineService {
  private readonly logger = createLogger({ module: 'pipeline.service' });

  constructor(
    private readonly registry: ScannerRegistry,
    private readonly runner: InMemoryPipelineRunner,
    private readonly emitter: ProgressEmitter,
  ) {}

  /** Override the runner at call time — used by the CLI when Redis is available. */
  public async run(options: PipelineRunOptions, runner?: IPipelineRunner): Promise<ScanSummary> {
    const activeRunner = runner ?? this.runner;
    const startedAt = Date.now();
    const scanId = options.context.scanId;
    const selectedPhases = options.phases ?? ALL_PHASES;
    const executedPhases: (1 | 2 | 3)[] = [];

    const allResults: ScannerResult[] = [];
    const allFindings: NormalizedFinding[] = [];
    let context: ScanContext = options.context;

    // Phase 1
    if (selectedPhases.includes(1)) {
      const phase1Results = await runPhase(1, this.registry, activeRunner, context, this.emitter);
      allResults.push(...phase1Results);

      // Enrich context from subfinder / httpx results.
      context = this.mergeDiscoveries(context, phase1Results);

      for (const r of phase1Results) allFindings.push(...r.findings);
      executedPhases.push(1);
    }

    // Phase 2
    if (selectedPhases.includes(2)) {
      const phase2Context: ScanContext = { ...context, phase1Findings: [...allFindings] };
      const phase2Results = await runPhase(2, this.registry, activeRunner, phase2Context, this.emitter);
      allResults.push(...phase2Results);
      for (const r of phase2Results) allFindings.push(...r.findings);
      executedPhases.push(2);
    }

    const durationMs = Date.now() - startedAt;
    this.logger.info(
      {
        scanId,
        durationMs,
        phases: executedPhases,
        findingsCount: allFindings.length,
        scannerResults: allResults.length,
      },
      'pipeline run complete',
    );

    return {
      scanId,
      findings: allFindings,
      scannerResults: allResults,
      durationMs,
      executedPhases,
    };
  }

  /** Merge subfinder + httpx findings into the context for Phase 2 consumers. */
  private mergeDiscoveries(
    context: ScanContext,
    phase1Results: readonly ScannerResult[],
  ): ScanContext {
    const subdomains = new Set<string>(context.discoveredSubdomains ?? []);
    const endpoints = new Set<string>(context.discoveredEndpoints ?? []);
    const subfinder = new SubfinderScanner();
    const httpx = new HttpxScanner();

    for (const result of phase1Results) {
      if (result.scanner === subfinder.name && result.rawOutput.length > 0) {
        for (const host of subfinder.collectSubdomains(result.rawOutput)) {
          subdomains.add(host);
        }
      }
      if (result.scanner === httpx.name && result.rawOutput.length > 0) {
        for (const endpoint of httpx.collectEndpoints(result.rawOutput)) {
          endpoints.add(endpoint.url);
        }
      }
    }

    return {
      ...context,
      discoveredSubdomains: [...subdomains],
      discoveredEndpoints: [...endpoints],
    };
  }
}
