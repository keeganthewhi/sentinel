# TESTS.md — Sentinel

> Test plan, coverage targets, and the test-audit-fix loop protocol.
> Read CLAUDE.md first for rules. Read BLUEPRINT.md for build phases.
> This file defines what to test, how to test, and the iterative loop that runs after building.

---

## Test Strategy

**Test Framework**: vitest (unit + integration)
**E2E Tool**: vitest + real subprocess spawning + testcontainers (for Redis and Postgres in full mode)
**Coverage Target**: ≥ 80% overall, ≥ 95% for `src/correlation/`, `src/governor/`, `src/execution/`
**Property Testing**: fast-check for fingerprint determinism and correlation order-independence

## Test Pyramid

| Layer | Percentage | Scope | Speed |
|-------|-----------|-------|-------|
| Unit | 70% | Single function or class. Mock Docker, Prisma, BullMQ, agent CLI. | < 100 ms each |
| Integration | 20% | Module + real Redis + real SQLite + mocked DockerExecutor returning fixture stdout | < 2 s each |
| E2E | 10% | Full pipeline. Real Docker, real scanner binaries, golden fixture repo. | < 10 min per run |

## Module Test Plan

| Module / Feature | Unit Test | Integration Test | E2E Test | Status |
|------------------|-----------|------------------|----------|--------|
| `config/` | `test/unit/config.test.ts` | — | — | PENDING |
| `common/logger` | `test/unit/logger.test.ts` | — | — | PENDING |
| `common/errors` | `test/unit/errors.test.ts` | — | — | PENDING |
| `execution/docker.executor` | `test/unit/docker-executor.test.ts` | `test/integration/docker-executor.test.ts` | — | PENDING |
| `execution/output-parser` | `test/unit/output-parser.test.ts` | — | — | PENDING |
| `scanner/scanner.registry` | `test/unit/scanner-registry.test.ts` | — | — | PENDING |
| `scanner/scanners/trivy` | `test/unit/trivy.scanner.test.ts` | `test/integration/trivy.test.ts` | `test/e2e/trivy.test.ts` | PENDING |
| `scanner/scanners/semgrep` | `test/unit/semgrep.scanner.test.ts` | `test/integration/semgrep.test.ts` | `test/e2e/semgrep.test.ts` | PENDING |
| `scanner/scanners/trufflehog` | `test/unit/trufflehog.scanner.test.ts` | `test/integration/trufflehog.test.ts` | — | PENDING |
| `scanner/scanners/subfinder` | `test/unit/subfinder.scanner.test.ts` | — | `test/e2e/recon.test.ts` | PENDING |
| `scanner/scanners/httpx` | `test/unit/httpx.scanner.test.ts` | `test/integration/httpx.test.ts` | `test/e2e/recon.test.ts` | PENDING |
| `scanner/scanners/nuclei` | `test/unit/nuclei.scanner.test.ts` | `test/integration/nuclei.test.ts` | `test/e2e/nuclei.test.ts` | PENDING |
| `scanner/scanners/schemathesis` | `test/unit/schemathesis.scanner.test.ts` | `test/integration/schemathesis.test.ts` | — | PENDING |
| `scanner/scanners/nmap` | `test/unit/nmap.scanner.test.ts` | `test/integration/nmap.test.ts` | — | PENDING |
| `scanner/scanners/shannon` | `test/unit/shannon.scanner.test.ts` | — | `test/e2e/shannon.test.ts` | PENDING |
| `pipeline/pipeline.service` | `test/unit/pipeline-service.test.ts` | `test/integration/pipeline.test.ts` | `test/e2e/full-scan.test.ts` | PENDING |
| `pipeline/phases/phase-1-static` | — | `test/integration/phase-1.test.ts` | — | PENDING |
| `pipeline/phases/phase-2-infra` | — | `test/integration/phase-2.test.ts` | — | PENDING |
| `pipeline/phases/phase-3-exploit` | — | `test/integration/phase-3.test.ts` | `test/e2e/shannon.test.ts` | PENDING |
| `pipeline/workers/scanner.worker` | `test/unit/scanner-worker.test.ts` | `test/integration/worker.test.ts` | — | PENDING |
| `correlation/fingerprint` | `test/unit/fingerprint.test.ts` + `test/property/fingerprint.prop.test.ts` | — | — | PENDING |
| `correlation/correlation.service` | `test/unit/correlation.test.ts` + `test/property/correlation.prop.test.ts` | — | — | PENDING |
| `correlation/severity-normalizer` | `test/unit/severity-normalizer.test.ts` | — | — | PENDING |
| `report/renderers/markdown` | `test/unit/markdown-renderer.test.ts` | — | — | PENDING |
| `report/renderers/json` | `test/unit/json-renderer.test.ts` | — | — | PENDING |
| `report/renderers/pdf` | `test/unit/pdf-renderer.test.ts` | `test/integration/pdf-renderer.test.ts` | — | PENDING |
| `report/progress/terminal-ui` | `test/unit/terminal-ui.test.ts` | — | — | PENDING |
| `persistence/scan.repository` | `test/unit/scan-repository.test.ts` | `test/integration/persistence.test.ts` | — | PENDING |
| `persistence/finding.repository` | `test/unit/finding-repository.test.ts` | `test/integration/persistence.test.ts` | — | PENDING |
| `persistence/regression.service` | `test/unit/regression.test.ts` | `test/integration/regression.test.ts` | — | PENDING |
| `governor/agent-adapter` | `test/unit/agent-adapter.test.ts` | `test/integration/governor.test.ts` | — | PENDING |
| `governor/governor.prompts` | `test/unit/governor-prompts.test.ts` | — | — | PENDING |
| `governor/plan-generator` | `test/unit/plan-generator.test.ts` | `test/integration/plan-generator.test.ts` | — | PENDING |
| `governor/phase-evaluator` | `test/unit/phase-evaluator.test.ts` | `test/integration/phase-evaluator.test.ts` | — | PENDING |
| `governor/report-writer` | `test/unit/report-writer.test.ts` | `test/integration/report-writer.test.ts` | — | PENDING |
| `cli` (Commander entry) | — | — | `test/e2e/cli.test.ts` | PENDING |
| `sentinel` (bash bootstrap) | — | — | `test/e2e/bootstrap.sh` | PENDING |

