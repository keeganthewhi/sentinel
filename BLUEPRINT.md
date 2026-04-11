# BLUEPRINT.md — Sentinel

> Self-hosted, open-source security scanning orchestrator. Chains 7 specialized security tools (Trivy, Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap, Shannon) through a mechanical BullMQ pipeline with an optional AI governor layer that reads results and makes four decisions: what to scan, what to escalate, what to discard, how to report.

---

This document defines the phased build plan. Each phase lists tasks, deliverables, and acceptance criteria. The mechanical pipeline is the backbone; the governor is the brain on top. Everything must work without the governor before the governor layer is built.

**Phase order**: 0 → A → B → C → D → E → F → G → H → I → J → K → T → U

**Total status marks**: 59

## Phase Transition Protocol

Before marking any phase complete:

1. All tasks in the phase completed.
2. All acceptance criteria met.
3. Quality gate passes: `pnpm typecheck && pnpm lint && pnpm test` — 0 errors, 0 warnings.
4. Persona-Switch Review completed (see CLAUDE.md).
5. Rollback readiness check: can this phase be reverted without data loss?
6. Commit with message: `[SM-{N}] {phase name}: {summary}`.
7. Push to remote.
8. Update STATE.md: flip the checkbox for the SM, advance `current_phase` / `current_step` / `last_git_sha`.

**NEVER** proceed to the next phase with failing tests or warnings.

## Rollback Readiness Protocol

Every phase must be rollback-safe:

- Database migrations must be additive. Column drops happen across two migrations (stop writing, migrate readers, drop).
- CLI flag changes must be additive — never remove or rename a supported flag without a deprecation window.
- Scanner additions must be opt-in via the scanner registry. Adding a scanner must never break an existing scan.
- Before completing a phase: verify `git revert HEAD` produces a working state. Non-reversible changes must be documented explicitly in the plan file.

## Plan File Template

Every plan file (`plans/{NNN}-{slug}.md`) MUST contain these 11 sections in this exact order:

### Mandatory Sections

1. **Header** — Title, created date, status (PROPOSED/IN_PROGRESS/COMPLETE/BLOCKED), status mark (SM-{N}), git SHA, dependencies.
2. **Cold Start** — Files to read (numbered list), current state, last agent action, expected end state.
3. **Aim** — 1-3 sentences: what this plan accomplishes and why.
4. **Steps** — Numbered, each with: Action verb title, File path (mark new files with `(NEW FILE)`), Detail (code snippets for non-trivial), Constraint.
5. **Acceptance Criteria** — Checkbox list of objectively testable outcomes. Quality gate pass required.
6. **Security Checklist** — Checkbox list. Write `N/A — {reason}` if genuinely not applicable. Never omit.
7. **Test Requirements** — Checkbox list: success case + failure cases + edge cases. For BullMQ workers: job retry, job failure, job timeout. For scanners: tool missing, tool crash, tool timeout, empty output. For governor: AI timeout, AI invalid JSON.
8. **Execution Order** — Step sequence with rationale. `→` for sequential, `+` for parallel.
9. **Rollback** — How to undo: git revert, migration rollback, STATE.md revert, scanner registry rollback.
10. **Completion** — Quality gate → commit (`[SM-{N}] description`) → push → update STATE.md.
11. **Important Findings** — MANDATORY `#` heading at the very bottom. Starts empty. Append discoveries during work.

### Step Rules

- Each step title starts with an action verb: Add, Update, Create, Remove, Refactor, Fix.
- `File:` must be an exact path. Mark new files with `(NEW FILE)`.
- `Detail:` must be specific enough that a fresh agent can execute without asking questions.
- `Constraint:` lists what MUST NOT be violated. Write "None" if no constraint — never omit.
- Each step must be independently verifiable.

### Important Findings Rules

This section is the key to surviving context compaction:

- Always the LAST section in the plan (use `#` heading, not `##`).
- Format entries as: `- [Step N] {discovery}: {detail}`.
- Record: scanner version gotchas, tool flag changes, Prisma migration quirks, BullMQ job option edge cases, governor response format drift.
- After context compaction: re-read this section FIRST before resuming work.

### Plan Numbering

- Sequential across ALL plans ever created: 001, 002, 003...
- File naming: `plans/{NNN}-{slug}.md` (3-digit zero-padded, kebab-case slug).
- NEVER reuse a plan number, even if abandoned.

### Example Skeleton

