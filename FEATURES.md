# FEATURES.md — Sentinel

> Feature registry with priorities and implementation order. Read CLAUDE.md for rules, AGENTS.md for domain knowledge.
> Each feature cross-references its BLUEPRINT.md phase, TESTS.md test target, and AGF:: token in AGENTS-full.md.

---

## Feature Summary Table

| # | Feature | Priority | Status | Phase | Depends On |
|---|---------|----------|--------|-------|-----------|
| F01 | Mechanical pipeline backbone | P0 | PENDING | E | — |
| F02 | Bash bootstrap script (`./sentinel`) | P0 | PENDING | J | F01 |
| F03 | Scanner registry + BaseScanner contract | P0 | PENDING | B | — |
| F04 | Docker executor with timeout | P0 | PENDING | B | — |
| F05 | Trivy integration (SCA + secrets + IaC) | P0 | PENDING | C | F03, F04 |
| F06 | Semgrep integration (SAST) | P0 | PENDING | C | F03, F04 |
| F07 | TruffleHog integration (secret scanner) | P0 | PENDING | C | F03, F04 |
| F08 | Subfinder integration (subdomain discovery) | P0 | PENDING | C | F03, F04 |
| F09 | httpx integration (HTTP prober) | P0 | PENDING | C | F03, F04, F08 |
| F10 | Nuclei integration (template-based vuln) | P0 | PENDING | D | F09 |
| F11 | Nmap integration (port scan + service fingerprint) | P0 | PENDING | D | F03, F04 |
| F12 | Schemathesis integration (API fuzzer) | P1 | PENDING | D | F03, F04 |
| F13 | Mechanical correlation engine (fingerprint + dedup) | P0 | PENDING | F | F05–F12 |
| F14 | Severity normalizer | P0 | PENDING | F | F13 |
| F15 | Markdown report renderer | P0 | PENDING | F | F13, F14 |
| F16 | JSON report renderer | P0 | PENDING | F | F13, F14 |
| F17 | PDF report renderer | P1 | PENDING | F | F13, F14 |
| F18 | Terminal UI (real-time progress) | P0 | PENDING | E | F01 |
| F19 | SQLite persistence via Prisma | P0 | PENDING | G | — |
| F20 | Regression detection across scans | P0 | PENDING | G | F19 |
| F21 | CLI: `start` command | P0 | PENDING | J | F01..F20 |
| F22 | CLI: `history` command | P0 | PENDING | J | F19 |
| F23 | CLI: `report` command | P0 | PENDING | J | F15–F17 |
| F24 | CLI: `diff` command | P0 | PENDING | J | F19, F20 |
| F25 | CLI: `doctor` command | P0 | PENDING | J | F02 |
| F26 | CLI: `stop`/`clean` commands | P0 | PENDING | J | F02 |
| F27 | Governor agent adapter (Claude/Codex/Gemini CLI) | P1 | PENDING | H | — |
| F28 | Governor Decision 1: scan plan generator | P1 | PENDING | H | F27 |
| F29 | Governor Decision 2+3: phase evaluator | P1 | PENDING | H | F27 |
| F30 | Governor Decision 4: AI-authored report writer | P1 | PENDING | H | F27, F15 |
| F31 | Shannon integration (Phase 3 AI-DAST) | P2 | PENDING | I | F27 |
| F32 | Scanner Docker image (fat, multi-arch) | P0 | PENDING | K | F05–F12 |
| F33 | PostgreSQL full-mode support | P2 | PENDING | G | F19 |
| F34 | `sentinel.yaml` config file for auth + advanced options | P1 | PENDING | A | F25 |
| F35 | Regression diff in PDF format | P2 | PENDING | J | F17, F20, F24 |
| F36 | Verbose logging toggle (`--verbose`) | P1 | PENDING | J | F21 |
| F37 | Scan resume after crash | P1 | PENDING | E | F19 |
| F38 | Governor decision audit trail via `report --decisions` | P1 | PENDING | J | F30 |
| F39 | Governor mock for deterministic tests | P1 | PENDING | T | F27 |
| F40 | Multi-arch scanner image (amd64 + arm64) | P0 | PENDING | K | F32 |

