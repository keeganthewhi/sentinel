# CLAUDE.md — Sentinel

> Rules and invariants for all agents working on Sentinel. This file wins over all other files.
> **Session Init**: Read CLAUDE.md → AGENTS.md → STATE.md (`current_phase`) → BLUEPRINT.md section for that phase → current plan file in `plans/`. Use AGENTS-full.md (AGF:: tokens) for deep module/entity lookups. Consult FEATURES.md for feature audit status, TESTS.md for test plan, THREATS.md for security posture.

---

## What Sentinel Is

Sentinel is a self-hosted, open-source security scanning orchestrator. It chains seven specialized security tools (Trivy, Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap, plus optional Shannon AI-DAST) through a mechanical BullMQ pipeline. An optional AI governor layer watches results and makes four decisions: what to scan, what to escalate, what to discard, how to report.

**Two modes**: mechanical (no AI, works for everyone — the backbone) and governed (AI overseer — the brain on top). The mechanical pipeline must be fully functional before any governor code is written.

## BLUEPRINT.md Re-Read Rule

Before starting any build phase, re-read the corresponding BLUEPRINT.md section. After context compaction, blueprint content is lost. The file on disk is the source of truth. Never build from memory alone.

## Mandatory Plan Rule (Non-Negotiable)

Any change that is a **feature addition, refactor, or multi-file modification** MUST follow this process — regardless of perceived simplicity:

1. Create a plan in `plans/{NNN}-{slug}.md` following the Plan File Template in BLUEPRINT.md exactly (11 mandatory sections).
2. Execute immediately — do NOT ask the user for approval, do NOT wait for input between steps.
3. Always operate in bypass permissions mode during plan execution.
4. Every mandatory section from the template must be present: Header, Cold Start, Aim, Steps, Acceptance Criteria, Security Checklist, Test Requirements, Execution Order, Rollback, Completion, Important Findings.
5. Steps must be specific enough that a fresh agent with zero context can execute them without questions. Include code snippets for non-trivial changes.
6. After execution: run quality gate → commit → push. No exceptions.

The only exception is the **Micro-Fix Exception**: under 3 lines changed, single file, zero security implications, no scanner behavior change, no governor decision change.

## Critical Invariants (Non-Negotiable)

1. **Quality Gate**: `pnpm typecheck && pnpm lint && pnpm test` must pass with 0 errors, 0 warnings before any SM is marked complete.
2. **Mechanical-First**: The mechanical pipeline must work end-to-end without the governor. No mechanical feature may depend on governor code. Phase H (governor) is optional; Phases 0–G must be complete and passing before it begins.
3. **Scanner Failure is Normal**: Every scanner must handle: tool missing → graceful skip; tool crash → `{ success: false, error, findings: [] }`; tool timeout → same; empty output → zero findings (not an error). A crashed scanner never crashes the pipeline.
4. **Governor Never Executes Tools**: `src/governor/*` is read-only on scan output. It may query the agent CLI, write `GovernorDecision` records, and write `workspaces/<scanId>/BLUEPRINT.md` / `STATE.md`. It may NEVER spawn a scanner subprocess. If you are in `src/governor/` and reach for `child_process`, stop and re-architect.
5. **Scanner Output is Untrusted**: Scanner stdout is adversarial input. NEVER interpolate raw scanner output into a shell command, a Prisma raw query, or a governor system prompt. All parsing happens through typed parsers in `src/execution/output-parser.ts` with Zod validation at the boundary.
6. **Prompt Injection — Structural Defense**: The governor receives scanner findings as *user content*, never as *system prompts*. `governor.prompts.ts` is the ONLY file that constructs governor payloads. The governor behavioral contract (from `governor-templates/CLAUDE.md`) is the system layer. No other file builds governor messages. No string interpolation of scanner-provided text into the system layer.
7. **Governor Timeout = Mechanical Fallback**: Every governor query has a 5-minute timeout. On timeout, non-zero exit, or unparseable JSON, the affected decision reverts to its mechanical counterpart and a WARN is logged. The pipeline NEVER aborts because of a governor failure.
8. **Fingerprint Determinism**: `fingerprint(finding)` must be deterministic across runs. Same finding → same hash, always. Property test with 1000+ iterations enforces this. Non-determinism in the fingerprint invalidates dedup, correlation, and regression detection.
9. **Workspace Isolation**: Per-scan state lives in `workspaces/<scanId>/`. A finding from scan A must NEVER leak into scan B. All repositories are scoped by `scanId`. Governor decisions reference fingerprints, not global IDs.
10. **Structured Logging**: All log output goes through `src/common/logger.ts` (pino). Every log line carries `scanId` + `scanner` (when applicable) + `phase`. NEVER log scanner stdout verbatim unless `--verbose`; NEVER log governor prompts or responses unless `--verbose`; NEVER log secret values even when TruffleHog reports them (log the fingerprint instead).
11. **Zero Hardcoding**: No hardcoded paths, ports, image names, CLI flags, or scanner versions in TypeScript source. Everything flows from `src/config/` which merges CLI flags + `sentinel.yaml` + environment variables through a Zod schema.
12. **Migration Safety**: Never edit a Prisma migration file after it has been committed. Schema changes require a new migration. Column drops happen across two migrations: stop writing, deploy, migrate readers, deploy, drop.