```markdown
# Plan {N} — {Title}

> **Created**: {YYYY-MM-DD}
> **Status**: IN_PROGRESS
> **Status Mark**: SM-{N}
> **Git SHA (start)**: {sha}
> **Depends on**: SM-{N-1} | N/A

## Cold Start
- **Read these files first**: [numbered list]
- **Current state**: [description]
- **Last agent action**: [what SM-{N-1} did]
- **Expected state after this plan**: [description]

## Aim
{1-3 sentences}

## Steps
### Step 1: Add Trivy scanner implementation
- **File**: `src/scanner/scanners/trivy.scanner.ts` (NEW FILE)
- **Detail**: Extend BaseScanner. Implement `execute()` to run `trivy fs --format json --quiet <repo>` inside the scanner container via DockerExecutor. Parse `.Results[].Vulnerabilities[]` into `NormalizedFinding[]`.
- **Constraint**: Must return `{ success: false, findings: [], error: stderr }` on crash, never throw. Must honour the per-scanner timeout from `ScanContext`.

## Acceptance Criteria
- [ ] Trivy scanner produces findings for a fixture repo with a known CVE
- [ ] Crash path returns structured failure, pipeline continues
- [ ] Quality gate passes with 0 errors, 0 warnings

## Security Checklist
- [ ] No scanner output interpolated into a shell command
- [ ] Scanner stderr is logged but not shown to user unless `--verbose`

## Test Requirements
- [ ] Unit test: parseOutput on real Trivy JSON fixture
- [ ] Unit test: parseOutput on empty Trivy output (`{"Results":null}`)
- [ ] Integration test: scanner runs end-to-end against a tiny fixture repo

## Execution Order
**Recommended**: 1 → 2 → 3 → 4
**Rationale**: Parser first (testable in isolation), then execute(), then wire into registry, then integration test.

## Rollback
1. `git revert HEAD`
2. Remove trivy entry from `src/scanner/scanner.registry.ts`
3. Update STATE.md: uncheck SM

## Completion
1. `pnpm typecheck && pnpm lint && pnpm test`
2. Commit: `[SM-{N}] scanners: add Trivy scanner implementation`
3. Push → update STATE.md

# Important Findings
(Append discoveries here as you work.)
```

## Error Recovery Protocol

When a build step fails:

1. **Classify** the error (TypeScript compile, ESLint, test failure, scanner subprocess, Docker, Prisma migration).
2. **Read** the error message carefully — do not guess at fixes.
3. **Fix** the root cause (not the symptom).
4. **Verify** the fix passes the quality gate.
5. **Retry limit**: maximum 3 attempts at the same fix approach.
6. If 3 retries fail:
   - Document the issue in the plan file's `# Important Findings`.
   - Try an alternative approach.
   - If no alternative works: mark as blocker in STATE.md and move on.

**NEVER**: Silence errors with `// @ts-ignore`, `any` types, or empty catch blocks. Scanner output parsing MAY use `any` at the boundary layer but must be typed immediately after validation.
**NEVER**: Delete failing tests to make the suite pass.
**NEVER**: Comment out a failing scanner in the registry to make the pipeline green.

## Essential Commands

```bash
pnpm install                              # install dependencies
pnpm build                                # compile TypeScript
pnpm typecheck                            # tsc --noEmit (strict)
pnpm lint                                 # eslint with zero warnings
pnpm test                                 # vitest unit + integration
pnpm test:e2e                             # end-to-end pipeline tests
pnpm prisma:generate                      # regenerate Prisma client
pnpm prisma:migrate:dev --name <name>     # create migration
pnpm prisma:migrate:deploy                # apply migrations (CI/runtime)
docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .
./sentinel doctor                         # check toolchain readiness
./sentinel start --repo <path>            # run mechanical scan
```

---

## Phase 0 — Environment Setup `PENDING` (4 SMs)

Prepare the host toolchain before touching code.

1. **SM-1** — Verify prerequisites: Node.js 22+, Docker Desktop running, pnpm ≥ 9.0.0, GitHub CLI (`gh`) installed and authenticated (`gh auth status` must succeed). Document versions in `plans/001-env-setup.md` Important Findings.
2. **SM-2** — Install global toolchain: `corepack enable` → `corepack prepare pnpm@latest --activate`. Verify `pnpm --version`.
3. **SM-3** — Initialize Git and create the GitHub remote.
   a. `git init` in the repo root.
   b. Create `.gitignore` excluding `node_modules/`, `dist/`, `data/`, `workspaces/`, `tools/`, `.claude-session.md`, `.env`, `*.db`, `coverage/`. Plan files (`plans/`) and governance files (`*.md`, `MANIFEST.json`) ARE committed.
   c. Stage governance + gitignore: `git add CLAUDE.md AGENTS.md AGENTS-full.md BLUEPRINT.md STATE.md FEATURES.md TESTS.md THREATS.md MANIFEST.json docs/ governor-templates/ plans/ .gitignore`.
   d. First commit: `git commit -m "chore(governance): initial governance file set [SM-3]"`.
   e. Create the remote and push: `gh repo create keeganthewhi/sentinel --private --source=. --remote=origin --push --description "Unified Application Security Testing Platform — self-hosted security scanner orchestrator with optional AI governor"`.
   f. Verify: `git remote -v` shows `origin` pointing at `https://github.com/keeganthewhi/sentinel.git` and the commit is visible on GitHub.