**Status values**: `PENDING` → `IN_PROGRESS` → `BUILT` → `TESTED` → `AUDITED`

---

## P0 — Must Have

Core features that define the product. Mechanical pipeline + CLI must work without any of the P1/P2 features.

### F01 — Mechanical Pipeline Backbone

**Description**: BullMQ-orchestrated pipeline that runs scanners in phased order (Phase 1 parallel → barrier → Phase 2 parallel → barrier → Phase 3 optional → Phase 4 mechanical aggregation).

**User story**: "As a developer, I run `./sentinel start --repo /path` and the system scans my codebase with 5+ tools in parallel without me manually running each one."

**Acceptance criteria**:
- Phase 1 scanners run concurrently
- Per-scanner crash does not cancel the phase
- Phase 2 reads Phase 1 output via `ScanContext`
- Pipeline writes a terminal report without AI involvement

**BLUEPRINT Phase**: E
**TESTS target**: `test/integration/pipeline.test.ts`
**AGF**: `AGF::Pipeline`, `AGF::PhaseOneStatic`, `AGF::PhaseTwoInfra`

---

### F02 — Bash Bootstrap Script (`./sentinel`)

**Description**: Zero-config entry script that handles all prerequisites, container setup, database migration, and governor CLI detection before delegating to the NestJS CLI binary.

**User story**: "As a new user, I clone the repo, run `./sentinel start --repo /path`, and the system handles Node, Docker, Redis, scanner image, and DB setup automatically."

**Acceptance criteria**:
- Detects missing Node / Docker / pnpm with clear remediation
- Auto-starts Redis container
- Builds scanner image on first run
- Initializes Prisma database
- Works on macOS, Linux, and WSL2

**BLUEPRINT Phase**: J, SM-45
**TESTS target**: `test/e2e/bootstrap.sh`
**AGF**: `AGF::BootstrapScript`

---

### F03 — Scanner Registry + BaseScanner Contract

**Description**: In-memory registry of scanner implementations with a frozen abstract contract. Adding a scanner is additive and phase-scoped.

**Acceptance criteria**:
- `BaseScanner` cannot be instantiated directly
- Registry exposes `register/get/all/forPhase`
- Registering duplicate name throws
- Scanners never import each other

**BLUEPRINT Phase**: B, SM-10 to SM-14
**TESTS target**: `test/unit/scanner-registry.test.ts`
**AGF**: `AGF::BaseScanner`, `AGF::ScannerRegistry`

---

### F04 — Docker Executor with Timeout

**Description**: Subprocess runner that executes scanner tools inside the fat `sentinel-scanner` container. Enforces argv-array argument passing (no shell), timeouts via AbortController, and structured result handling.

**Acceptance criteria**:
- Arguments passed as argv array, never shell string
- Workspace mounted read-only
- Timeout enforced with AbortController
- Returns `{ exitCode, stdout, stderr, timedOut }` — never throws

**BLUEPRINT Phase**: B, SM-12
**TESTS target**: `test/unit/docker-executor.test.ts`
**AGF**: `AGF::DockerExecutor`

---

### F05 — Trivy Integration

**Description**: SCA + secret + IaC scanning via Trivy against the repo source.

**Acceptance criteria**:
- Parser handles `"Results": null` for empty repos
- Fixture test with known CVE returns ≥ 1 finding
- Three categories: dependency, secret, iac

**BLUEPRINT Phase**: C, SM-15
**TESTS target**: `test/unit/trivy.scanner.test.ts`
**AGF**: `AGF::TrivyScanner`

---

### F06 — Semgrep Integration

**Description**: SAST pattern matching with taint analysis for TypeScript, JavaScript, Python, and more.

**Acceptance criteria**:
- Default ruleset `p/default`, overridable via config
- Parser tolerant of Semgrep 1.x / 2.x schema drift
- Taint trace boosts severity

**BLUEPRINT Phase**: C, SM-16
**TESTS target**: `test/unit/semgrep.scanner.test.ts`
**AGF**: `AGF::SemgrepScanner`

---

