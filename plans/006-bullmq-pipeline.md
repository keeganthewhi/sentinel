# Plan 006 — Phase E BullMQ Pipeline Orchestration

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-23 .. SM-27 (Phase E)
> **Git SHA (start)**: d41ecdd
> **Depends on**: SM-22 (Phase D complete)

## Cold Start

- **Read first**: CLAUDE.md Critical Invariants #3 (scanner failure is normal), #9 (workspace isolation); AGENTS.md Queue Overview (lines 213–220); BLUEPRINT.md Phase E; AGENTS-full.md `AGF::Pipeline` `AGF::PhaseOneStatic` `AGF::PhaseTwoInfra` `AGF::ScannerWorker` `AGF::TerminalUI`.
- **Current state**: 8 scanners registered via ScannerModule.onModuleInit. DockerExecutor ready. No pipeline.
- **Expected end state**: `PipelineService.run(context)` orchestrates Phase 1 → Phase 2 → returns a `ScanSummary { findings, scannerResults, durationMs }`. Terminal UI displays phase headers + per-scanner status + durations. Pipeline is testable without Redis via an in-memory runner; BullMQ runner is wired as an alternative for production use.

## Aim

Wire the 8 scanners into a resumable, phased execution pipeline. Build the runner layer so tests can execute without Redis, while production uses BullMQ. Surface progress through a pluggable terminal UI. Ensure a crashed scanner never cancels the phase — every scanner result is recorded, and the pipeline continues.

## Steps

### Step 1: Pipeline types (runner interface, scan options, scan summary)

- **File**: `src/pipeline/types.ts` (NEW FILE)
- **Detail**: Export `PipelineRunOptions` (scanContext, phases, abortSignal), `ScanSummary` (findings, scannerResults, durationMs), `ScannerJobResult`. Define interface `IPipelineRunner { runScanner(scanner: BaseScanner, context: ScanContext): Promise<ScannerResult> }`.

### Step 2: In-memory runner

- **File**: `src/pipeline/in-memory.runner.ts` (NEW FILE)
- **Detail**: `@Injectable()` class implementing `IPipelineRunner`. Directly calls `scanner.execute(context)` with a try/catch that converts uncaught throws into `{ success: false, error, findings: [] }`. Emits lifecycle events via an injected `ProgressEmitter`.
- **Constraint**: Scanner throw → captured as failure result, never propagated.

### Step 3: BullMQ runner (skeleton)

- **File**: `src/pipeline/bullmq.runner.ts` (NEW FILE)
- **Detail**: `@Injectable()` class implementing `IPipelineRunner`. Constructs a BullMQ Queue pointed at `REDIS_URL` from config. `runScanner` enqueues a job, awaits result via the job's `waitUntilFinished()`. Worker instance registers a processor that resolves jobs by looking up scanner in registry and calling `.execute()`. Wire cleanly so that tests using InMemoryRunner never instantiate this class.
- **Constraint**: Never spawn a scanner subprocess directly — always via the registry + scanner.execute().

### Step 4: Progress emitter + terminal UI

- **File**: `src/report/progress/progress.emitter.ts` (NEW FILE), `src/report/progress/terminal-ui.ts` (NEW FILE)
- **Detail**: `ProgressEmitter` is a Node EventEmitter-like class that emits `scanner.start`, `scanner.end`, `phase.start`, `phase.end`, `governor.decision`. `TerminalUI` subscribes and renders per-scanner status using `ora` spinners. Governor lines colored cyan (deferred — Phase H adds them). Debounced to 100ms.
- **Constraint**: Terminal UI degrades to plain console output when `process.stdout.isTTY` is false.

### Step 5: Phase runner for Phase 1 + Phase 2

- **File**: `src/pipeline/phases/phase-runner.ts` (NEW FILE)
- **Detail**: Generic function `runPhase(phase: 1|2|3, registry, runner, context, emitter)` that fetches all scanners for the phase via `registry.forPhase`, filters by `requiresUrl && !context.targetUrl` (skip with logged reason), invokes each via `runner.runScanner` using `Promise.allSettled`, returns `ScannerResult[]`. Does NOT mutate context — returns a new context slice with `phase1Findings` / `discoveredSubdomains` / `discoveredEndpoints`. Merge is the caller's responsibility.
- **Constraint**: Phase 1 runs all scanners concurrently. Phase 2 runs concurrently too, but only after Phase 1 has populated context.