4. **SM-4** — Install optional governor CLIs (for governed-mode development): `npm install -g @anthropic-ai/claude-code` OR `codex` OR `gemini`. Mark as N/A if only mechanical mode will be exercised.

### Acceptance Criteria

- `node -v` prints `v22.x` or higher
- `docker info` succeeds
- `pnpm --version` prints `9.x` or higher
- `gh auth status` succeeds
- `.gitignore` excludes all ephemeral artifacts
- `git remote -v` shows `origin` pointing at `https://github.com/keeganthewhi/sentinel.git`
- Initial governance commit visible on GitHub

> **GATE**: All SMs checked. Host can build Node apps and run Docker. Remote repo exists.

---

## Phase A — Project Scaffolding `PENDING` (5 SMs)

Stand up the NestJS project and common infrastructure.

1. **SM-5** — `pnpm init` with name `sentinel`, version `0.1.0`, license `MIT`. Add `packageManager: "pnpm@9.x"`. Create `tsconfig.json` with `strict: true`, `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `esModuleInterop: true`, `skipLibCheck: true`, `outDir: dist`.
2. **SM-6** — Install NestJS 11 runtime: `@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `reflect-metadata`, `rxjs`. Dev deps: `typescript@5.6+`, `@types/node@22`, `ts-node`, `eslint@9`, `@typescript-eslint/*`, `prettier`, `vitest`, `@vitest/coverage-v8`.
3. **SM-7** — Scaffold `src/main.ts` (NestJS bootstrap) and `src/app.module.ts` (empty root module). Scaffold `src/cli.ts` as the Commander entry (no commands yet, just `program.parse()`).
4. **SM-8** — Create `src/common/logger.ts` with pino, JSON output in prod, pretty in dev, structured fields `scanId`, `scanner`, `phase`. Create `src/common/errors.ts` with typed errors: `ScannerNotAvailableError`, `ScannerTimeoutError`, `ScannerCrashError`, `GovernorTimeoutError`, `GovernorInvalidResponseError`.
5. **SM-9** — Create `src/config/` module: `config.schema.ts` (Zod schema for the merged config — CLI flags + `sentinel.yaml` + env vars), `config.service.ts` (parses, validates, throws on malformed input). Add `pnpm typecheck`, `pnpm lint`, `pnpm test` scripts.

### Acceptance Criteria

- `pnpm build` compiles with 0 errors
- `pnpm typecheck` succeeds
- `pnpm lint` passes with 0 warnings
- NestJS app boots (`pnpm start`) without errors even though it has no controllers
- Pino logger emits structured JSON when `NODE_ENV=production`

**AGF Reference**: Before this phase, read `AGF::Logger` and `AGF::ConfigSchema` in AGENTS-full.md.

> **GATE**: All SMs checked. Scaffolding clean.

---

## Phase B — Scanner Abstractions & Docker Executor `PENDING` (5 SMs)

Define the scanner contract and the subprocess runner before any scanner exists.

1. **SM-10** — Create `src/scanner/types/finding.interface.ts` with `NormalizedFinding` (title, description, severity, category, cveId, cweId, filePath, lineNumber, endpoint, evidence, exploitProof, remediation). Severity is the literal union `'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'`.
2. **SM-11** — Create `src/scanner/types/scanner.interface.ts` with `ScannerResult`, `ScanContext`, and `BaseScanner` abstract class (`name`, `phase`, `requiresUrl`, `execute(ctx)`, `parseOutput(raw)`, `isAvailable()`).
3. **SM-12** — Create `src/execution/docker.executor.ts`. Responsibilities: spawn `docker run --rm -v <repo>:/workspace:ro sentinel-scanner:latest <cmd>`, capture stdout/stderr, enforce timeout via `child_process.spawn` + `AbortController`, return `{ exitCode, stdout, stderr, timedOut }`. MUST escape arguments properly; NEVER interpolate scanner output into a shell command.
4. **SM-13** — Create `src/execution/output-parser.ts`. Helpers: `parseJson(raw)` (throws typed error on invalid), `parseJsonLines(raw)` (skips empty lines, throws on any invalid line with a line index), `parseXml(raw)` (uses `fast-xml-parser`).
5. **SM-14** — Create `src/scanner/scanner.registry.ts` — an in-memory map keyed by scanner name. Expose `register(scanner)`, `get(name)`, `all()`, `forPhase(n)`. Empty at this phase; populated in C and D.

### Acceptance Criteria

