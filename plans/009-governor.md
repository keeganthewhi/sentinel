# Plan 009 — Phase H Governor Layer

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-37 .. SM-41 (Phase H)
> **Git SHA (start)**: 1cd60de
> **Depends on**: SM-36 (Phase G complete)

## Cold Start

- **Read first**: CLAUDE.md Critical Invariants #4 (governor read-only), #5 (untrusted scanner output), #6 (prompt injection structural defense), #7 (governor timeout → mechanical fallback); BLUEPRINT.md Phase H; AGENTS-full.md `AGF::Governor`, `AGF::AgentAdapter`, `AGF::PlanGenerator`, `AGF::PhaseEvaluator`, `AGF::ReportWriter`; `governor-templates/CLAUDE.md`.
- **Current state**: Mechanical pipeline + correlation + reports + persistence complete. No governor code yet.
- **Expected end state**: Optional governor layer that reads scanner findings (never spawns scanners), queries a CLI subprocess (claude/codex/gemini) with a 5-min timeout, and produces three decision types (scan plan / evaluation / report). Mechanical fallback on every failure path. governor.prompts.ts is the SOLE payload constructor.

## Aim

Build the read-only AI overseer. The governor never executes tools; it only reads `ScannerResult` / `NormalizedFinding[]` and writes `GovernorDecision` records + an AI-authored markdown report. Every CLI call has a hard 5-minute timeout; every failure (timeout, non-zero exit, malformed JSON) falls back to the mechanical path.

## Steps

### Step 1: Governor types and decision schemas (SM-38)

- **File**: `src/governor/types/governor-decision.ts` (NEW FILE)
- **Detail**: Zod schemas for the three decision payloads — `ScanPlanDecision`, `EvaluationDecision`, `ReportDecision`. Match the JSON shapes documented in AGENTS-full.md `AGF::GovernorDecision`. Export inferred types.
- **Constraint**: Schemas are the type gate — every governor response is validated through them before reaching persistence or downstream code.

### Step 2: Agent adapter (SM-37)

- **File**: `src/governor/agent-adapter.ts` (NEW FILE)
- **Detail**: `AgentAdapter` interface with `query(prompt: string): Promise<string>`. Three concrete implementations: `ClaudeCliAdapter`, `CodexCliAdapter`, `GeminiCliAdapter`. Each spawns its CLI via `child_process.spawn` (argv array, NEVER shell string), 5-minute hard timeout via `AbortController`, captures stdout, returns the trimmed text. On non-zero exit / abort / unparseable response → throws `GovernorTimeoutError` or `GovernorInvalidResponseError`. Factory function `createAgentAdapter()` selects the right adapter from `SENTINEL_GOVERNOR_CLI` env var (defaulting to `claude` if present, then `codex`, then `gemini`).
- **Constraint**: NEVER `exec()`, NEVER shell string. NEVER read `.env` or stream secret values. The `--print` / `-p` flag of each CLI is the only mode used.

### Step 3: Prompt builders (SM-38) — SOLE payload constructor

- **File**: `src/governor/governor.prompts.ts` (NEW FILE)
- **Detail**: Three pure functions:
  - `buildScanPlanPrompt(input)` — embeds `governor-templates/CLAUDE.md` content as the system layer, then user content with the repo file tree + package.json digest as JSON
  - `buildEvaluationPrompt(input)` — system layer + findings array as JSON (typed inputs only)
  - `buildReportPrompt(input)` — system layer + correlated findings + governor decisions
  Each builder wraps untrusted scanner-derived strings in a clearly delimited "user content" section. NEVER string-interpolate scanner stdout into the system layer.
- **Constraint**: This file is the ONLY file in `src/` that constructs a governor payload. No other file may build a prompt. Critical Invariant #6.

### Step 4: Plan generator (SM-39)

- **File**: `src/governor/plan-generator.ts` (NEW FILE)
- **Detail**: `PlanGenerator.generate(scanContext)` — reads the mechanical file tree + package.json + optional sentinel.yaml, calls `buildScanPlanPrompt`, queries the agent adapter, validates the JSON via the Zod schema, writes `workspaces/<scanId>/BLUEPRINT.md` (Markdown form per `governor-templates/BLUEPRINT.example.md`), persists a `GovernorDecision` row. On failure (timeout / invalid JSON / spawn error) → returns a fallback decision marking all scanners as enabled.
- **Constraint**: NEVER spawn a scanner. NEVER write outside `workspaces/<scanId>/`. NEVER include the secret `Raw` field of any TruffleHog finding in the prompt.

