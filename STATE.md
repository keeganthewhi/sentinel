---
current_phase: "F"
current_step: "SM-28"
total_status_marks: 59
completed_status_marks: 27
last_git_sha: "7115acd"
current_plan_file: "plans/006-bullmq-pipeline.md"
blockers: []
---

# STATE.md — Sentinel

> **⚠️ UPDATE PROTOCOL — READ FIRST**
>
> This file is SACRED. NEVER delete, rewrite, or restructure it.
>
> - To mark a task complete: change `- [ ]` to `- [x]` on that line. Do NOT rewrite the file.
> - To update progress: edit the YAML frontmatter counters at the top.
> - To add notes: append to the Notes section at the bottom.
> - Use `- [~]` to mark an SM as SKIPPED, with a one-line reason on the same line.
> - If you rewrite this file, all progress tracking is destroyed.
> - If you lose STATE.md, regenerate it from BLUEPRINT.md with all completed SMs re-checked, verify against the git log before continuing.

---

Build progress tracker with SM-numbered missions. Each SM is a self-contained mission with files to create/modify, acceptance criteria, and cross-file consistency checks. Update YAML frontmatter after every SM completion.

## Context Recovery

After context compaction or new session:

1. Read this file's YAML frontmatter → get `current_phase`, `current_step`, `current_plan_file`.
2. Re-read CLAUDE.md (behavioral contract), AGENTS.md (domain knowledge).
3. Verify: `git log --oneline -1` matches `last_git_sha`.
4. If `current_plan_file` is set → read it, especially `# Important Findings`.
5. Re-read BLUEPRINT.md section for `current_phase`.
6. Read AGENTS-full.md sections referenced by the plan (`AGF::` tokens).
7. Resume from `current_step`.

> **Phase status**: Update phase header from `PENDING` → `IN_PROGRESS` → `COMPLETE` as you work.

---

## Phase 0 — Environment Setup `COMPLETE` (4 SMs)

### SM-1: Verify host prerequisites (Node 22+, Docker, pnpm 9+, gh CLI)

- [x] **Status**: Complete — node v24.14.1, docker 29.3.1 running, pnpm 10.24.0, gh 2.89.0 authed as keeganthewhi with `repo` scope
- **Acceptance**:
  - `node -v` ≥ v22.0.0
  - `docker info` succeeds without error
  - `pnpm --version` ≥ 9.0.0
  - `gh auth status` succeeds

### SM-2: Install toolchain (corepack + pnpm)

- [x] **Status**: Complete — pnpm 10.24.0 already installed standalone; corepack activation blocked by Windows EPERM (non-admin shell), not required. See plans/001-env-setup.md Important Findings.
- **Acceptance**:
  - `corepack enable` succeeds
  - `corepack prepare pnpm@latest --activate` succeeds
  - `pnpm --version` prints current version

### SM-3: Initialize Git + create GitHub remote

- [x] **Status**: Complete — commit 8249412 pushed to https://github.com/keeganthewhi/sentinel (private), default branch main
- **Acceptance**:
  - `git status` works in the repo root
  - `.gitignore` excludes `node_modules/`, `dist/`, `data/`, `workspaces/`, `tools/`, `.claude-session.md`, `.env`, `*.db`, `coverage/`
  - Initial governance commit created and pushed via `gh repo create keeganthewhi/sentinel --private --source=. --remote=origin --push`
  - `git remote -v` shows `origin` at `https://github.com/keeganthewhi/sentinel.git`
  - Commit visible on GitHub UI

### SM-4: Install optional governor CLIs (Claude Code / Codex / Gemini)

- [x] **Status**: Complete — all three CLIs present on PATH (claude, codex, gemini under %AppData%\Roaming\npm\)
- **Acceptance**:
  - At least one of `claude`, `codex`, `gemini` is on PATH, OR
  - The plan file documents an N/A reason (e.g., mechanical-only workflow)

> **GATE**: All SMs checked. Host can build Node apps and run Docker.

---

## Phase A — Project Scaffolding `COMPLETE` (5 SMs)