- `BaseScanner` cannot be instantiated directly (abstract)
- `DockerExecutor` times out correctly at the configured limit (unit test with sleep 9999 + 100ms timeout)
- Registry returns phase-1 and phase-2 scanners separately
- All types exported from `src/scanner/types/index.ts`

**AGF Reference**: `AGF::DockerExecutor`, `AGF::ScannerRegistry`, `AGF::BaseScanner`.

> **GATE**: Contract frozen. Scanners from C and D must adhere without modification.

---

## Phase C — Phase 1 Scanners `PENDING` (5 SMs)

Implement the five scanners that run in parallel at Phase 1.

1. **SM-15** — `src/scanner/scanners/trivy.scanner.ts`. Command: `trivy fs --format json --quiet --scanners vuln,secret,misconfig /workspace`. Parse `.Results[].Vulnerabilities[]`, `.Results[].Secrets[]`, `.Results[].Misconfigurations[]`. Category mapping: vuln→`dependency`, secret→`secret`, misconfig→`iac`.
2. **SM-16** — `src/scanner/scanners/semgrep.scanner.ts`. Command: `semgrep --config <cfg> --json /workspace` where `<cfg>` comes from scan context (default `p/default`). Parse `.results[]`. Category: `sast`.
3. **SM-17** — `src/scanner/scanners/trufflehog.scanner.ts`. Command: `trufflehog filesystem --json --only-verified /workspace`. Parse JSON lines. Category: `secret`. Severity: HIGH if `Verified == true`, MEDIUM otherwise.
4. **SM-18** — `src/scanner/scanners/subfinder.scanner.ts`. Command: `subfinder -d <domain> -json`. Only runs when `context.targetUrl` is set. Output is stored in `context.discoveredSubdomains` (no findings by itself).
5. **SM-19** — `src/scanner/scanners/httpx.scanner.ts`. Command: `httpx -json -status-code -tech-detect -u <host>` — reads hosts from `context.discoveredSubdomains`. Output populates `context.discoveredEndpoints`.

### Acceptance Criteria

- Every scanner registers itself via `ScannerRegistry.register()` when its module is imported
- Each scanner handles: tool missing (isAvailable returns false), tool crash (result.success=false with stderr), tool timeout, empty output
- Snapshot tests exist for each parser against a real tool output fixture
- No scanner imports another scanner

**AGF Reference**: `AGF::TrivyScanner`, `AGF::SemgrepScanner`, `AGF::TruffleHogScanner`, `AGF::SubfinderScanner`, `AGF::HttpxScanner`.

⚠ **Gotchas**: Trivy may emit `"Results": null` on an empty repo — parse must treat null as zero findings. TruffleHog outputs JSON lines, not a JSON array. Semgrep emits a schemaVersion field that changes across 1.x/2.x — do not assume schema stability, parse defensively.

> **GATE**: All phase-1 scanners callable via registry; end-to-end smoke test on a fixture repo returns real findings.

---

## Phase D — Phase 2 Scanners `PENDING` (3 SMs)

Scanners that depend on Phase 1 output (discovered endpoints / subdomains).

1. **SM-20** — `src/scanner/scanners/nuclei.scanner.ts`. Command: `nuclei -jsonl -silent -t <templates> -u <url>` where `<templates>` defaults to `cves/,misconfiguration/,exposed-panels/`. Reads URLs from `context.discoveredEndpoints`.
2. **SM-21** — `src/scanner/scanners/schemathesis.scanner.ts`. Only runs when `context.openApiSpec` is set. Command: `schemathesis run --base-url <url> <spec> --checks all --junit-xml -`. Parse JUnit XML failures into findings.
3. **SM-22** — `src/scanner/scanners/nmap.scanner.ts`. Command: `nmap -sV --top-ports 1000 -oX - <host>`. Parse XML with `fast-xml-parser`. Findings carry open ports as `endpoint` field.

### Acceptance Criteria

- Nuclei respects `rate_limit` from context — never overrides the governor-set value
- Schemathesis skips cleanly with a logged reason when no OpenAPI spec is present
- Nmap XML parser extracts service, version, state, and script output

**AGF Reference**: `AGF::NucleiScanner`, `AGF::SchemathesisScanner`, `AGF::NmapScanner`.

⚠ **Gotchas**: Nmap XML is DTD-less and `fast-xml-parser` must be configured with `attributeNamePrefix: ""` for ergonomic access. Nuclei will print progress to stderr even with `-silent` — do NOT treat non-empty stderr as a crash indicator.

> **GATE**: Phase 2 scanners integrate cleanly with Phase 1 output via ScanContext.

---

## Phase E — BullMQ Pipeline Orchestration `PENDING` (5 SMs)

Wire scanners into a resumable, phased queue with a real-time terminal UI.