**Status values**: `PENDING` → `WRITTEN` → `PASSING` → `AUDITED`

---

## Performance Test Baselines

| Metric | Target | Test Method |
|--------|--------|-------------|
| Phase 1 wall-clock (500-file NestJS repo) | ≤ 3 min | Fixture repo scan, 10-run median |
| Phase 2 wall-clock (1 host, 11 endpoints) | ≤ 5 min | Fixture HTTP server scan, 10-run median |
| Phase 3 wall-clock (per Shannon target) | ≤ 30 min | Recorded in plan file with target + elapsed |
| Phase 4 wall-clock (correlation + report) | ≤ 10 s | Benchmark with 500 findings |
| Memory peak (500-file repo) | ≤ 2 GB | `/usr/bin/time -v` or `ps` during run |
| Governor query latency (p95) | ≤ 90 s | 100 mock governor queries |
| Fingerprint determinism | 100% across 10 000 iterations | fast-check property test |
| Correlation order-independence | 100% across 1 000 shuffled inputs | fast-check property test |

## Test Data Strategy

**Approach**: Fixture-based with golden outputs.

Rules:

- Each test creates its own data. No shared state between tests.
- Fixture directories are read-only and version-controlled.
- Scanner output fixtures are captured from real tool runs and committed under `test/fixtures/scanners/<name>/output.json`.
- Expected `NormalizedFinding[]` snapshots committed next to outputs under `test/fixtures/scanners/<name>/expected.json`.
- E2E tests use `test/fixtures/repos/vulnerable-nestjs/` — a golden intentionally-vulnerable NestJS codebase with known CVEs.
- Mock HTTP server under `test/fixtures/targets/mock-server/` serves known-vulnerable endpoints for Nuclei / httpx / Nmap tests.
- Sensitive test data (tokens, passwords) uses fixed placeholders: `REDACTED_TEST_TOKEN`, `REDACTED_TEST_PASSWORD`. Never production secrets.
- Governor fixtures under `test/fixtures/governor/` cover: valid scan plan, valid evaluation, valid report, timeout, invalid JSON, missing fields.

### Fixture Directory Structure