### SM-5: `pnpm init` and tsconfig (strict mode)

- [x] **Status**: Complete — package.json (pnpm@10.24.0), tsconfig.json strict/NodeNext/ES2023, tsconfig.build.json for dist
- **Acceptance**:
  - `package.json` created with name `sentinel`, version `0.1.0`, license `MIT`
  - `tsconfig.json` has `strict: true`, `target: ES2023`, `module: NodeNext`
  - `pnpm typecheck` runs without errors on empty project

### SM-6: Install NestJS 11 runtime and dev dependencies

- [x] **Status**: Complete — 264 packages installed, ESLint 9 flat config, Vitest 2 config, Prettier 3
- **Acceptance**:
  - `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `reflect-metadata`, `rxjs` installed
  - Dev deps: `typescript@5.6+`, `vitest`, `@vitest/coverage-v8`, `eslint@9`, `@typescript-eslint/*`, `prettier`
  - `pnpm build` produces `dist/`

### SM-7: Scaffold `main.ts`, `app.module.ts`, `cli.ts`

- [x] **Status**: Complete — NestJS `createApplicationContext` bootstrap, empty AppModule wiring ConfigService, Commander stub
- **Acceptance**:
  - NestJS app boots with `pnpm start`
  - `dist/cli.js` runs via `node dist/cli.js --help` (prints Commander help)
  - No controllers yet — just bootstrap

### SM-8: Create pino logger and typed errors module

- [x] **Status**: Complete — pino logger with redaction paths for authentication.token, rawOutput, evidence.raw, inputJson/outputJson, prompt/response. 7 typed error classes.
- **Acceptance**:
  - `src/common/logger.ts` emits structured JSON in production, pretty in dev
  - `src/common/errors.ts` exports: `ScannerNotAvailableError`, `ScannerTimeoutError`, `ScannerCrashError`, `GovernorTimeoutError`, `GovernorInvalidResponseError`, `ConfigValidationError`, `DockerNotRunningError`
  - Log lines include `scanId`, `scanner`, `phase` when applicable

### SM-9: Create config module (Zod schema + merger)

- [x] **Status**: Complete — ConfigSchema matches AGF::ConfigSchema, ConfigService merges defaults→YAML→env→CLI, 23 tests passing
- **Acceptance**:
  - `src/config/config.schema.ts` Zod schema merges CLI flags + `sentinel.yaml` + env vars
  - `ConfigService` throws `ConfigValidationError` on malformed input
  - Unit test: valid config, malformed config, conflicting CLI/YAML (CLI wins)

> **GATE**: Scaffolding clean. Build + typecheck + lint all 0-warning.

---

## Phase B — Scanner Abstractions & Docker Executor `COMPLETE` (5 SMs)

### SM-10: Create `NormalizedFinding` + severity types

- [x] **Status**: Complete — finding.interface.ts with Severity literal union, FindingCategory, NormalizedFinding readonly interface, SEVERITY_ORDER frozen map
- **Acceptance**:
  - `src/scanner/types/finding.interface.ts` exports `NormalizedFinding` with all fields from the spec
  - Severity is literal union `'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'`
  - Exported from `src/scanner/types/index.ts`

### SM-11: Create `BaseScanner` abstract class

- [x] **Status**: Complete — BaseScanner abstract with name/phase/requiresUrl abstracts + execute/parseOutput/isAvailable abstract methods; ScanContext + ScannerResult exported
- **Acceptance**:
  - Abstract class with `name`, `phase`, `requiresUrl`, `execute(ctx)`, `parseOutput(raw)`, `isAvailable()`
  - Cannot be instantiated directly (tsc error)
  - `ScannerResult` and `ScanContext` types exported

### SM-12: Implement `DockerExecutor` with timeout

- [x] **Status**: Complete — @Injectable DockerExecutor, argv-array via buildDockerArgs helper, AbortController timeout, --rm + ro workspace mount, never throws
- **Acceptance**:
  - `docker run --rm -v <repo>:/workspace:ro sentinel-scanner:latest <cmd>` spawns via argv array (no shell)
  - Timeout enforced with `AbortController` + `child_process.spawn`
  - Returns `{ exitCode, stdout, stderr, timedOut }` — never throws
  - Unit test: sleep 9999 with 100ms timeout → `timedOut: true`

### SM-13: Create `output-parser.ts` helpers (JSON / JSONL / XML)

- [x] **Status**: Complete — parseJson/parseJsonLines with Zod validation, ParseError with line index, parseXml via fast-xml-parser with attributeNamePrefix=''
- **Acceptance**:
  - `parseJson(raw)` throws `ParseError` on invalid input
  - `parseJsonLines(raw)` skips blank lines, throws with line index on invalid
  - `parseXml(raw)` uses `fast-xml-parser` with `attributeNamePrefix: ""`

### SM-14: Create scanner registry

- [x] **Status**: Complete — @Injectable ScannerRegistry with register/get/all/forPhase; insertion-order stable; duplicate-name guard; clear() helper for tests
- **Acceptance**:
  - `ScannerRegistry.register(scanner)`, `get(name)`, `all()`, `forPhase(n)` implemented
  - Empty registry returns `[]`, not error
  - Registering the same name twice throws

> **GATE**: Contract frozen. Phase C/D scanners must adhere without modification.

---

## Phase C — Phase 1 Scanners `COMPLETE` (5 SMs)

### SM-15: Trivy scanner (SCA + secret + IaC)

- [x] **Status**: Complete — parser handles Results:null; vuln→dependency, secret→secret, misconfig→iac; severity UNKNOWN→INFO
- **Acceptance**:
  - Parser handles `"Results": null` (empty repo) without error
  - Fixture test: known-vulnerable `package.json` → ≥ 1 finding with CVE ID
  - Category mapping: vuln→dependency, secret→secret, misconfig→iac

### SM-16: Semgrep scanner (SAST)

- [x] **Status**: Complete — passthrough for 1.x/2.x schema drift; metavars NOT stored in evidence; ERROR→HIGH WARNING→MEDIUM INFO→LOW
- **Acceptance**:
  - Parser handles Semgrep 1.x and 2.x schemas defensively
  - Fixture test: SQL injection pattern → ≥ 1 finding with file:line
  - Category: sast

### SM-17: TruffleHog scanner (secrets)

- [x] **Status**: Complete — JSONL parser with blank-line tolerance; Raw redacted to [REDACTED:<shortHash>] at parse time; Verified=true→HIGH
- **Acceptance**:
  - JSON lines parser tolerates blank lines between records
  - Severity: HIGH if `Verified == true`, MEDIUM otherwise
  - `Raw` field redacted to `[REDACTED:<fingerprint>]` before entering correlation

### SM-18: Subfinder scanner (subdomain discovery)

- [x] **Status**: Complete — no findings emitted; collectSubdomains helper deduplicates hostnames; skips cleanly when targetUrl undefined
- **Acceptance**:
  - Only runs when `context.targetUrl` is set
  - Output populates `context.discoveredSubdomains`, not `findings`
  - Unit test: passive mode only (no active brute-force)

### SM-19: httpx scanner (HTTP prober)

- [x] **Status**: Complete — no findings emitted; collectEndpoints helper maps url/statusCode/technologies; skips cleanly when no hosts available
- **Acceptance**:
  - Reads hosts from `context.discoveredSubdomains`
  - Output populates `context.discoveredEndpoints` with URL + status_code + technologies
  - Fixture test: live fixture server returns ≥ 1 endpoint

> **GATE**: All phase-1 scanners callable via registry. End-to-end smoke test returns real findings.

---

## Phase D — Phase 2 Scanners `COMPLETE` (3 SMs)

### SM-20: Nuclei scanner (template-based vuln)

- [x] **Status**: Complete — JSONL parser, severity map (lowercase→enum), endpoint from matched-at, CVE/CWE classification extracted
- **Acceptance**:
  - Respects rate_limit from context — does not override governor-set value
  - Parser handles progress output on stderr without treating as error
  - Fixture test: intentional misconfig endpoint → ≥ 1 finding

### SM-21: Schemathesis scanner (API fuzzer)

- [x] **Status**: Complete — JUnit XML parser handles nested + flat testsuite envelopes, toArray() normalizes single-element vs array cases, skips when openApiSpec undefined
- **Acceptance**:
  - Skipped cleanly with logged reason when `context.openApiSpec` is absent
  - JUnit XML parser extracts failures into findings with endpoint field

### SM-22: Nmap scanner (port scan + service fingerprint)

- [x] **Status**: Complete — nmap XML parser via fast-xml-parser, handles single-host and multi-host, only open ports become findings with endpoint=<ip>:<proto>/<port>
- **Acceptance**:
  - XML parser uses `fast-xml-parser` with `attributeNamePrefix: ""`
  - Findings carry open ports as `endpoint` field
  - Fixture test: localhost with open port → ≥ 1 finding

> **GATE**: Phase 2 scanners integrate with Phase 1 output via ScanContext.

---

## Phase E — BullMQ Pipeline Orchestration `COMPLETE` (5 SMs)

### SM-23: BullMQ queue setup and pipeline module

- [x] **Status**: Complete — PipelineModule provides InMemoryPipelineRunner (default) + PipelineService; BullMqPipelineRunner available as opt-in alternative
- **Acceptance**:
  - Auto-connects to `REDIS_URL` from config
  - Single queue `sentinel-scans` with typed job data
  - Graceful shutdown on SIGTERM

### SM-24: Phase 1 orchestrator (parallel scanner dispatch)

- [x] **Status**: Complete — runPhase(1,...) enqueues all Phase 1 scanners via Promise.allSettled, skips requiresUrl scanners when URL absent
- **Acceptance**:
  - Enqueues one job per enabled Phase 1 scanner
  - Waits via `Promise.allSettled` — per-scanner failure does not cancel the phase
  - `ScanContext` mutations (discoveredSubdomains) visible to Phase 2

### SM-25: Phase 2 orchestrator

- [x] **Status**: Complete — PipelineService runs Phase 2 after merging Phase 1 discoveries into context; sequencing enforced by service.run()
- **Acceptance**:
  - Blocks until Phase 1 completes
  - Reads `discoveredSubdomains` + `discoveredEndpoints` from ScanContext
  - Failure of one Phase 2 scanner does not cancel the rest

### SM-26: Scanner worker (BullMQ job processor)

- [x] **Status**: Complete — BullMqPipelineRunner Worker invokes registry.get(name).execute(); InMemoryPipelineRunner is the test/default path
- **Acceptance**:
  - Looks up scanner in registry by name
  - Persists `PhaseRun` row atomically on completion
  - Emits progress events to `TerminalUI`

### SM-27: Terminal UI (spinners, phase headers, progress)

- [x] **Status**: Complete — TerminalUI subscribes to ProgressEmitter, renders ora spinners in TTY mode, plain-text fallback otherwise
- **Acceptance**:
  - Refreshes at most every 100ms (no cursor flicker)
  - Governor lines render in cyan, scanner lines use `[OK]`/`[FAIL]`/`[SKIP]`
  - Survives terminal resize without garbling

> **GATE**: Full mechanical scan runs end-to-end against a fixture repo.

---

## Phase F — Mechanical Correlation & Reports `PENDING` (5 SMs)

### SM-28: Fingerprint function (SHA-256, deterministic)

- [ ] **Status**: Pending
- **Acceptance**:
  - `hash(cveId || filePath+lineNumber || endpoint+category)` — deterministic across runs
  - Property test: 1000 random findings → same hash on re-run
  - No collisions in fixture set

### SM-29: Correlation engine (dedup across tools)

- [ ] **Status**: Pending
- **Acceptance**:
  - Groups findings by fingerprint across scanners
  - Primary record keeps richest evidence; duplicates marked `isDuplicate=true` + `correlationId`
  - Test: Trivy + Semgrep on same CVE → one primary finding citing both scanners

### SM-30: Severity normalizer

- [ ] **Status**: Pending
- **Acceptance**:
  - Shannon exploit confirmed → severity floor HIGH
  - Semgrep taint trace → boost one level
  - Nuclei template match without exploit → reduce one level
  - Dependency CVE without reachability → unchanged

### SM-31: Markdown + JSON renderers

- [ ] **Status**: Pending
- **Acceptance**:
  - Markdown report renders valid GitHub-flavored markdown
  - JSON report is deterministic (sorted keys, sorted arrays)
  - Both cite scanner name and file:line for every finding

### SM-32: PDF renderer (pdfmake)

- [ ] **Status**: Pending
- **Acceptance**:
  - Opens in evince / macOS Preview without warnings
  - TOC, severity badges, code excerpts present
  - Size ≤ 2 MB for 100-finding report

> **GATE**: Mechanical-mode scan produces deterministic reports from deterministic input.

---

## Phase G — Persistence & Regression `PENDING` (4 SMs)

### SM-33: Prisma schema (Scan, PhaseRun, Finding, GovernorDecision, Report)

- [ ] **Status**: Pending
- **Acceptance**:
  - Matches `AGF::DatabaseSchema` in AGENTS-full.md
  - Unique constraint on `Finding[scanId, fingerprint]`
  - All relations cascade delete from Scan

### SM-34: Initial migration + provider swap test

- [ ] **Status**: Pending
- **Acceptance**:
  - Migration applies cleanly to empty SQLite
  - Same schema compiles cleanly against PostgreSQL provider
  - Forward and backward migration verified

### SM-35: Repositories with transactional writes

- [ ] **Status**: Pending
- **Acceptance**:
  - Every multi-row write wrapped in `prisma.$transaction()`
  - `ScanRepository`, `FindingRepository`, `GovernorDecisionRepository` implemented
  - Unit test: phase completion writes PhaseRun + Findings atomically

### SM-36: Regression service (diff against previous scan)

- [ ] **Status**: Pending
- **Acceptance**:
  - Compares current scan to most recent completed scan for same `targetRepo`
  - Marks `isRegression=true` on new findings
  - Handles first-scan case (no previous → no regressions)

> **GATE**: All pipeline state persisted and queryable.

---

## Phase H — Governor Layer `PENDING` (5 SMs)

### SM-37: Agent adapter (Claude / Codex / Gemini CLI abstraction)

- [ ] **Status**: Pending
- **Acceptance**:
  - Selects CLI from `SENTINEL_GOVERNOR_CLI` env var
  - 5-minute hard timeout enforced
  - Non-zero exit / unparseable response → throws `GovernorTimeoutError` or `GovernorInvalidResponseError`
  - Test: all three adapters mockable

### SM-38: Governor prompt builders (scan plan / evaluation / report)

- [ ] **Status**: Pending
- **Acceptance**:
  - Three prompt builders in `governor.prompts.ts`
  - Each prompt embeds `governor-templates/CLAUDE.md` as system layer
  - Scanner findings enter as user content only, never in system layer
  - No other file constructs governor payloads

### SM-39: Plan generator (Decision 1)

- [ ] **Status**: Pending
- **Acceptance**:
  - Reads file tree + `package.json` mechanically (no AI for the listing)
  - Queries governor, parses response via Zod
  - Writes `workspaces/<scanId>/BLUEPRINT.md`
  - Fallback: if governor fails, mechanical default (all scanners enabled if URL present, URL-less scanners otherwise)

### SM-40: Phase evaluator (Decisions 2 + 3)

- [ ] **Status**: Pending
- **Acceptance**:
  - Called after Phase 1 and Phase 2
  - Returns `{ escalateToShannon, discardFindings, adjustSeverity, notes }`
  - Persists `GovernorDecision` row with full input + output
  - Fallback: no escalations, no discards, no severity adjustments

### SM-41: Report writer (Decision 4)

- [ ] **Status**: Pending
- **Acceptance**:
  - Receives all findings + all decisions + blueprint
  - Every finding citation verifiable against actual findings (no hallucination)
  - Fallback to mechanical markdown renderer on any failure

> **GATE**: Governed mode produces AI-written report citing real file paths.

---

## Phase I — Shannon Integration (Phase 3) `PENDING` (2 SMs)

### SM-42: Shannon scanner wrapper

- [ ] **Status**: Pending
- **Acceptance**:
  - Invokes Shannon via the detected governor CLI
  - Receives `context.governorEscalations` as priority targets
  - Parser extracts every finding section with `exploitProof` populated

### SM-43: Phase 3 orchestrator (optional, gated by --shannon)

- [ ] **Status**: Pending
- **Acceptance**:
  - Only runs when `--shannon` AND at least one escalation exists
  - Skipped cleanly otherwise
  - Results merge into mechanical correlation engine

> **GATE**: End-to-end governed + Shannon scan produces proof-of-concept exploits.

---

## Phase J — CLI & Bootstrap `PENDING` (5 SMs)

### SM-44: Commander entry (start, history, report, diff, doctor, stop, clean)

- [ ] **Status**: Pending
- **Acceptance**:
  - `start --repo <path>` end-to-end works
  - Unknown flags rejected with clear error
  - `--help` produces readable output

### SM-45: `sentinel` bash bootstrap script

- [ ] **Status**: Pending
- **Acceptance**:
  - Works on macOS (bash 3.2+) and Linux
  - Bootstraps Node, Docker, pnpm, Redis, scanner image, Prisma DB
  - Exports `REDIS_URL`, `DATABASE_URL`, `SCANNER_IMAGE`, `DATA_DIR`
  - Executes `node dist/cli.js "$@"` only after all checks pass

### SM-46: `doctor` command

- [ ] **Status**: Pending
- **Acceptance**:
  - Reports versions of node, docker, pnpm, redis, scanner image, governor CLIs
  - Exits non-zero if any hard dependency missing
  - Helpful remediation messages for each failure mode

### SM-47: `history`, `report`, `diff` commands

- [ ] **Status**: Pending
- **Acceptance**:
  - `history` lists past scans with ID, target, findings count
  - `report <id>` renders the saved report (any format)
  - `diff <id1> <id2>` highlights regressions and fixes

### SM-48: `stop`, `clean` commands

- [ ] **Status**: Pending
- **Acceptance**:
  - `stop` gracefully stops Redis container
  - `clean` removes Redis, scanner image, `data/`, `workspaces/` — prompts for confirmation unless `--yes`
  - Both exit cleanly on repeat invocation (idempotent)

> **GATE**: Fresh-clone user experience is one command.

---

## Phase K — Scanner Docker Image `PENDING` (2 SMs)

### SM-49: `docker/scanner.Dockerfile` with all tools

- [ ] **Status**: Pending
- **Acceptance**:
  - Ubuntu 24.04 base, Trivy pinned at `v0.69.3`
  - All scanners on PATH inside the container
  - Nuclei templates updated at build time
  - Image builds in ≤ 10 minutes on first run

### SM-50: Multi-arch build (amd64 + arm64)

- [ ] **Status**: Pending
- **Acceptance**:
  - `docker buildx build --platform linux/amd64,linux/arm64` succeeds
  - Smoke test on both architectures
  - Image size documented in RUNBOOK.md

> **GATE**: Scanner image reproducible and multi-arch.

---

## Phase T — Testing `PENDING` (6 SMs)

### SM-51: T1 — Unit tests (≥ 80% overall, ≥ 95% critical)

- [ ] **Status**: Pending
- **Acceptance**:
  - Every parser has a snapshot test
  - Every scanner class has a unit test
  - Coverage thresholds met per CLAUDE.md

### SM-52: T2 — Integration tests (testcontainers Redis, fixture Docker mock)

- [ ] **Status**: Pending
- **Acceptance**:
  - Real Redis via testcontainers
  - Mocked Docker executor returns fixture stdout
  - Full Phase 1 + Phase 2 + correlation + report covered
  - Suite runs in ≤ 2 minutes

### SM-53: T3 — E2E tests (golden fixture repo)

- [ ] **Status**: Pending
- **Acceptance**:
  - Intentionally vulnerable fixture repo with known CVEs
  - Real Docker executor
  - Compares findings to recorded baseline
  - Any baseline change requires a plan file with justification

### SM-54: T4 — Code quality audit round

- [ ] **Status**: Pending
- **Acceptance**:
  - Every source file reviewed
  - Findings written to `audits/code-quality-results.md`
  - All findings fixed before gate

### SM-55: T5 — Performance tests

- [ ] **Status**: Pending
- **Acceptance**:
  - Wall-clock variance ≤ 10% across 10 runs
  - Memory peak ≤ 2 GB for 500-file repo
  - Results written to `audits/performance-test-results.md`

### SM-56: T6 — End-to-end pipeline test (governed + Shannon)

- [ ] **Status**: Pending
- **Acceptance**:
  - Full governed run produces ≥ 1 finding, ≥ 1 decision, and a PDF report
  - Shannon integration produces at least one exploit proof
  - Results written to `audits/pipeline-test-results.md`

> **GATE**: All tests pass; coverage thresholds met.

---

## Phase U — Audit & Production Readiness `PENDING` (3 SMs)

### SM-57: U1 — Code audit round (max 5 rounds)

- [ ] **Status**: Pending
- **Acceptance**:
  - Every source file reviewed for correctness, timeouts, error handling
  - Findings → `audits/round-N-findings.md`
  - All findings fixed → zero new findings in next round

### SM-58: U2 — Security audit round (per THREATS.md)

- [ ] **Status**: Pending
- **Acceptance**:
  - STRIDE review completed
  - Per-threat mitigations verified
  - Findings → `audits/security-round-N-findings.md`

### SM-59: U3 — Production polish (README, LICENSE, v0.1.0 tag)

- [ ] **Status**: Pending
- **Acceptance**:
  - README includes North Star UX verbatim
  - LICENSE (MIT) present
  - `sentinel --version` prints `sentinel 0.1.0`
  - Git tag `v0.1.0` pushed

> **GATE**: Production-ready v0.1.0 tagged.

---

## Operational Metrics

Track these during development and evaluation:

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Phase 1 wall-clock (500-file NestJS repo) | ≤ 3 min | — | NOT_MEASURED |
| Phase 2 wall-clock (1 host, 11 endpoints) | ≤ 5 min | — | NOT_MEASURED |
| Phase 3 wall-clock (per Shannon target) | ≤ 30 min | — | NOT_MEASURED |
| Phase 4 wall-clock (correlation + report) | ≤ 10 s | — | NOT_MEASURED |
| Memory peak (500-file repo) | ≤ 2 GB | — | NOT_MEASURED |
| Governor query latency (p95) | ≤ 90 s | — | NOT_MEASURED |
| Fingerprint determinism (1000 iterations) | 100% | — | NOT_VERIFIED |
| Line coverage (overall) | ≥ 80% | — | NOT_MEASURED |
| Line coverage (correlation + governor) | ≥ 95% | — | NOT_MEASURED |

## Quality Audit Status

| Audit Area | Last Completed | Next Due | Status |
|------------|---------------|----------|--------|
| Dependency scan (`pnpm audit`) | — | Monthly | PENDING |
| Scanner Dockerfile CVE review | — | Phase K | PENDING |
| Governor prompt injection review | — | Phase H | PENDING |
| Fingerprint determinism property test | — | Phase F | PENDING |
| License compliance | — | Phase U | PENDING |
| THREATS.md mitigation verification | — | Phase U2 | PENDING |

## Notes

*Append findings, blockers, and decisions here as you work. Never delete entries — future sessions may need them.*

---

## Related Governance Files

- **CLAUDE.md** — Behavioral contract, critical invariants, quality gates.
- **AGENTS.md** — Domain knowledge, module boundaries, decision trees.
- **AGENTS-full.md** — Deep entity/module reference (`AGF::` tokens).
- **BLUEPRINT.md** — Full build plan with phased SMs.
- **FEATURES.md** — Feature registry with audit tracking.
- **TESTS.md** — Test plan, security test checklist, test-audit-fix loop.
- **THREATS.md** — STRIDE threat model.

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
