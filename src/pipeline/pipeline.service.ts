/**
 * PipelineService — top-level scan orchestrator.
 *
 * Responsibilities:
 *   - Optionally call the governor plan-generator BEFORE Phase 1
 *   - Run Phase 1 (static scanners) via the pipeline runner
 *   - Optionally call the governor phase-evaluator after Phase 1
 *     (applying escalate / discard / severity-adjustment decisions)
 *   - Merge Phase 1 discoveries (subdomains, endpoints) into the Phase 2 context
 *   - Run Phase 2 (infrastructure scanners)
 *   - Optionally call the governor phase-evaluator again after Phase 2
 *   - Optionally run Phase 3 (Shannon) against governor escalations
 *   - Optionally call the governor report-writer at the end
 *   - Collect findings, scanner results, and governor decisions into a ScanSummary
 *   - Honour the `options.phases` filter
 *
 * Failure handling:
 *   - Scanner failures are recorded per CLAUDE.md Critical Invariant #3.
 *   - Governor failures (timeout / invalid JSON / spawn error) trigger a
 *     mechanical fallback per Critical Invariant #7. Each governor service
 *     swallows its own errors and returns a fallback decision; the pipeline
 *     service treats both paths identically.
 */

import { Injectable, Optional } from '@nestjs/common';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runPhase } from './phases/phase-runner.js';
import { runPhaseThree } from './phases/phase-three-exploit.js';
import { InMemoryPipelineRunner } from './in-memory.runner.js';
import { ScannerRegistry } from '../scanner/scanner.registry.js';
import { ProgressEmitter } from '../report/progress/progress.emitter.js';
import { createLogger } from '../common/logger.js';
import { HttpxScanner } from '../scanner/scanners/httpx.scanner.js';
import { SubfinderScanner } from '../scanner/scanners/subfinder.scanner.js';
import { PlanGenerator } from '../governor/plan-generator.js';
import { PhaseEvaluator } from '../governor/phase-evaluator.js';
import { ReportWriter } from '../governor/report-writer.js';
import {
  prepareWorkspaceVolume,
  removeWorkspaceVolume,
} from '../execution/workspace-volume.js';
import type {
  ScanContext,
  ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../scanner/types/finding.interface.js';
import type {
  PipelineRunOptions,
  ScanSummary,
  IPipelineRunner,
  GovernorDecisionRecord,
} from './types.js';
import type { EvaluationDecision } from '../governor/types/governor-decision.js';

const ALL_PHASES: readonly (1 | 2 | 3)[] = [1, 2];

interface EvaluationOutcome {
  readonly findings: NormalizedFinding[];
  readonly escalations: readonly string[];
  readonly decision: EvaluationDecision;
}

@Injectable()
export class PipelineService {
  private readonly logger = createLogger({ module: 'pipeline.service' });

  constructor(
    private readonly registry: ScannerRegistry,
    private readonly runner: InMemoryPipelineRunner,
    private readonly emitter: ProgressEmitter,
    @Optional() private readonly planGenerator?: PlanGenerator,
    @Optional() private readonly phaseEvaluator?: PhaseEvaluator,
    @Optional() private readonly reportWriter?: ReportWriter,
  ) {}

  /** Override the runner at call time — used by the CLI when Redis is available. */
  public async run(options: PipelineRunOptions, runner?: IPipelineRunner): Promise<ScanSummary> {
    const activeRunner = runner ?? this.runner;
    const startedAt = Date.now();
    const scanId = options.context.scanId;
    const selectedPhases = options.phases ?? ALL_PHASES;
    const executedPhases: (1 | 2 | 3)[] = [];
    const governorDecisions: GovernorDecisionRecord[] = [];

    const allResults: ScannerResult[] = [];
    const allFindings: NormalizedFinding[] = [];
    let context: ScanContext = options.context;

    // Prepare a per-scan Docker volume populated with the repo contents. Docker
    // Desktop's 9P bind mount is unusably slow for many-small-file workloads
    // on Windows — a single bulk copy into a native ext4 volume beats N × 9P
    // reads per scanner by orders of magnitude. On failure, fall back to the
    // raw bind mount so scans on non-Windows hosts keep working.
    let workspaceVolume: string | undefined;
    if (context.workspaceVolume === undefined) {
      try {
        workspaceVolume = await prepareWorkspaceVolume(
          scanId,
          context.targetRepo,
          context.scannerImage,
        );
        context = { ...context, workspaceVolume };
      } catch (err) {
        this.logger.warn(
          { scanId, err: (err as Error).message },
          'workspace volume preparation failed — falling back to 9P bind mount',
        );
      }
    }

    try {
      return await this.runInner(
        context,
        startedAt,
        activeRunner,
        selectedPhases,
        executedPhases,
        governorDecisions,
        allResults,
        allFindings,
      );
    } finally {
      if (workspaceVolume !== undefined) {
        await removeWorkspaceVolume(workspaceVolume);
      }
    }
  }

  /**
   * The actual phase orchestration. Split out of `run()` so the workspace
   * volume lifecycle can wrap it in a try/finally without piling indentation.
   */
  private async runInner(
    contextIn: ScanContext,
    startedAt: number,
    activeRunner: IPipelineRunner,
    selectedPhases: readonly (1 | 2 | 3)[],
    executedPhases: (1 | 2 | 3)[],
    governorDecisions: GovernorDecisionRecord[],
    allResults: ScannerResult[],
    allFindingsIn: NormalizedFinding[],
  ): Promise<ScanSummary> {
    let context: ScanContext = contextIn;
    let allFindings: NormalizedFinding[] = allFindingsIn;
    const scanId = context.scanId;

    // Hold local references to the governor services so TypeScript narrows
    // them inside the if-blocks below. Direct `this.planGenerator` usage
    // confuses the class-property narrower and the no-unnecessary-condition rule.
    const planGen = context.governed ? this.planGenerator : undefined;
    const phaseEval = context.governed ? this.phaseEvaluator : undefined;
    const reportW = context.governed ? this.reportWriter : undefined;

    // ---------- Governor Decision 1: scan plan (before Phase 1) ----------
    if (planGen !== undefined) {
      const planInput = this.gatherPlanInput(context);
      try {
        const planDecision = await planGen.generate(planInput, {
          scanId,
          workspacesRoot: 'workspaces',
        });
        governorDecisions.push({
          decisionType: 'scan_plan',
          phase: 0,
          input: planInput,
          output: planDecision,
          fallback: planDecision.scanPlan.rationale.includes('mechanical fallback'),
          rationale: planDecision.scanPlan.rationale,
        });
        // Honour the governor's scanner allow-list. The phase runner skips
        // any scanner not on this list. The mechanical fallback plan always
        // emits the full 8-scanner list, so a governor failure never
        // silently removes scanners from the run.
        context = {
          ...context,
          enabledScannerAllowlist: planDecision.scanPlan.enabledScanners,
        };
        this.logger.info(
          { scanId, enabled: planDecision.scanPlan.enabledScanners },
          'governor scan plan received',
        );
      } catch (err) {
        this.logger.warn(
          { scanId, err: (err as Error).message },
          'plan-generator threw unexpectedly — continuing mechanically',
        );
      }
    }

    // ---------- Phase 1 ----------
    // Holds Decision 2 (phase1_evaluation) while Phase 2 runs in parallel.
    // Decision 2 only affects finding persistence (discards, severity
    // adjustments, Shannon escalations) and does NOT influence what Phase 2
    // scanners do. Running them concurrently saves 1–5 min per scan.
    let decision2Promise: Promise<EvaluationOutcome> | null = null;
    let phase1Findings: NormalizedFinding[] = [];

    if (selectedPhases.includes(1)) {
      const phase1Results = await runPhase(1, this.registry, activeRunner, context, this.emitter);
      allResults.push(...phase1Results);

      // Enrich context from subfinder / httpx results.
      context = this.mergeDiscoveries(context, phase1Results);

      phase1Findings = [];
      for (const r of phase1Results) phase1Findings.push(...r.findings);
      allFindings.push(...phase1Findings);
      executedPhases.push(1);

      // Kick off Decision 2 in the background — the phase-evaluator's own
      // errors become a fallback decision, so this promise never rejects.
      if (phaseEval !== undefined && phase1Findings.length > 0) {
        this.logger.info(
          { scanId, findingCount: phase1Findings.length },
          'starting governor Decision 2 in parallel with Phase 2',
        );
        decision2Promise = this.evaluatePhase(
          context,
          phase1Findings,
          governorDecisions,
          'phase1_evaluation',
          1,
          phaseEval,
        );
      }
    }

    // ---------- Phase 2 (runs in parallel with Decision 2) ----------
    let phase2Findings: NormalizedFinding[] = [];
    if (selectedPhases.includes(2)) {
      const phase2Context: ScanContext = {
        ...context,
        phase1Findings: [...phase1Findings],
      };
      const phase2Results = await runPhase(2, this.registry, activeRunner, phase2Context, this.emitter);
      allResults.push(...phase2Results);
      phase2Findings = [];
      for (const r of phase2Results) phase2Findings.push(...r.findings);
      allFindings.push(...phase2Findings);
      executedPhases.push(2);
    }

    // ---------- Join Decision 2 ----------
    // Now that Phase 2 is done, merge its findings with the Decision-2
    // evaluated Phase 1 set. Decision 2 is guaranteed resolved by await.
    if (decision2Promise !== null) {
      const outcome = await decision2Promise;
      // Rebuild allFindings = evaluated Phase 1 + raw Phase 2.
      allFindings = [...outcome.findings, ...phase2Findings];
      if (outcome.escalations.length > 0) {
        context = { ...context, governorEscalations: outcome.escalations };
      }
    }

    // ---------- Governor Decision 3: evaluate the full finding set ----------
    if (selectedPhases.includes(2) && phaseEval !== undefined && allFindings.length > 0) {
      const outcome = await this.evaluatePhase(
        context,
        allFindings,
        governorDecisions,
        'phase2_evaluation',
        2,
        phaseEval,
      );
      allFindings = outcome.findings;
      if (outcome.escalations.length > 0) {
        const merged = new Set<string>([
          ...(context.governorEscalations ?? []),
          ...outcome.escalations,
        ]);
        context = { ...context, governorEscalations: [...merged] };
      }
    }

    // ---------- Phase 3 (optional, --shannon AND non-empty governorEscalations) ----------
    if (selectedPhases.includes(3)) {
      const phase3Context: ScanContext = { ...context, phase2Findings: [...allFindings] };
      const phase3Results = await runPhaseThree(this.registry, activeRunner, phase3Context, this.emitter);
      allResults.push(...phase3Results);
      for (const r of phase3Results) allFindings.push(...r.findings);
      if (phase3Results.length > 0) executedPhases.push(3);
    }

    // ---------- Governor Decision 4: final AI-authored report ----------
    let aiAuthoredMarkdown: string | undefined;
    if (reportW !== undefined && allFindings.length > 0) {
      try {
        const result = await reportW.write({
          promptInput: {
            scanContext: context,
            findings: allFindings,
            decisions: governorDecisions.map((d) => d.output),
          },
          fallbackInput: {
            scanId,
            findings: allFindings,
            durationMs: Date.now() - startedAt,
            targetRepo: context.targetRepo,
            ...(context.targetUrl !== undefined && { targetUrl: context.targetUrl }),
          },
        });
        governorDecisions.push({
          decisionType: 'report',
          phase: 4,
          input: { scanId, findingsCount: allFindings.length },
          output: { aiAuthored: result.aiAuthored, markdownLength: result.markdown.length },
          fallback: !result.aiAuthored,
        });
        if (result.aiAuthored) {
          aiAuthoredMarkdown = result.markdown;
        }
      } catch (err) {
        this.logger.warn(
          { scanId, err: (err as Error).message },
          'report-writer threw unexpectedly — continuing mechanically',
        );
      }
    }

    const durationMs = Date.now() - startedAt;
    this.logger.info(
      {
        scanId,
        durationMs,
        phases: executedPhases,
        findingsCount: allFindings.length,
        scannerResults: allResults.length,
        governorDecisions: governorDecisions.length,
        aiAuthored: aiAuthoredMarkdown !== undefined,
      },
      'pipeline run complete',
    );

    return {
      scanId,
      findings: allFindings,
      scannerResults: allResults,
      durationMs,
      executedPhases,
      governorDecisions,
      ...(aiAuthoredMarkdown !== undefined && { aiAuthoredMarkdown }),
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

  /**
   * Build the governor scan-plan input from a mechanical repo listing. Returns
   * a limited file tree digest (top-level + 2-level subdirs, excluding
   * node_modules / dist / .next / .git / coverage / build) and the parsed
   * package.json if present.
   */
  private gatherPlanInput(context: ScanContext): {
    readonly fileTreeDigest: readonly string[];
    readonly packageJson?: unknown;
    readonly targetRepo: string;
    readonly targetUrl?: string;
  } {
    const tree: string[] = [];
    const excluded = new Set(['node_modules', 'dist', '.next', '.git', 'coverage', 'build']);
    const walk = (dir: string, depth: number): void => {
      if (depth > 2) return;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries.slice(0, 100)) {
        if (excluded.has(entry)) continue;
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          const rel = full.replace(context.targetRepo, '').replace(/^[\\/]/, '');
          tree.push(rel);
          if (st.isDirectory()) walk(full, depth + 1);
        } catch {
          continue;
        }
      }
    };
    walk(context.targetRepo, 0);

    let packageJson: unknown;
    try {
      const pkgPath = join(context.targetRepo, 'package.json');
      packageJson = JSON.parse(readFileSync(pkgPath, 'utf8')) as unknown;
    } catch {
      // No package.json — totally fine.
    }

    return {
      fileTreeDigest: tree.slice(0, 500),
      packageJson,
      targetRepo: context.targetRepo,
      ...(context.targetUrl !== undefined && { targetUrl: context.targetUrl }),
    };
  }

  /**
   * Run one governor evaluation pass on a finding set, apply its decisions,
   * and return the transformed findings + the extracted escalation fingerprints.
   */
  private async evaluatePhase(
    context: ScanContext,
    findings: readonly NormalizedFinding[],
    decisionsLog: GovernorDecisionRecord[],
    decisionType: 'phase1_evaluation' | 'phase2_evaluation',
    phase: number,
    evaluator: PhaseEvaluator,
  ): Promise<EvaluationOutcome> {
    const previousDecisions = decisionsLog.map((d) => d.output);
    const decision = await evaluator.evaluate({
      scanContext: context,
      findings,
      previousDecisions,
    });

    // Apply discards first (so adjusted severities don't hit already-discarded findings).
    const discardSet = new Set(decision.discardFindings.map((d) => d.findingFingerprint));
    const kept = findings.filter((f) => !discardSet.has(f.fingerprint));

    // Apply severity adjustments.
    const adjustments = new Map<string, Severity>();
    for (const adj of decision.adjustSeverity) {
      adjustments.set(adj.findingFingerprint, adj.newSeverity);
    }
    const adjusted: NormalizedFinding[] = kept.map((f) => {
      const newSeverity = adjustments.get(f.fingerprint);
      if (newSeverity === undefined || newSeverity === f.severity) return f;
      return { ...f, severity: newSeverity };
    });

    const escalations = decision.escalateToShannon.map((e) => e.findingFingerprint);

    decisionsLog.push({
      decisionType,
      phase,
      input: { findingCount: findings.length, previousDecisionCount: previousDecisions.length },
      output: decision,
      fallback: decision.notes.includes('mechanical fallback'),
      rationale: decision.notes,
    });

    return {
      findings: adjusted,
      escalations,
      decision,
    };
  }
}