```
test/
├── fixtures/
│   ├── scanners/
│   │   ├── trivy/
│   │   │   ├── output-vuln.json       # real Trivy output with known CVE
│   │   │   ├── output-empty.json      # empty repo edge case
│   │   │   └── expected.json          # expected NormalizedFinding[]
│   │   ├── semgrep/
│   │   ├── trufflehog/
│   │   ├── subfinder/
│   │   ├── httpx/
│   │   ├── nuclei/
│   │   ├── schemathesis/
│   │   ├── nmap/
│   │   └── shannon/
│   ├── repos/
│   │   ├── vulnerable-nestjs/          # golden fixture with known vulnerabilities
│   │   └── empty/                      # empty repo edge case
│   ├── targets/
│   │   └── mock-server/                # fixture HTTP server
│   └── governor/
│       ├── scan-plan-valid.json
│       ├── scan-plan-invalid.json
│       ├── evaluation-valid.json
│       ├── report-valid.md
│       └── timeout-simulate.json
├── unit/
├── integration/
├── e2e/
└── property/
```

## CI Integration

**Provider**: GitHub Actions (`.github/workflows/ci.yml`)

Test stages in CI pipeline:

```
1. Setup     — Node 22, pnpm 9, Docker Buildx (for scanner image)
2. Install   — pnpm install --frozen-lockfile
3. Typecheck — pnpm typecheck
4. Lint      — pnpm lint
5. Build     — pnpm build
6. Unit      — pnpm test:unit (parallel, no external deps)
7. Property  — pnpm test:property (fast-check determinism suites)
8. Integration — pnpm test:integration (testcontainers Redis + mocked Docker)
9. Build image — docker buildx build --platform linux/amd64,linux/arm64 -f docker/scanner.Dockerfile .
10. E2E      — pnpm test:e2e (real Docker + fixture repo + mock server)
11. Coverage — upload coverage artifact, fail if below threshold
```

All stages must pass before merge. No exceptions.

---

## Test-Audit-Fix Loop Protocol

This protocol runs after ALL build phases complete (Phase T in BLUEPRINT.md). Execute every step. No user approval needed between steps.

### Phase T1: Write Unit Tests

For each module, entity, and parser:

1. Create test file at the path listed in the Module Test Plan above.
2. Write tests for: happy path, scanner crash, scanner timeout, empty output, malformed output, edge cases (null fields, unicode, huge inputs).
3. Mock all external dependencies (Docker, Prisma, BullMQ, agent CLI).
4. Run `pnpm test:unit`. Fix failures. Repeat until all pass.
5. Verify coverage ≥ 80% overall and ≥ 95% on critical paths.

### Phase T2: Write Integration Tests

For each pipeline stage and persistence path:

1. Use real Redis via `testcontainers/redis`.
2. Use real SQLite file (`file::memory:?cache=shared` or tmp file).
3. Mock Docker executor to return fixture stdout for each scanner.
4. Test: full Phase 1 + Phase 2 + correlation + report — happy path.
5. Test: scanner crash in Phase 1 (2 of 5 fail) — pipeline still produces a report.
6. Test: governor timeout — fallback to mechanical path.
7. Test: resume after mid-Phase-2 crash.
8. Run `pnpm test:integration`. Fix failures. Repeat until all pass.

### Phase T3: Write E2E Tests

For the full happy paths with real scanners:

1. Build the scanner Docker image as a setup step.
2. Run against `test/fixtures/repos/vulnerable-nestjs/` and compare finding fingerprints to a recorded baseline.
3. Run against the mock HTTP server and compare Nuclei/httpx/Nmap results.
4. Run governed mode with `GovernorMock` — verify BLUEPRINT.md and STATE.md are written correctly.
5. Run the `sentinel` bash bootstrap from a fresh container to verify one-command UX.
6. Run `pnpm test:e2e`. Baseline changes require a plan file with justification.

### Phase T4: Code Quality Audit

1. Review all source files for correctness, edge cases, and error handling.
2. Verify no hardcoded paths, no secrets, no `console.log`, no `any` without justification.
3. Verify every scanner handles: tool missing / crash / timeout / empty output.
4. Verify fingerprint determinism across 10 000 property-test iterations.
5. Verify correlation order-independence across 1 000 shuffled inputs.
6. Check dependency licenses for compliance (no GPL unless specifically reviewed).
7. Write findings to `audits/code-quality-results.md`.

