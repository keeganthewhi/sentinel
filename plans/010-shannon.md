# Plan 010 — Phase I Shannon Integration

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-42 .. SM-43 (Phase I)
> **Git SHA (start)**: 61d488a
> **Depends on**: SM-41 (Phase H complete)

## Cold Start

- **Read first**: BLUEPRINT.md Phase I; AGENTS-full.md `AGF::ShannonScanner` `AGF::PhaseThreeExploit`; ADR-012 (fork-over-upstream decision); CLAUDE.md Critical Invariant #4 (governor read-only — Shannon is the EXCEPTION as a Phase 3 exploit tool, not a governor decision).
- **Current state**: Mechanical pipeline + correlation + persistence + governor layer complete. No Shannon integration yet.
- **Expected end state**: `ShannonScanner` extending BaseScanner with `phase: 3` and `requiresUrl: true`; markdown report parser that extracts `exploitProof` for each finding; `phase3-exploit.ts` orchestrator gated by `--shannon` AND non-empty `context.governorEscalations`. Tests use canned markdown fixtures — no real Shannon binary or repo clone in tests.

## Aim

Wire Shannon as the optional Phase 3 exploit stage. The bootstrap script (Phase J SM-45) clones `keeganthewhi/shannon-noapi` into `tools/shannon-noapi/` on demand; this plan only ships the scanner class, the markdown parser, the Phase 3 runner, and the registry hookup. Cloning is NOT performed by this plan.

## Steps

### Step 1: Shannon scanner

- **File**: `src/scanner/scanners/shannon.scanner.ts` (NEW FILE)
- **Detail**: Extends BaseScanner (`name: 'shannon'`, `phase: 3`, `requiresUrl: true`). `execute()` is a stub returning `{ success: true, findings: [] }` — actual subprocess wiring lives in the Phase J CLI bootstrap which constructs the Shannon command via the chosen governor CLI. `parseOutput(markdown)` extracts findings from a Shannon markdown report.
- **Constraint**: Skip cleanly when `context.governorEscalations` is empty or undefined. NEVER spawn a scanner subprocess from `src/governor/` — Shannon is a scanner, invoked from the pipeline, not the governor.

### Step 2: Shannon markdown parser

- **File**: `src/scanner/scanners/shannon.scanner.ts` (in same file)
- **Detail**: Shannon emits markdown sections like `## Finding 1: <title>` followed by metadata blocks (severity, target, exploit proof). The parser splits on `^## Finding`, extracts metadata via simple regex, and produces NormalizedFinding records with `exploitProof` populated. Severity defaults to HIGH (Shannon-confirmed exploit per the severity normalizer rule).
- **Constraint**: Tolerate malformed sections — skip a section without crashing the parse. Empty input → `[]`.

### Step 3: Phase 3 orchestrator

- **File**: `src/pipeline/phases/phase-three-exploit.ts` (NEW FILE)
- **Detail**: `runPhaseThree(registry, runner, context, emitter)` — only runs when `context.governorEscalations` is set AND non-empty. Looks up the Shannon scanner in the registry, invokes via the runner (so it goes through the InMemory or BullMQ runner like any other scanner), returns the results.
- **Constraint**: Phase 3 is purely additive — never blocks Phase 4 (correlation/report) on Shannon failure.

### Step 4: Register Shannon scanner

- **File**: `src/scanner/scanners/index.ts` (MODIFY); `src/scanner/scanner.module.ts` (MODIFY)
- **Detail**: Add `PHASE3_SCANNERS = [new ShannonScanner()]` to the barrel; iterate it in `ScannerModule.onModuleInit`.

### Step 5: PipelineService Phase 3 hook

- **File**: `src/pipeline/pipeline.service.ts` (MODIFY)
- **Detail**: Add Phase 3 to the orchestration loop, gated by `selectedPhases.includes(3) && context.governorEscalations !== undefined && context.governorEscalations.length > 0`. Append phase 3 results to `allResults` and findings to `allFindings`.

### Step 6: Tests

- **File**: `src/scanner/scanners/shannon.scanner.spec.ts`, `src/pipeline/phases/phase-three-exploit.spec.ts` (NEW FILES)
- **Detail**: Markdown parser test against a canned 2-finding report; phase orchestrator test that skips when escalations are empty and runs when escalations are present.

### Step 7: Quality gate + commit + push + STATE update

## Acceptance Criteria

- [ ] Shannon scanner extends BaseScanner with phase=3 and requiresUrl=true
- [ ] Markdown parser extracts findings with exploitProof populated
- [ ] Phase 3 is skipped cleanly when no escalations
- [ ] Pipeline service runs Phase 3 when --shannon AND escalations present
- [ ] ScannerRegistry.forPhase(3).length === 1 after module init
- [ ] Quality gate passes
- [ ] STATE.md SMs 42–43 flipped; Phase I → COMPLETE

## Security Checklist

- [ ] Shannon parser sanitizes user-controlled markdown — no shell interpolation
- [ ] No secrets in markdown reports leaked to logs
- [ ] Shannon scanner does not spawn governor subprocesses (it's a scanner, not a governor)
- [ ] Phase 3 results never leak across scans

## Test Requirements

- [ ] Shannon parser: empty input → []
- [ ] Shannon parser: 2-finding markdown → 2 findings with exploitProof
- [ ] Phase 3 orchestrator: skips when escalations empty
- [ ] Phase 3 orchestrator: runs when escalations present and Shannon registered
- [ ] Coverage: shannon scanner ≥ 80%

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7

## Rollback

1. `git revert HEAD`
2. `rm src/scanner/scanners/shannon.scanner{,.spec}.ts src/pipeline/phases/phase-three-exploit{,.spec}.ts`

## Completion

1. Quality gate
2. Commit `[SM-42..43] phase-i: shannon scanner + phase-3 orchestrator`
3. Push
4. STATE.md → Phase I COMPLETE, current_phase=J, current_step=SM-44

# Important Findings

(Append discoveries here as you work.)