1. **SM-23** — `src/pipeline/pipeline.module.ts` + BullMQ queue setup. Auto-connect to `REDIS_URL`. Expose a single queue `sentinel-scans` with typed job data `{ scanId, phase, scannerName }`.
2. **SM-24** — `src/pipeline/phases/phase-1-static.ts` enqueues one job per enabled Phase 1 scanner in parallel. Waits for all to complete via `Promise.allSettled`.
3. **SM-25** — `src/pipeline/phases/phase-2-infra.ts` mirrors Phase 1 for Phase 2 scanners. Blocks until Phase 1 has populated `ScanContext.discoveredEndpoints`.
4. **SM-26** — `src/pipeline/workers/scanner.worker.ts` processes jobs: looks up scanner in registry, calls `execute(ctx)`, persists `ScannerResult`, emits progress events to `TerminalUI`.
5. **SM-27** — `src/report/progress/terminal-ui.ts` — real-time terminal display with spinners (ora or custom), per-scanner status (PENDING/RUNNING/OK/FAIL), phase headers, governor decision lines in cyan.

### Acceptance Criteria

- Pipeline is resumable: killing the process mid-Phase-2 and restarting picks up from STATE.md without re-running Phase 1
- Per-scanner failure does not cancel the phase; other scanners complete
- Terminal UI updates at most every 100ms; no cursor flicker
- `--phases 1,2` CLI flag restricts execution to specified phases

**AGF Reference**: `AGF::Pipeline`, `AGF::PhaseOneStatic`, `AGF::PhaseTwoInfra`, `AGF::ScannerWorker`, `AGF::TerminalUI`.

> **GATE**: Full mechanical scan (Phase 1 + Phase 2) runs end-to-end against a fixture repo with a live fixture server.

---

## Phase F — Mechanical Correlation & Reports `PENDING` (5 SMs)

Fingerprint, dedup, and render reports without AI involvement.

1. **SM-28** — `src/correlation/fingerprint.ts`. `fingerprint(finding)` hashes `cveId || filePath+lineNumber || endpoint+category` with SHA-256. Deterministic and stable across runs.
2. **SM-29** — `src/correlation/correlation.service.ts`. Groups findings by fingerprint; merges groups preserving the richest evidence as the primary record; marks duplicates via `isDuplicate=true` + `correlationId`.
3. **SM-30** — `src/correlation/severity-normalizer.ts`. Applies the rules: Shannon exploit confirmed → floor at HIGH; Semgrep taint trace → boost one level; dependency CVE without reachability → keep as-is; Nuclei template match without exploit → reduce one level. Governor decisions override these in governed mode (skipped here — read at SM-43).
4. **SM-31** — `src/report/renderers/markdown.renderer.ts`. Template-based report: executive summary, severity breakdown, findings grouped by category, per-finding block with file:line, evidence, remediation, references. JSON renderer at same path.
5. **SM-32** — `src/report/renderers/pdf.renderer.ts` using `pdfmake`. Single-file report with TOC, severity badges, code excerpts.

### Acceptance Criteria

- Fingerprint is deterministic: same finding → same hash across 100 runs (property test)
- Correlation engine merges findings from Trivy + Semgrep that share a CVE into one entry with both scanners cited
- Severity normalizer boosts a Semgrep taint trace from MEDIUM to HIGH
- Markdown report renders valid GitHub-flavored markdown
- PDF report opens in evince / macOS Preview without warnings

**AGF Reference**: `AGF::Fingerprint`, `AGF::CorrelationEngine`, `AGF::SeverityNormalizer`, `AGF::MarkdownRenderer`, `AGF::PdfRenderer`.

> **GATE**: A mechanical-mode scan produces a deterministic report from deterministic input.

---

## Phase G — Persistence & Regression `PENDING` (4 SMs)

Persist everything into SQLite (lite mode) with Prisma. PostgreSQL is a drop-in for full mode via `DATABASE_URL`.

1. **SM-33** — `prisma/schema.prisma` — models per AGENTS-full.md `AGF::DatabaseSchema`: `Scan`, `PhaseRun`, `Finding` (unique constraint on `[scanId, fingerprint]`), `GovernorDecision`, `Report`.
2. **SM-34** — `pnpm prisma:migrate:dev --name init` to produce the initial migration. Verify migration applies cleanly to an empty SQLite file and rolls forward/backward.
3. **SM-35** — `src/persistence/scan.repository.ts` + `finding.repository.ts` + `governor-decision.repository.ts`. All writes inside `prisma.$transaction()` where multiple rows mutate together.
4. **SM-36** — `src/persistence/regression.service.ts`. Compares current scan against the most recent completed scan for the same `targetRepo`. Marks `isRegression=true` on findings present in the new scan but absent from the previous one.

### Acceptance Criteria