### F07 — TruffleHog Integration

**Description**: Verified secret detection across git history with active verification.

**Acceptance criteria**:
- JSON lines parser skips blank lines
- Severity HIGH if `Verified == true`
- Raw field redacted before entering correlation

**BLUEPRINT Phase**: C, SM-17
**TESTS target**: `test/unit/trufflehog.scanner.test.ts`
**AGF**: `AGF::TruffleHogScanner`

---

### F08 — Subfinder Integration

**Description**: Passive subdomain enumeration for URL-based scans.

**Acceptance criteria**:
- Only runs when `context.targetUrl` is set
- Writes to `context.discoveredSubdomains`, not findings
- Passive only

**BLUEPRINT Phase**: C, SM-18
**TESTS target**: `test/unit/subfinder.scanner.test.ts`
**AGF**: `AGF::SubfinderScanner`

---

### F09 — httpx Integration

**Description**: Confirms live endpoints and detects technologies from discovered subdomains.

**Acceptance criteria**:
- Reads from `context.discoveredSubdomains`
- Writes to `context.discoveredEndpoints`
- Integration test against fixture HTTP server

**BLUEPRINT Phase**: C, SM-19
**TESTS target**: `test/integration/httpx.test.ts`
**AGF**: `AGF::HttpxScanner`

---

### F10 — Nuclei Integration

**Description**: Template-based vulnerability scanning on discovered endpoints.

**Acceptance criteria**:
- Respects rate limit from context
- Default templates: cves, misconfiguration, exposed-panels
- Progress stderr not treated as crash

**BLUEPRINT Phase**: D, SM-20
**TESTS target**: `test/unit/nuclei.scanner.test.ts`
**AGF**: `AGF::NucleiScanner`

---

### F11 — Nmap Integration

**Description**: Port scan and service fingerprinting on the target host.

**Acceptance criteria**:
- Default `--top-ports 1000`
- XML parser handles nmap output via fast-xml-parser
- Findings carry open ports in `endpoint` field

**BLUEPRINT Phase**: D, SM-22
**TESTS target**: `test/unit/nmap.scanner.test.ts`
**AGF**: `AGF::NmapScanner`

---

### F13 — Mechanical Correlation Engine

**Description**: Deterministic fingerprint + dedup across scanners. Merges findings that share a fingerprint into a primary record with duplicates cross-referenced.

**Acceptance criteria**:
- Fingerprint is deterministic across 1000 property-test iterations
- Trivy CVE + Semgrep taint on same issue → one primary finding citing both
- Order-independent: shuffling input produces same groups

**BLUEPRINT Phase**: F, SM-28 to SM-29
**TESTS target**: `test/unit/correlation.test.ts`, `test/property/fingerprint.test.ts`
**AGF**: `AGF::Fingerprint`, `AGF::CorrelationEngine`

---

### F14 — Severity Normalizer

**Description**: Mechanical rules that adjust severity based on evidence quality and reachability.

**Acceptance criteria**:
- Shannon exploit confirmed → floor HIGH
- Semgrep taint trace → boost one level
- Nuclei template-only match → reduce one level
- Dependency CVE without reachability → unchanged

**BLUEPRINT Phase**: F, SM-30
**TESTS target**: `test/unit/severity-normalizer.test.ts`
**AGF**: `AGF::SeverityNormalizer`

---

### F15–F17 — Report Renderers (Markdown, JSON, PDF)

**Description**: Three output formats for the final report. Every finding cites scanner name + file:line / CVE / endpoint.

**Acceptance criteria**:
- Markdown is valid GitHub-flavored markdown
- JSON is deterministic (sorted keys + sorted arrays)
- PDF opens in evince / macOS Preview without warnings, size ≤ 2 MB for 100-finding report

**BLUEPRINT Phase**: F, SM-31 to SM-32
**TESTS target**: `test/unit/markdown-renderer.test.ts`, `test/unit/json-renderer.test.ts`, `test/integration/pdf-renderer.test.ts`
**AGF**: `AGF::MarkdownRenderer`, `AGF::JsonRenderer`, `AGF::PdfRenderer`