### Step 5: Phase evaluator (SM-40)

- **File**: `src/governor/phase-evaluator.ts` (NEW FILE)
- **Detail**: `PhaseEvaluator.evaluate(scanContext, findings, previousDecisions)` — called after Phase 1 and Phase 2. Builds the evaluation prompt, queries the adapter, validates the response (escalate / discard / adjust severity arrays), persists to GovernorDecision. On failure → mechanical fallback (no escalation, no discards, no severity adjustments) and a WARN log.
- **Constraint**: Only fingerprints flow back into the calling code — never finding objects. The governor never sees secret values.

### Step 6: Report writer (SM-41)

- **File**: `src/governor/report-writer.ts` (NEW FILE)
- **Detail**: `ReportWriter.write(scanContext, findings, decisions)` — final AI-authored report. Builds the prompt, queries the adapter, validates the markdown response (length + minimum sections check), returns the markdown string. On failure → falls back to `MarkdownRenderer.render(...)` from Phase F.
- **Constraint**: Citations must reference real fingerprints; if validation finds a hallucinated reference, fall back to mechanical.

### Step 7: GovernorModule + barrel + tests + quality gate

- **File**: `src/governor/governor.module.ts`, `src/governor/index.ts`, `*.spec.ts`
- **Detail**: NestJS module wiring the adapters, prompt module, plan generator, phase evaluator, and report writer. Tests use a `MockAgentAdapter` that returns canned strings — no real CLI subprocess. Verify timeout / invalid-JSON / fallback paths.
- **Constraint**: NO test spawns a real subprocess. NO test reads from `process.env.SENTINEL_GOVERNOR_CLI`.

## Acceptance Criteria

- [ ] `AgentAdapter` interface + 3 concrete adapters + factory
- [ ] `governor.prompts.ts` is the only payload constructor (grep proves it)
- [ ] All three decision schemas validated by Zod
- [ ] PlanGenerator writes BLUEPRINT.md to `workspaces/<scanId>/`
- [ ] PhaseEvaluator persists decisions and falls back on failure
- [ ] ReportWriter falls back to MarkdownRenderer on any error
- [ ] No file in `src/governor/*` imports `child_process` outside `agent-adapter.ts`
- [ ] Quality gate passes
- [ ] STATE.md SMs 37–41 flipped; Phase H → COMPLETE

## Security Checklist

- [ ] Governor stays read-only — no scanner subprocess spawn anywhere except in `agent-adapter.ts` (governor CLI, not scanner)
- [ ] No `.env` file content in prompts
- [ ] No TruffleHog `Raw` value in prompts (only the redacted `[REDACTED:<hash>]`)
- [ ] No scanner stdout interpolated into the system layer of any prompt
- [ ] Governor responses validated through Zod before reaching persistence or downstream code
- [ ] 5-minute hard timeout on every CLI call
- [ ] Fallback paths logged at WARN with the scan id and the failed decision type

## Test Requirements

- [ ] AgentAdapter timeout → throws GovernorTimeoutError
- [ ] AgentAdapter non-zero exit → throws GovernorInvalidResponseError
- [ ] Prompt builder embeds governor-templates/CLAUDE.md as system layer
- [ ] Prompt builder rejects (or skips) findings with TruffleHog raw secrets
- [ ] PlanGenerator falls back when adapter throws
- [ ] PhaseEvaluator falls back when JSON is invalid
- [ ] ReportWriter falls back to MarkdownRenderer on adapter failure
- [ ] Coverage: `src/governor/**` ≥ 95%

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7

## Rollback

1. `git revert HEAD`
2. `rm -rf src/governor`

## Completion

1. Quality gate
2. `git add src/governor plans/009-governor.md`
3. Commit `[SM-37..41] phase-h: governor layer + agent adapter + prompts + decisions`
4. Push
5. STATE.md → Phase H COMPLETE, current_phase=I, current_step=SM-42

# Important Findings

(Append discoveries here as you work.)