- Every phase-complete event writes both a `PhaseRun` row and its findings atomically
- Regression service correctly detects new findings between two runs
- Migrations apply cleanly on an empty database and produce an identical schema to a fresh `db push`
- Schema supports PostgreSQL (change `datasource db.provider` and re-run `prisma generate` — no schema errors)

**AGF Reference**: `AGF::DatabaseSchema`, `AGF::ScanRepository`, `AGF::FindingRepository`, `AGF::RegressionService`.

⚠ **Gotchas**: SQLite does not support `Json` column filters well — store governor decisions as `String` and parse on read. SQLite timestamps are stored as `DateTime` via Prisma but lose sub-second precision.

> **GATE**: All pipeline state is persisted and queryable by CLI commands from Phase J.

---

## Phase H — Governor Layer `PENDING` (5 SMs)

Optional AI overseer. Everything before this phase must work without it.

1. **SM-37** — `src/governor/agent-adapter.ts`. Spawns CLI subprocess (`claude --print <prompt>` / `codex --print <prompt>` / `gemini --print <prompt>`). 5-minute timeout. Graceful fallback to mechanical mode on timeout, non-zero exit, or unparseable JSON.
2. **SM-38** — `src/governor/governor.prompts.ts`. Three prompt builders: `buildScanPlanPrompt`, `buildEvaluationPrompt`, `buildReportPrompt`. Each prompt embeds the governor contract (from `governor-templates/CLAUDE.md`) as a system layer and only uses typed, validated inputs as user content. NEVER string-interpolate raw scanner output into system prompts.
3. **SM-39** — `src/governor/plan-generator.ts` (Decision 1). Reads mechanical file tree + `package.json` + optional config, builds prompt, queries agent, parses JSON via Zod, writes `workspaces/<scanId>/BLUEPRINT.md`.
4. **SM-40** — `src/governor/phase-evaluator.ts` (Decisions 2 + 3). Called after Phase 1 and Phase 2. Receives normalized findings + ScanContext + previous decisions. Returns `{ escalateToShannon, discardFindings, adjustSeverity, notes }`. Persists to `GovernorDecision` table.
5. **SM-41** — `src/governor/report-writer.ts` (Decision 4). Final AI-authored report. Receives all findings + all decisions + blueprint. Emits Markdown with explicit file:line citations and scanner evidence. Falls back to mechanical markdown renderer on any failure.

### Acceptance Criteria

- Governor is fully optional: mechanical pipeline works byte-identical when `--governed` is absent
- A 5-minute governor timeout reverts the affected decision to its mechanical counterpart and logs a WARN
- Governor decisions are persisted for auditability with the full input+output JSON
- Report-writer citations are verifiable against actual findings (no hallucinated file paths)

**AGF Reference**: `AGF::Governor`, `AGF::AgentAdapter`, `AGF::PlanGenerator`, `AGF::PhaseEvaluator`, `AGF::ReportWriter`, `AGF::GovernorContract` (references `governor-templates/CLAUDE.md`).

⚠ **Gotchas**: `claude --print` emits prefix lines before JSON in some versions — strip until the first `{`. Codex wraps responses in ANSI; set `NO_COLOR=1`. Gemini may truncate long prompts — chunk the findings array if it exceeds 64KB.

> **GATE**: Governed mode produces an AI-written report that cites real file paths from the actual mechanical findings.

---

## Phase I — Shannon Integration (Phase 3) `PENDING` (2 SMs)

The optional exploitation stage.

1. **SM-42** — Clone the Shannon fork and implement the scanner wrapper.
   a. Clone `https://github.com/keeganthewhi/shannon-noapi.git` to `tools/shannon-noapi/` (directory is gitignored; the `sentinel` bootstrap script re-clones on first run when `--shannon` is used). Upstream reference: `https://github.com/KeygraphHQ/shannon` — consult upstream for feature parity; see ADR-012 for why we use the fork.
   b. Create `src/scanner/scanners/shannon.scanner.ts`. Invokes Shannon via the detected governor CLI, passing `context.governorEscalations` as the priority target list and `tools/shannon-noapi/` as the Shannon working directory.
   c. Parse the Shannon Markdown report into `NormalizedFinding[]` with `exploitProof` populated.
2. **SM-43** — `src/pipeline/phases/phase-3-exploit.ts`. Only runs when `--shannon` is set AND at least one target was escalated by the governor (or explicitly by the user in mechanical mode). Verify `tools/shannon-noapi/` exists before dispatch; if missing, fail with a clear remediation hint pointing at the bootstrap script.

### Acceptance Criteria

- Shannon output parser extracts every finding section from the markdown report
- `exploitProof` field is populated for every Shannon finding
- Phase 3 is skipped cleanly when no targets are escalated

**AGF Reference**: `AGF::ShannonScanner`, `AGF::PhaseThreeExploit`.