---

### F18 — Terminal UI

**Description**: Real-time terminal display with spinners, phase headers, per-scanner status, and governor decision lines.

**Acceptance criteria**:
- Updates at most every 100 ms
- Survives terminal resize
- Governor lines rendered in cyan
- No cursor flicker

**BLUEPRINT Phase**: E, SM-27
**TESTS target**: `test/unit/terminal-ui.test.ts`
**AGF**: `AGF::TerminalUI`

---

### F19 — SQLite Persistence via Prisma

**Description**: Zero-config SQLite storage for scans, phase runs, findings, governor decisions, and reports.

**Acceptance criteria**:
- `./data/sentinel.db` auto-created on first run
- All multi-row writes inside transactions
- Schema compatible with PostgreSQL provider swap

**BLUEPRINT Phase**: G, SM-33 to SM-35
**TESTS target**: `test/integration/persistence.test.ts`
**AGF**: `AGF::DatabaseSchema`, `AGF::ScanRepository`, `AGF::FindingRepository`

---

### F20 — Regression Detection

**Description**: Compare current scan against the most recent completed scan for the same repo. Mark new findings as regressions.

**Acceptance criteria**:
- First-scan case returns empty regression set
- Handles disappeared findings (fixes)
- Efficient at 10K+ findings

**BLUEPRINT Phase**: G, SM-36
**TESTS target**: `test/integration/regression.test.ts`
**AGF**: `AGF::RegressionService`

---

### F21–F26 — CLI Commands

Commander-based CLI: `start`, `history`, `report`, `diff`, `doctor`, `stop`, `clean`.

**Acceptance criteria**:
- Every command has `--help` output
- Exit codes per CLAUDE.md
- `--json` output mode for scripting (where applicable)
- Idempotent: repeat invocations produce the same result

**BLUEPRINT Phase**: J, SM-44 to SM-48
**TESTS target**: `test/e2e/cli.test.ts`
**AGF**: `AGF::CLI`, `AGF::DoctorCommand`, `AGF::HistoryCommand`, `AGF::DiffCommand`

---

### F32 + F40 — Scanner Docker Image (Multi-arch)

**Description**: Single fat image containing Trivy, Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap. Multi-arch for amd64 + arm64.

**Acceptance criteria**:
- Every scanner binary on PATH inside the container
- Trivy pinned at v0.69.3
- Image builds in ≤ 10 minutes on first run
- Works on Apple Silicon and x86_64 Linux

**BLUEPRINT Phase**: K, SM-49 to SM-50
**TESTS target**: `test/e2e/docker-image.test.ts`
**AGF**: `AGF::ScannerDockerfile`

---

## P1 — Should Have

Important features that enable governed mode and advanced use cases. Ship-blocking for governed mode, optional for mechanical-only users.

### F12 — Schemathesis Integration

**Description**: Property-based API fuzzer that requires an OpenAPI spec.

**Acceptance criteria**:
- Skipped cleanly when spec absent
- JUnit XML parser extracts failures

**BLUEPRINT Phase**: D, SM-21
**TESTS target**: `test/unit/schemathesis.scanner.test.ts`
**AGF**: `AGF::SchemathesisScanner`

---

### F27 — Governor Agent Adapter

**Description**: Abstraction over Claude Code / Codex / Gemini CLI subprocess invocation.

**Acceptance criteria**:
- Selects CLI from `SENTINEL_GOVERNOR_CLI` env var
- 5-minute hard timeout
- Graceful fallback on any error

**BLUEPRINT Phase**: H, SM-37
**TESTS target**: `test/unit/agent-adapter.test.ts`
**AGF**: `AGF::AgentAdapter`

---

### F28–F30 — Governor Decisions 1, 2+3, 4

**Description**: The three governor decision points (scan plan, phase evaluation, report writer).

**Acceptance criteria**:
- Each decision persists a `GovernorDecision` row with full input + output
- Each falls back to mechanical defaults on error
- Report writer citations verifiable against real findings

**BLUEPRINT Phase**: H, SM-39 to SM-41
**TESTS target**: `test/integration/governor.test.ts`
**AGF**: `AGF::PlanGenerator`, `AGF::PhaseEvaluator`, `AGF::ReportWriter`