## Error Contract

All user-facing errors flow through typed exception classes in `src/common/errors.ts`:

```typescript
ScannerNotAvailableError    // tool missing from image
ScannerTimeoutError         // scanner exceeded timeout
ScannerCrashError           // non-zero exit with captured stderr
GovernorTimeoutError        // AI CLI exceeded 5 minute budget
GovernorInvalidResponseError // AI response failed Zod validation
ConfigValidationError       // CLI flags + YAML failed merged schema
DockerNotRunningError       // bootstrap failed doctor check
```

Terminal output format on pipeline failure:

```json
{
  "error": "<error class name>",
  "scanner": "<if applicable>",
  "scanId": "<cuid>",
  "phase": "<phase number or 'bootstrap'>",
  "message": "<human readable>",
  "remediation": "<one-line fix hint>"
}
```

Exit codes: `0` success, `1` scan failed with findings, `2` prerequisite missing (doctor check failed), `3` invalid arguments, `4` governor failed irrecoverably in governed mode.

## Workflow

0. **Version Audit** (first session only) — Resolve every `latest` in `package.json` to pinned versions. Pin Trivy, Semgrep, TruffleHog, Nuclei to known-good releases in `docker/scanner.Dockerfile`. Record pinned versions in `plans/001-env-setup.md` Important Findings.
1. **Understand** — Read AGENTS.md, the BLUEPRINT.md section for the current SM, the relevant AGF:: sections in AGENTS-full.md, and any prior plan files mentioned in Cold Start.
2. **Plan** — Write `plans/{N}-{slug}.md` with all 11 mandatory sections + `# Important Findings`.
3. **Implement** — Execute plan steps in order. Append discoveries to Important Findings as they happen.
4. **Persona-Switch Review** — Switch to Reviewer Persona, then Critic Persona (see below).
5. **Verify** — Run the quality gate. Fix any issues. Re-run until clean.
6. **Update** — Update STATE.md (tick the SM checkbox, advance `current_step`, update `last_git_sha`), commit, push. For feature work, also update FEATURES.md audit status.

## Persona-Switch Review

After every significant code change, perform TWO persona switches:

**Reviewer Persona**: Pretend you are seeing this code for the first time.
- Check every changed line against Critical Invariants.
- Verify pattern conformance (module boundaries, error handling, scanner contract).
- Run `pnpm typecheck && pnpm lint && pnpm test`.
- Confirm governance file cross-references still match (BLUEPRINT phase ↔ STATE SM ↔ FEATURES entry ↔ TESTS coverage).

**Critic Persona (10th Man)**: For critical changes, switch to adversarial mindset:
- "What if this scanner crashes mid-scan — does the pipeline continue cleanly?"
- "What if the governor returns malformed JSON — do we fall back correctly?"
- "Can a malicious finding string cause command injection when passed to the next scanner?"
- "Is fingerprint still deterministic after this change?"
- If ANY doubt, fix before proceeding.

## 10th Man Protocol (Mandatory Adversarial Review)

Activate the Critic Persona unconditionally for:

- Any change under `src/governor/`
- Any change to `src/execution/docker.executor.ts`
- Any change to `src/correlation/fingerprint.ts` or `correlation.service.ts`
- Any change that adds a new scanner
- Any change to Prisma schema
- Any change touching 3+ files in `src/pipeline/`
- Any change to `sentinel` bash bootstrap script

## Plans Workflow