> **GATE**: End-to-end governed + Shannon scan produces a report with proof-of-concept exploits.

---

## Phase J — CLI & Bootstrap `PENDING` (5 SMs)

The `./sentinel` user entry point.

1. **SM-44** — `src/cli.ts` with Commander commands: `start`, `history`, `report <id>`, `diff <id1> <id2>`, `doctor`, `stop`, `clean`. `start` is the most complex — it wires config → scan record → pipeline → report.
2. **SM-45** — `sentinel` bash script at repo root per spec. Bootstraps Node, Docker, pnpm, Redis container, scanner image, Prisma DB, governor CLI presence check. When `--shannon` is present in the argv AND `tools/shannon-noapi/` does not exist, clone `https://github.com/keeganthewhi/shannon-noapi.git` to that path. Exports `REDIS_URL`, `DATABASE_URL`, `SCANNER_IMAGE`, `DATA_DIR`, `SHANNON_DIR=./tools/shannon-noapi`. Executes `node dist/cli.js "$@"`.
3. **SM-46** — `doctor` command: reports versions of node, docker, pnpm, redis (via `redis-cli ping`), scanner image (via `docker image inspect`), and each governor CLI. Exits non-zero if any hard dependency is missing.
4. **SM-47** — `history` / `report` / `diff` commands read from Prisma. `report <id> --decisions` includes the governor decision log. `diff` highlights regressions (new findings) and fixes (disappeared findings).
5. **SM-48** — `stop` stops the Redis container. `clean` removes Redis, scanner image, `data/`, and `workspaces/`. `clean` prompts for confirmation unless `--yes` is passed.

### Acceptance Criteria

- `./sentinel` on a fresh machine installs everything and runs a scan end-to-end
- `./sentinel doctor` catches missing Docker with a helpful message
- CLI exits with meaningful codes: 0 success, 1 scan failed, 2 prerequisite missing, 3 bad arguments
- `sentinel clean --yes` removes all state deterministically

**AGF Reference**: `AGF::CLI`, `AGF::BootstrapScript`, `AGF::DoctorCommand`, `AGF::HistoryCommand`, `AGF::DiffCommand`.

⚠ **Gotchas**: Bash on macOS is 3.2 by default — do not use `[[ var =~ ... ]]` tricks that require 4+. On Windows WSL, the `sentinel` bash script must detect WSL and rewrite mounted paths `/mnt/c/...` to `C:/...` for Docker.

> **GATE**: Fresh-clone user experience is one command: `./sentinel start --repo <path>`.

---

## Phase K — Scanner Docker Image `PENDING` (2 SMs)

The fat image that contains every scanner binary.

1. **SM-49** — `docker/scanner.Dockerfile` per spec. Ubuntu 24.04 base, pin Trivy at `v0.69.3`, install Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap. Run `nuclei -update-templates` during build.
2. **SM-50** — Multi-arch build: `docker buildx build --platform linux/amd64,linux/arm64 ...`. Verify on Apple Silicon hosts and x86_64 Linux.

### Acceptance Criteria

- Image builds on amd64 and arm64
- Image size documented in RUNBOOK.md
- Smoke test: `docker run --rm sentinel-scanner:latest trivy --version` prints `v0.69.3`
- Every scanner binary is on PATH inside the container

**AGF Reference**: `AGF::ScannerDockerfile`.

⚠ **Gotchas**: `go install` with ARM64 builds needs `GOARCH=arm64` set explicitly. Trivy `install.sh` fails silently if the target path is non-writable — use `-b /usr/local/bin` explicitly.

> **GATE**: Scanner image is reproducible and multi-arch.

---

## Phase T — Testing (test-audit-fix loop) `PENDING` (6 SMs)

Runs after all build phases complete. Every step executes without user approval.

1. **SM-51** — **T1: Unit tests**. Cover every parser, every scanner class, every correlation helper, every governor prompt builder, config schema, fingerprint, severity normalizer. Coverage ≥ 80%.
2. **SM-52** — **T2: Integration tests**. Real Redis container (via testcontainers), real SQLite file, mocked Docker executor that returns fixture stdout. Covers full Phase 1 + Phase 2 + correlation + report.
3. **SM-53** — **T3: E2E tests**. Real Docker executor against a golden fixture repo with known CVEs (intentionally vulnerable app snapshot). Runs Phase 1 + Phase 2 + mechanical report and compares findings to a recorded baseline.
4. **SM-54** — **T4: Code quality audit**. Review every source file for correctness, missing error paths, scanner timeout handling, BOLA-equivalent mistakes (no finding from scan A leaks into scan B). Findings → `audits/code-quality-results.md`.
5. **SM-55** — **T5: Performance tests**. Measure scan wall-clock on the golden fixture across 10 runs; verify ±10% variance. Track memory peak; must stay under 2 GB for a 500-file repo.
6. **SM-56** — **T6: End-to-end pipeline test**. Full governed + Shannon run on a dedicated staging target. Verify governor decisions, Shannon exploits, final report citations. Findings → `audits/pipeline-test-results.md`.