---

### F34 — `sentinel.yaml` Config File

**Description**: YAML config for authentication, scanner options, and other advanced settings not suitable as CLI flags.

**Acceptance criteria**:
- Merged with CLI flags via Zod schema
- CLI flags win on conflict
- Validation errors clearly point to the YAML field

**BLUEPRINT Phase**: A, SM-9
**TESTS target**: `test/unit/config.test.ts`
**AGF**: `AGF::ConfigSchema`

---

### F36 — Verbose Logging Toggle

**Description**: `--verbose` flag enables debug-level logs, raw scanner output, and governor prompt/response logs.

**Acceptance criteria**:
- Default: info level, no raw outputs
- `--verbose`: debug level + raw output paths
- Secrets still redacted even in verbose mode

**BLUEPRINT Phase**: J, SM-44
**TESTS target**: `test/unit/logger.test.ts`
**AGF**: `AGF::Logger`

---

### F37 — Scan Resume

**Description**: If the process crashes mid-scan, restart picks up at the next phase boundary by reading STATE.md.

**Acceptance criteria**:
- Killing the process mid-Phase-2 and restarting reuses Phase 1 results
- Mid-phase crashes restart the phase from the beginning
- Resume works in both mechanical and governed modes

**BLUEPRINT Phase**: E, SM-23
**TESTS target**: `test/e2e/resume.test.ts`
**AGF**: `AGF::Pipeline`

---

### F38 — Governor Decision Audit Trail

**Description**: `./sentinel report <id> --decisions` renders the full governor decision log alongside the report.

**Acceptance criteria**:
- Shows each decision's input summary + rationale
- Highlights decisions that overrode mechanical defaults
- Markdown and JSON output

**BLUEPRINT Phase**: J, SM-47
**TESTS target**: `test/integration/report-decisions.test.ts`
**AGF**: `AGF::DiffCommand` (shares rendering path)

---

### F39 — Governor Mock

**Description**: Deterministic mock adapter for tests.

**Acceptance criteria**:
- Implements `AgentAdapterInterface`
- Canned responses from test fixtures
- Supports latency and timeout simulation

**BLUEPRINT Phase**: T
**TESTS target**: Used by integration tests
**AGF**: `AGF::GovernorMock`

---

## P2 — Nice to Have

Enhancements for post-launch. Not required for v0.1.0 but valued by users.

### F31 — Shannon Integration (Phase 3)

**Description**: AI-powered exploitation runner as an optional Phase 3. Consumes governor escalations as priority targets.

**Acceptance criteria**:
- Runs only with `--shannon` flag AND at least one escalation
- Produces proof-of-concept exploits in findings
- Hard cap per target (default 30 min)

**BLUEPRINT Phase**: I, SM-42 to SM-43
**TESTS target**: `test/e2e/shannon.test.ts`
**AGF**: `AGF::ShannonScanner`

---

### F33 — PostgreSQL Full-Mode Support

**Description**: Drop-in PostgreSQL backend for teams / larger deployments.

**Acceptance criteria**:
- Only config change: `DATABASE_URL` points to a PostgreSQL instance
- `docker-compose.yml` full-mode profile includes Postgres + Redis
- Schema identical to SQLite provider

**BLUEPRINT Phase**: G, SM-34
**TESTS target**: `test/integration/postgres.test.ts`
**AGF**: `AGF::DatabaseSchema`

---

### F35 — Regression Diff in PDF

**Description**: PDF output for `./sentinel diff <id1> <id2>`.

**Acceptance criteria**:
- Color-coded new/fixed findings
- Includes governor decision deltas
- Max 5 MB size

**BLUEPRINT Phase**: J, SM-47
**TESTS target**: `test/integration/diff-pdf.test.ts`
**AGF**: `AGF::PdfRenderer`, `AGF::DiffCommand`

---

## P3 — Future / Roadmap

Not scoped for v0.1.0. Tracked here to prevent scope creep.