For ANY feature or mid-size change, BEFORE writing code:

1. Find next plan number: check `plans/` directory, increment highest number.
2. Create `plans/{NNN}-{slug}.md` with ALL 11 mandatory sections (see BLUEPRINT.md Plan File Template).
3. Header: Created date, Status (IN_PROGRESS), Status Mark, Git SHA, Depends on.
4. Cold Start: files to read, current state, last action, expected end state.
5. Steps: each with Action verb title + File path (mark new files) + Detail (with code snippets) + Constraint.
6. Execute plan steps immediately — do NOT wait for human input between steps.
7. Append discoveries to `# Important Findings` as you work.
8. After execution: quality gate → commit → push → update STATE.md.

Plan files are the source of truth. After context compaction: re-read the plan, especially `# Important Findings`.

## Context Recovery Protocol

At each SM boundary (or after context compaction):

1. Read STATE.md → get `current_phase`, `current_step`, `last_git_sha`, `current_plan_file`.
2. Verify: `git log --oneline -1` matches `last_git_sha`.
3. Read the current plan file, especially `# Important Findings`.
4. Re-read BLUEPRINT.md for the current phase.
5. Read AGENTS-full.md sections referenced by the plan's Cold Start (via `AGF::` tokens).
6. Read the source files listed in the plan.
7. Resume execution from the last completed step.

## Git Protocol

- One commit per SM: `[SM-{N}] {module}: {imperative description}`.
- NEVER commit: `.env`, `data/`, `workspaces/`, `node_modules/`, `dist/`, `.claude-session.md`, SQLite files, scanner output fixtures that contain real CVE data from customer repos.
- After every commit: `git push`.
- Pre-commit check: no API keys, no secrets, no `.env` files staged. Use `git status` before every `git add`.
- `.gitignore` must exclude: `node_modules/`, `dist/`, `data/`, `workspaces/`, `.claude-session.md`, `.env`, `*.db`, `coverage/`.

## Post-Build Protocol (Phases T + U)

After all build phases complete, execute this loop without user approval:

1. Read TESTS.md for the full test plan.
2. Write all tests (unit, integration, e2e). Run them. Fix failures.
3. Run code audit (correctness, edge cases, resource cleanup, timeout handling). Write findings to `audits/` folder.
4. Run full pipeline test: every scanner path, every governor decision type, every error path, every output format (markdown/JSON/PDF).
5. Create fix plans in `plans/` folder for each finding.
6. Execute fix plans. No user approval needed between steps.
7. Re-audit. Repeat steps 3–6 until zero new findings (max 5 rounds).
8. Write final audit report to `audits/final-report.md`.
9. Update STATE.md to reflect audit completion.

## Reports Protocol

All audits and test results produce formal reports in `audits/`:

- File naming: `audits/REPORT-{ASPECT}-{YYYY-MM-DD}.md` (e.g., `REPORT-SECURITY-2026-04-20.md`).
- Each report contains: findings table (issue, severity, file, status), summary statistics, fix plan references.
- Reports accumulate — each re-audit creates a new dated file. Never overwrite previous reports.
- After Phase U: `audits/` should contain at least one report per audit aspect with zero open issues.

## Naming Conventions

- **Files**: kebab-case (`trivy.scanner.ts`, `phase-1-static.ts`, `governor.prompts.ts`).
- **Scanner files**: `<tool>.scanner.ts` inside `src/scanner/scanners/`.
- **Phase files**: `phase-<N>-<slug>.ts` inside `src/pipeline/phases/`.
- **Classes**: PascalCase (`TrivyScanner`, `DockerExecutor`, `CorrelationService`).
- **Functions/methods**: camelCase (`executeScanner`, `fingerprintFinding`, `normalizeSeverity`).
- **Constants**: UPPER_SNAKE_CASE (`MAX_SCANNER_TIMEOUT_MS`, `DEFAULT_SEVERITY_FLOOR`).
- **Environment variables**: UPPER_SNAKE_CASE with `SENTINEL_` prefix where applicable (`SENTINEL_GOVERNOR_CLI`, `REDIS_URL`, `DATABASE_URL`).
- **Database tables**: PascalCase matching Prisma model names (`Scan`, `Finding`, `GovernorDecision`).
- **Prisma fields**: camelCase (`scanId`, `fingerprint`, `governorAction`).
- **Interfaces**: PascalCase, no `I` prefix (`NormalizedFinding`, `ScannerResult`, `ScanContext`).
- **Abstract classes**: PascalCase with semantic name (`BaseScanner`, not `AbstractScanner`).