### Phase T5: Performance Tests

1. Run benchmarks against the baselines table above.
2. Profile memory usage during a 500-file repo scan.
3. Verify execution times are within acceptable bounds.
4. Check for resource leaks (open file handles, dangling child processes, BullMQ connections).
5. Write results to `audits/performance-test-results.md`.

### Phase T6: End-to-End Pipeline Test

Test the full pipeline from input to output:

1. Mechanical mode pipeline runs from clean state without errors.
2. Governed mode pipeline produces a BLUEPRINT.md, STATE.md, governor decisions, and AI-authored report.
3. Governed + Shannon produces exploit proofs for escalated findings.
4. Every report format (markdown, JSON, PDF) opens in its expected viewer.
5. Every CLI command exits with the correct code on success AND on every failure mode.
6. Regression diff between two scans correctly marks new and disappeared findings.
7. Write findings to `audits/pipeline-test-results.md`.

---

## Audit-Fix Loop (Phase U)

After all test phases pass, run this iterative loop:

### Round N (max 5 rounds)

1. Read every source file in the project.
2. For each file, check:
   a. Code compiles with no warnings.
   b. Has corresponding test file.
   c. Tests pass.
   d. Input validated at all boundaries (CLI, config, scanner output, governor response).
   e. Error handling covers all failure modes (crash, timeout, empty, malformed).
   f. No hardcoded secrets, no `console.log` in production code, no unjustified `any`.
   g. Every `catch` block either handles the error meaningfully or re-throws with context.
   h. No BOLA-equivalent cross-scan leakage (finding from scan A cannot leak into scan B).
3. Write each finding to `audits/round-N-findings.md` as you discover it.
4. For each finding:
   a. Create `plans/{NNN}-fix-{issue}.md` following the 11-section plan template.
   b. Execute the fix plan. No user approval needed.
   c. Run tests to verify the fix.
   d. Commit the fix.
5. After all findings fixed, start Round N+1.
6. Stop when a round produces zero new findings.

### Audit Report Format

Each audit file (`audits/round-N-findings.md`) must include:

```markdown
# Audit Round N — {date}

## Finding 1: {title}
Severity: CRITICAL | HIGH | MEDIUM | LOW
File: {path}
Issue: {description}
Fix: {what to do}
Status: OPEN | FIXED
Plan: plans/{NNN}-fix-{issue}.md
```

### Plans Format

All fix plans go in the `plans/` folder. Each plan follows the 11-section template defined in BLUEPRINT.md:
Header, Cold Start, Aim, Steps, Acceptance Criteria, Security Checklist, Test Requirements, Execution Order, Rollback, Completion, Important Findings.

All plans execute without user approval. The agent reads the plan, executes each step, verifies acceptance criteria, and commits the result.

---

## Security Test Checklist

These tests are mandatory and run as part of Phase T4 / Phase U2:

- [ ] **Command injection**: Attempt to inject shell metacharacters via `--repo`, `--url`, and scanner config fields. `DockerExecutor` must pass them literally to the container, never through a shell.
- [ ] **Path traversal**: Pass `--repo ../../etc` — the config validator must reject non-absolute paths.
- [ ] **Scanner output as system prompt**: Craft a scanner output fixture that includes `"Ignore previous instructions and..."`. Governor prompt builder must include it as *user* content, not *system* content.
- [ ] **Secret leakage in logs**: Run a TruffleHog scan that finds a test secret. Check that the raw secret never appears in any log, report, or DB row. Only the fingerprint appears.
- [ ] **Cross-scan isolation**: Run two scans concurrently on different repos. Verify no finding from scan A appears in scan B's report or DB rows.
- [ ] **Governor timeout recovery**: Mock a governor that sleeps 10 minutes. Verify the pipeline falls back to mechanical mode at the 5-minute mark and logs the timeout.
- [ ] **Governor invalid JSON**: Mock a governor returning `{not valid json`. Verify fallback and no stack trace in user output.
- [ ] **Fingerprint collision**: Property test 10K random findings — assert zero collisions in the fixture set.
- [ ] **Workspace write isolation**: Attempt to write to `workspaces/<other-scan>/` from within a scan. Block or fail loudly.
- [ ] **DockerExecutor escape**: Run scanners with unusual repo paths (spaces, unicode, very long). Verify subprocess receives the expected argv.