- **Web UI**: Explicitly out of scope for v1 (see "Do Not" section in the project spec).
- **Multi-tenancy**: Explicitly out of scope for v1.
- **Cloud API integrations** (Snyk, Semgrep Cloud): Explicitly out of scope.
- **Scan scheduling / cron**: Users run their own cron with `./sentinel start`.
- **Slack / email notifications**: Deferred — users can parse `--json` output.
- **Additional scanners** (Checkov, Bandit, gosec): Easy to add once F03 contract is stable.
- **SBOM generation**: Out of scope — Trivy SBOM output is available if users want it.
- **Custom rule packs for Semgrep/Nuclei**: Users provide their own via `scannerConfigs`.

---

## Entity Coverage Map

Every entity in AGF::DatabaseSchema maps to at least one feature in this file:

| Entity | Covered By |
|--------|-----------|
| Scan | F01, F19, F21 |
| PhaseRun | F01, F03, F19 |
| Finding | F05–F12, F13, F14, F19 |
| GovernorDecision | F27, F28, F29, F30, F38 |
| Report | F15, F16, F17, F23 |

---

## Feature-to-Test Traceability

| Feature | BLUEPRINT Phase | Test File | AGF Token |
|---------|----------------|-----------|-----------|
| F01 | E | `test/integration/pipeline.test.ts` | `AGF::Pipeline` |
| F03 | B | `test/unit/scanner-registry.test.ts` | `AGF::ScannerRegistry` |
| F04 | B | `test/unit/docker-executor.test.ts` | `AGF::DockerExecutor` |
| F05 | C | `test/unit/trivy.scanner.test.ts` | `AGF::TrivyScanner` |
| F06 | C | `test/unit/semgrep.scanner.test.ts` | `AGF::SemgrepScanner` |
| F07 | C | `test/unit/trufflehog.scanner.test.ts` | `AGF::TruffleHogScanner` |
| F08 | C | `test/unit/subfinder.scanner.test.ts` | `AGF::SubfinderScanner` |
| F09 | C | `test/integration/httpx.test.ts` | `AGF::HttpxScanner` |
| F10 | D | `test/unit/nuclei.scanner.test.ts` | `AGF::NucleiScanner` |
| F11 | D | `test/unit/nmap.scanner.test.ts` | `AGF::NmapScanner` |
| F12 | D | `test/unit/schemathesis.scanner.test.ts` | `AGF::SchemathesisScanner` |
| F13 | F | `test/unit/correlation.test.ts` | `AGF::CorrelationEngine` |
| F14 | F | `test/unit/severity-normalizer.test.ts` | `AGF::SeverityNormalizer` |
| F15 | F | `test/unit/markdown-renderer.test.ts` | `AGF::MarkdownRenderer` |
| F16 | F | `test/unit/json-renderer.test.ts` | `AGF::JsonRenderer` |
| F17 | F | `test/integration/pdf-renderer.test.ts` | `AGF::PdfRenderer` |
| F19 | G | `test/integration/persistence.test.ts` | `AGF::ScanRepository`, `AGF::FindingRepository` |
| F20 | G | `test/integration/regression.test.ts` | `AGF::RegressionService` |
| F27–F30 | H | `test/integration/governor.test.ts` | `AGF::AgentAdapter`, `AGF::PlanGenerator`, `AGF::PhaseEvaluator`, `AGF::ReportWriter` |
| F31 | I | `test/e2e/shannon.test.ts` | `AGF::ShannonScanner` |
| F21–F26 | J | `test/e2e/cli.test.ts` | `AGF::CLI` |
| F32, F40 | K | `test/e2e/docker-image.test.ts` | `AGF::ScannerDockerfile` |

---

## Related Governance Files

- **CLAUDE.md** — Behavioral contract, critical invariants.
- **AGENTS.md** — Domain model, module boundaries, decision trees.
- **AGENTS-full.md** — Deep reference (`AGF::` tokens).
- **BLUEPRINT.md** — Phased build plan with SMs.
- **STATE.md** — Build progress tracker.
- **TESTS.md** — Test pyramid and per-feature test plan.
- **THREATS.md** — STRIDE threat model.

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