## Anti-Patterns (NEVER)

- NEVER interpolate scanner output into a shell command, SQL query, or system prompt.
- NEVER use `any` except at raw-output parser boundary, and even there it must be narrowed within 5 lines via Zod or type guard.
- NEVER import one scanner from another (`trivy.scanner.ts` importing `semgrep.scanner.ts` is a bug).
- NEVER spawn a subprocess from `src/governor/*` — the governor reads and decides only.
- NEVER let the governor see raw `.env` file contents, secret values, or scanner stderr. Only normalized findings.
- NEVER log secret values. Log the fingerprint.
- NEVER write to `workspaces/<scanId>/` from outside the owning scan. No cross-scan writes.
- NEVER block the pipeline on a scanner failure. Record the failure, continue.
- NEVER retry a scanner more than once by default. Retries hide real problems.
- NEVER call `prisma.finding.findUnique(id)` — always `findUnique({ where: { scanId_fingerprint: ... } })` or scoped query.
- NEVER hardcode a scanner image tag. Read from `SCANNER_IMAGE` env var.
- NEVER silence a test failure. Fix the code.
- NEVER use `eslint-disable` without a one-line justification comment.
- NEVER commit generated files (`dist/`, `prisma/generated/`, `workspaces/`).

## Autonomous Operation

1. Never stop mid-flow to ask about prerequisites. Batch all manual requirements.
2. Do all autonomous work first — write code, create files, install packages, run builds.
3. One manual checklist at Phase 0 — present exactly ONE list of things the human must do (install Docker, set Redis URL, etc.).
4. Resume after manual steps — verify with `./sentinel doctor` and continue.

## Essential Commands

```bash
pnpm install                              # install dependencies
pnpm build                                # compile TypeScript (tsc -b)
pnpm typecheck                            # tsc --noEmit (strict mode)
pnpm lint                                 # eslint with zero warnings
pnpm test                                 # vitest unit + integration
pnpm test:e2e                             # end-to-end scanner tests (slow)
pnpm test --coverage                      # with v8 coverage
pnpm prisma:generate                      # regenerate Prisma client
pnpm prisma:migrate:dev --name <name>     # create migration
pnpm prisma:migrate:deploy                # apply migrations (CI/runtime)
docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .
./sentinel doctor                         # check toolchain readiness
./sentinel start --repo <path>            # run mechanical scan
./sentinel start --repo <path> --url <u>  # mechanical scan with URL
./sentinel start --repo <path> --governed # governed scan
./sentinel history                        # past scans
./sentinel report <scan-id>               # render a saved report
./sentinel clean --yes                    # remove all state
```

### Quality Thresholds

- Line coverage: ≥ 80% overall, ≥ 95% for `src/correlation/`, `src/governor/`, `src/execution/`.
- Zero `@ts-ignore` / `@ts-expect-error` without justification.
- Zero `any` escape hatches without a one-line justification on the same line.
- All new modules have at minimum: success test, failure test (crash / timeout), edge-case test (empty / malformed output).

## Project Identity

**Name**: Sentinel
**Repository**: https://github.com/keeganthewhi/sentinel (private)
**Description**: Unified Application Security Testing Platform — a self-hosted, open-source security scanning orchestrator that chains seven specialized security tools into a single unified pipeline with an optional AI governor layer.
**Stack**: NestJS 11 + BullMQ + Redis 7 + SQLite (default) / PostgreSQL 16 (full mode) + Prisma 5 + Commander.js + pino + pdfmake + Docker
**Scanner Upstreams**:
- Trivy — https://github.com/aquasecurity/trivy
- Semgrep — https://github.com/semgrep/semgrep
- TruffleHog — https://github.com/trufflesecurity/trufflehog
- Subfinder — https://github.com/projectdiscovery/subfinder
- httpx — https://github.com/projectdiscovery/httpx
- Nuclei — https://github.com/projectdiscovery/nuclei (+ templates: https://github.com/projectdiscovery/nuclei-templates)
- Schemathesis — https://github.com/schemathesis/schemathesis
- Nmap — https://github.com/nmap/nmap
- Shannon (fork, used by Sentinel) — https://github.com/keeganthewhi/shannon-noapi
- Shannon (upstream) — https://github.com/KeygraphHQ/shannon