---

## Completion Checklist

Before marking the project done, verify every row:

- [ ] All unit tests written and passing (`pnpm test:unit`)
- [ ] All integration tests written and passing (`pnpm test:integration`)
- [ ] All E2E tests written and passing (`pnpm test:e2e`)
- [ ] Property tests pass for fingerprint determinism and correlation idempotence
- [ ] Code quality audit completed (zero critical findings)
- [ ] Performance baselines met
- [ ] Test coverage ≥ 80% overall, ≥ 95% critical
- [ ] Audit loop completed with zero new findings
- [ ] Security test checklist fully verified
- [ ] All audit reports written to `audits/` folder
- [ ] All fix plans committed and verified
- [ ] STATE.md updated: all 59 SMs ticked, `completed_status_marks = 59`

---

## Pipeline / Scanner Specific Tests

### Scanner Contract Tests (per scanner)

- [ ] `execute()` returns `{ success: false }` (never throws) on tool crash
- [ ] `execute()` returns `{ success: false, timedOut: true }` on timeout
- [ ] `execute()` returns `{ success: true, findings: [] }` on empty tool output
- [ ] `parseOutput()` is pure: same input → same output, no side effects
- [ ] `parseOutput()` rejects malformed input with a typed `ParseError`
- [ ] `isAvailable()` returns false when the tool binary is missing from the image
- [ ] Scanner registers exactly once with the registry
- [ ] Scanner handles unicode file paths
- [ ] Scanner handles paths with spaces
- [ ] Scanner does not leak absolute paths from the container into findings (strip `/workspace/` prefix)

### Pipeline Tests

- [ ] Phase 1 dispatches all enabled scanners in parallel
- [ ] Phase 2 waits for Phase 1 barrier before starting
- [ ] Mid-phase scanner crash does not cancel other scanners in the phase
- [ ] Pipeline resume from mid-Phase-2 crash: Phase 1 results preserved
- [ ] ScanContext mutations in Phase 1 (subdomains, endpoints) visible to Phase 2
- [ ] Phase 3 only runs when `--shannon` AND at least one escalation
- [ ] Terminal UI updates at least once per second during a phase

### Governor Tests

- [ ] Governor agent adapter times out at 5 minutes
- [ ] Governor returning `null` → mechanical fallback
- [ ] Governor returning `{}` (empty JSON) → validation error → mechanical fallback
- [ ] Governor response with extra fields → accepted (Zod passthrough)
- [ ] Governor escalations filtered to fingerprints present in actual findings (no hallucinations)
- [ ] Governor report citations verifiable against real file paths
- [ ] `GovernorMock` returns canned responses deterministically

### Correlation Tests

- [ ] Fingerprint is deterministic across 10 000 random inputs
- [ ] Correlation result is order-independent (shuffle input 1 000 times, same groups)
- [ ] Primary selection chooses Shannon > Semgrep > Trivy > Nuclei > others
- [ ] Duplicates carry `correlationId` pointing to the primary's `id`
- [ ] Severity normalizer applies floor before boost before reduce
- [ ] Governor severity adjustments override mechanical normalizer in governed mode

### Persistence Tests

- [ ] Multi-row writes wrapped in `prisma.$transaction()`
- [ ] `findUnique` never called with a raw client-supplied ID — always scoped by `scanId`
- [ ] Migration applies cleanly to empty SQLite
- [ ] Migration applies cleanly against PostgreSQL provider (manual integration test)
- [ ] Regression service returns empty set for first scan of a repo
- [ ] Regression service correctly identifies new findings between two scans
- [ ] Cascade delete: deleting a Scan removes all child rows

---

## Related Governance Files

- **CLAUDE.md** — Behavioral contract, critical invariants, quality gates.
- **AGENTS.md** — Domain model, business rules, module boundaries.
- **AGENTS-full.md** — Deep reference (`AGF::` tokens).
- **BLUEPRINT.md** — Full build plan with test phases T1–T6 and audit phases U1–U3.
- **FEATURES.md** — Feature registry with per-feature test hints.
- **STATE.md** — Build progress tracker.
- **THREATS.md** — STRIDE threat model — test items derive from here.

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