### Acceptance Criteria

- Unit coverage ≥ 80% overall, ≥ 95% on correlation engine and governor adapter
- Integration tests run in under 2 minutes
- E2E governed-mode test produces at least one finding, at least one governor decision, and a PDF report
- No scanner has a missing test file

**AGF Reference**: `AGF::TestStrategy`, `AGF::ScannerFixtures`, `AGF::GovernorMock`.

> **GATE**: All tests pass; coverage thresholds met.

---

## Phase U — Audit & Production Readiness `PENDING` (3 SMs)

Iterative audit loop with max 5 rounds.

1. **SM-57** — **U1: Code audit round**. Read every source file. Check: error handling, timeout enforcement, no hardcoded paths, no secrets, governor response validation, no silent `catch {}`. Findings → `audits/round-N-findings.md`.
2. **SM-58** — **U2: Security audit round**. Per THREATS.md: prompt injection paths, command injection via scanner args, path traversal on repo argument, secret leakage in logs, scanner binary tampering (image integrity). Findings → `audits/security-round-N-findings.md`.
3. **SM-59** — **U3: Production polish**. README.md, LICENSE (MIT), issue templates, sample configs, `--version` flag, telemetry opt-in stub (disabled by default). Tag `v0.1.0`, publish release notes.

### Acceptance Criteria

- Audit loop terminates with zero new findings (max 5 rounds)
- Every finding has a fix plan in `plans/` and a commit
- README includes the North Star UX from the spec verbatim
- `./sentinel --version` prints `sentinel 0.1.0`

**AGF Reference**: `AGF::AuditLoop`, `AGF::ProductionChecklist`.

> **GATE**: Production-ready v0.1.0 tagged and pushed.

---

## Related Governance Files

Read CLAUDE.md first at every session start, then AGENTS.md, then the file relevant to your current task.

| File | When to read | Purpose |
|------|-------------|---------|
| `CLAUDE.md` | Every session start | Behavioral contract, critical invariants, plan mandate, quality gate |
| `AGENTS.md` | Every session start | Domain knowledge, module boundaries, decision trees |
| `AGENTS-full.md` | Before implementing a specific module/entity/scanner | Deep reference — seek AGF:: tokens |
| `BLUEPRINT.md` | Before starting any SM | Full build plan with phased status marks and acceptance criteria |
| `STATE.md` | Before and after each SM | Build progress tracker (YAML frontmatter + checkboxes) |
| `FEATURES.md` | During post-build audit | Feature registry with audit tracking |
| `TESTS.md` | Before writing tests or running the Phase T loop | Test plan, test-audit-fix loop protocol |
| `THREATS.md` | During Phase U security audit | STRIDE model, per-threat mitigations, domain-specific risks |
| `MANIFEST.json` | When adding dependencies or setting up the project | Machine-readable project metadata |
| `docs/adr/README.md` | When questioning an architectural decision | Architecture Decision Records |
| `governor-templates/CLAUDE.md` | When implementing Phase H (governor) | Governor runtime behavioral contract — copied into each scan workspace |
| `governor-templates/AGENTS.md` | When implementing Phase H (governor) | Scanner agent definitions for governor consumption — copied into each scan workspace |
| `governor-templates/BLUEPRINT.example.md` | When implementing SM-39 (plan-generator) | Canonical format the governor must emit |
| `governor-templates/STATE.example.md` | When implementing SM-40 (phase-evaluator) | Canonical format for per-scan live state updates |

---

## Architectural Notes for the Building Agent

- **Mechanical pipeline is the backbone; the governor is the brain on top.** Everything must work without the governor before the governor layer is built. Governor code cannot be a precondition for any mechanical feature.
- **Every scanner is a leaf.** No scanner imports another scanner. Cross-scanner logic lives in `correlation/`, never in a scanner implementation.
- **Phase 1 → Phase 2 hand-off happens through `ScanContext`.** Phase 1 writes `discoveredSubdomains` + `discoveredEndpoints`; Phase 2 reads them. No direct scanner-to-scanner coupling.
- **The governor never executes tools.** It reads `ScannerResult` and writes `GovernorDecision`. If a file in `src/governor/` ever spawns a scanner subprocess, that is an architectural bug.
- **Scanner failure is normal.** A crashed Trivy does not crash the pipeline. Every `ScannerResult` carries `{ success, error, findings }`; correlation and reporting handle partial results.
- **Reports must cite sources.** Every finding in the final report must include at least one of: scanner name, file:line, CVE ID, endpoint. Vague statements are a quality-gate failure.

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