## Dependency Management

- Monthly: Run `pnpm audit` and fix all known vulnerabilities.
- Quarterly: Review and update major dependency versions.
- Before adding any new dependency: check bundle size impact, license compatibility, maintenance status (last commit, open issues).
- Scanner tool versions pinned in `docker/scanner.Dockerfile`. Bumping a scanner requires a new migration + baseline test run + manual regression check.
- `pnpm-lock.yaml` must be committed — never `.gitignore` the lock file.

## Performance Budget

- Phase 1 (5 scanners, parallel): ≤ 3 minutes on a 500-file NestJS repo.
- Phase 2 (3 scanners, parallel): ≤ 5 minutes on a single staging host with 11 endpoints.
- Phase 3 (Shannon): ≤ 30 minutes per escalated target.
- Phase 4 (correlation + mechanical report): ≤ 10 seconds.
- Governor queries: 5-minute hard timeout, 90-second soft target.
- Memory peak: ≤ 2 GB for a 500-file repo scan.

These become test assertions in Phase T5 and audit checks in Phase U.

## Backup & Recovery Protocol

- **Database backup**: SQLite in lite mode — `cp data/sentinel.db data/sentinel.db.bak` before destructive migrations. PostgreSQL in full mode — rely on the host's backup strategy.
- **Retention**: Local developer machine — keep last 5 scans. CI — keep none.
- **Storage**: No external backup by default. Users opt in via `sentinel.yaml`.
- **Workspaces**: `workspaces/<scanId>/` directories are disposable. `./sentinel clean` removes them.

## Secret Rotation Readiness

- Secrets loaded from environment variables at startup — never hardcoded, never cached in module scope.
- Governor CLI authentication is handled by the CLI itself (Claude Code login, Codex token, Gemini key). Sentinel never touches those credentials.
- NEVER log, print, or return secrets in error messages or output.
- TruffleHog findings: log the fingerprint, the file path, the line number — NEVER the secret value.

## Governor Runtime Files (Hand-Off to Product)

Sentinel ships with static governor files at `governor-templates/`. At scan time, `src/governor/plan-generator.ts` copies them into `workspaces/<scanId>/`:

| File | Purpose |
|------|---------|
| `governor-templates/CLAUDE.md` | Runtime governor behavioral contract — the rules the AI follows during a scan |
| `governor-templates/AGENTS.md` | Scanner capability definitions the governor reads to know what tools are available |
| `governor-templates/BLUEPRINT.example.md` | Canonical format the governor must emit in `workspaces/<scanId>/BLUEPRINT.md` |
| `governor-templates/STATE.example.md` | Canonical format for per-scan live state updates |

When editing any file in `governor-templates/`, re-run the governor snapshot test in Phase T — changes to the contract are product-facing and must not break deployed scans.

## Related Governance Files

| File | When to read | Purpose |
|------|-------------|---------|
| `AGENTS.md` | Every session start | Domain knowledge, module boundaries, decision trees |
| `AGENTS-full.md` | Before implementing a specific module/entity/scanner | Deep reference — search by `AGF::` tokens |
| `BLUEPRINT.md` | Before every SM | Phased build plan with acceptance criteria |
| `STATE.md` | Before and after every SM | Progress tracker with YAML frontmatter + SM checkboxes |
| `FEATURES.md` | During feature work and post-build audit | Feature registry with priority and audit status |
| `TESTS.md` | Before writing tests or during Phase T | Test plan, pyramid, fixtures, test-audit-fix loop |
| `THREATS.md` | Before Phase H and during Phase U | STRIDE threat model for Sentinel itself |
| `MANIFEST.json` | When adding dependencies | Machine-readable project metadata |
| `docs/adr/README.md` | When questioning an architectural decision | ADRs with context + consequences |
| `governor-templates/*` | When implementing Phase H | Runtime governor contract and example artifacts |

## File Budget Enforcement

| File | Budget | Access |
|------|--------|--------|
| CLAUDE.md | ~40,000 chars | Auto-loaded every session |
| AGENTS.md | ~25,000 chars | Auto-loaded every session |
| AGENTS-full.md | Warn at 2MB | Token-access only (seek via `AGF::` markers) |
| BLUEPRINT.md | ~40,000 chars | Re-read per phase |
| STATE.md | No hard limit | Updated per SM |

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