### Step 6: Pipeline service (top-level orchestrator)

- **File**: `src/pipeline/pipeline.service.ts` (NEW FILE)
- **Detail**: `@Injectable()` `PipelineService`. Constructor receives `ScannerRegistry`, `IPipelineRunner`, `ProgressEmitter`. `run(options)` executes Phase 1 → Phase 2, merges discovered subdomains/endpoints from Phase 1 into the Phase 2 context, returns a `ScanSummary` with all findings and scanner results. Respects `options.phases` filter. Never crashes on individual scanner failure.
- **Constraint**: Pure orchestrator — does NOT write to DB or files (Phase G adds persistence).

### Step 7: Pipeline NestJS module

- **File**: `src/pipeline/pipeline.module.ts` (NEW FILE)
- **Detail**: `PipelineModule` imports `ScannerModule`, provides `InMemoryPipelineRunner` (default), `ProgressEmitter`, `TerminalUI`, `PipelineService`. BullMQ runner is NOT exported here — wired explicitly in Phase J CLI bootstrap when Redis is available.
- **Constraint**: Module boundary honored — pipeline depends on scanner, NOT the other way around.

### Step 8: Tests

- **File**: `src/pipeline/pipeline.service.spec.ts`, `src/pipeline/in-memory.runner.spec.ts`, `src/pipeline/phases/phase-runner.spec.ts` (NEW FILES)
- **Detail**:
  - InMemoryRunner: runs a fake scanner that returns findings; catches a throwing scanner and converts to failure result.
  - PhaseRunner: skips `requiresUrl` scanners when URL absent; returns results from all scanners even if one fails; runs concurrently (verified by overlapping setTimeouts).
  - PipelineService: Phase 1 → Phase 2 sequencing; phase filter respected; governor flag is orthogonal.
- **Constraint**: No Redis, no real scanners — all tests use fake scanners via `ScannerRegistry` directly.

### Step 9: Quality gate + commit + push + STATE update

## Acceptance Criteria

- [ ] `PipelineService.run()` completes Phase 1 → Phase 2 in order
- [ ] Phase 1 scanners run concurrently (verified via overlapping timings in test)
- [ ] Per-scanner failure does not cancel the phase — other scanners still complete
- [ ] `requiresUrl: true` scanners are skipped with a logged reason when `targetUrl` is absent
- [ ] `options.phases = [1]` restricts execution to phase 1 only
- [ ] Quality gate: 0 errors, 0 warnings, all tests pass
- [ ] STATE.md SMs 23–27 flipped; Phase E → COMPLETE

## Security Checklist

- [ ] Pipeline does not interpolate scanner output into any shell / SQL / governor prompt
- [ ] Pipeline does not persist raw scanner output (deferred to Phase G)
- [ ] Per-scanner error messages do not expose secrets (N/A — scanners already redact before returning)
- [ ] Workspace isolation: `scanId` flows through context, never mutated across scans
- [ ] Governor stays read-only — N/A (Phase H)
- [ ] Prisma scoped — N/A (Phase G)
- [ ] Redis URL comes from config, not hardcoded

## Test Requirements

- [ ] InMemoryRunner returns a failure result when scanner throws
- [ ] InMemoryRunner forwards a successful result unchanged
- [ ] PhaseRunner skips scanners with `requiresUrl && !targetUrl`
- [ ] PhaseRunner returns all scanner results via `Promise.allSettled` even if one fails
- [ ] PipelineService merges phase 1 discovered endpoints into phase 2 context
- [ ] PipelineService respects `options.phases` filter
- [ ] Coverage: `src/pipeline/**` ≥ 80%

## Execution Order

**Recommended**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
**Rationale**: Types first, runners next (in-memory and BullMQ as parallel siblings), progress emitter before TerminalUI, phase runner before service, service last. Tests after all building blocks are in place.

## Rollback

1. `git revert HEAD`
2. `rm -rf src/pipeline src/report/progress`
3. Un-tick STATE.md SM-23..27

## Completion

1. Quality gate
2. `git add src/pipeline src/report package.json pnpm-lock.yaml plans/006-bullmq-pipeline.md`
3. Commit `[SM-23..27] phase-e: pipeline runner + phase orchestration + terminal UI`
4. Push
5. STATE.md: Phase E COMPLETE, current_phase=F, current_step=SM-28

# Important Findings

(Append discoveries here as you work.)
