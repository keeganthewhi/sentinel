# AGENTS.md — Sentinel

> Domain knowledge summary for AI agents working on this project.
> **Read CLAUDE.md first** — it contains the rules and invariants. This file provides domain context.
> For deep entity/module lookups, use AGENTS-full.md (search by `AGF::` tokens).

---

## Session Start

1. Read CLAUDE.md (rules and invariants).
2. Read this file (domain knowledge).
3. Check STATE.md for `current_phase` and `current_plan_file`.
4. Re-read the relevant section of BLUEPRINT.md for the current phase.
5. If a plan file is referenced in STATE.md → read it, especially `# Important Findings`.
6. Begin work on the current phase.

## Project Identity

**Name**: Sentinel
**Description**: Self-hosted, open-source security scanning orchestrator that chains seven specialized security tools into a single unified pipeline with an optional AI governor layer. Tools run mechanically via BullMQ. The governor watches results, makes four decisions (what to scan, what to escalate, what to discard, how to report), and writes architecturally-aware final reports.
**Archetype**: CLI tool with NestJS backend — no web UI for v1, no user auth, no multi-tenancy.
**Distribution**: Self-hosted, one-command bootstrap (`./sentinel start`).

## Stack Overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js 22+ | TypeScript strict mode |
| Framework | NestJS 11 | DI-driven modules |
| Queue | BullMQ | Redis 7 backing |
| Database (lite) | SQLite via Prisma 5 | Default mode, zero config |
| Database (full) | PostgreSQL 16 via Prisma 5 | `DATABASE_URL` switches provider |
| Container | Docker | Fat scanner image with all tools |
| CLI | Commander.js | `./sentinel` bash bootstrap → `dist/cli.js` |
| Logging | pino | Structured JSON, pretty in dev |
| Reporting | markdown + JSON + pdfmake | Three renderers, one report shape |
| Scanners | Trivy, Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap, Shannon | All inside the fat Docker image |
| AI Governor (optional) | Claude Code / Codex / Gemini CLI (subprocess) | Abstracted behind `AgentAdapter` |
| Package Manager | pnpm | Lockfile committed |

## Two Runtime Modes

### Lite Mode (Default, Zero Config Beyond Docker)

- Database: SQLite (`file:./data/sentinel.db`)
- Queue: BullMQ with auto-started Redis container (`sentinel-redis`)
- Scanners: Run inside the fat `sentinel-scanner:latest` image
- No `.env`, no config file. CLI flags only.
- Governor: disabled
- Report: template-based markdown with mechanical dedup

### Full Mode (Teams / Governed Scans)

- Database: PostgreSQL (external or via `docker-compose.yml`)
- Queue: Redis (external or compose-managed)
- Governor: enabled via `--governed` flag
- Report: AI-authored with architectural understanding
- Config file: `sentinel.yaml` for auth and advanced options

## Architecture: Two Layers

### Layer 1 — Mechanical Pipeline (always runs)

```
./sentinel start
     ▼
┌──────────────────────────────────────────────┐
│  Phase 1 (parallel via BullMQ)               │
│  Trivy · Semgrep · TruffleHog · Subfinder · httpx │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Phase 2 (parallel, needs Phase 1 context)   │
│  Nuclei · Schemathesis · Nmap                │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Phase 3 (optional, --shannon flag)          │
│  Shannon AI exploitation                     │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Phase 4: Mechanical aggregation             │
│  Fingerprint → dedup → render template report│
└──────────────────────────────────────────────┘
```

### Layer 2 — AI Governor (optional, `--governed` flag)

The governor sits above the mechanical pipeline. It does NOT run scanners. It watches output and makes four decisions:

1. **Decision 1 — What to scan** (before Phase 1). Reads repo file tree + `package.json` mechanically, writes `workspaces/<scanId>/BLUEPRINT.md`.
2. **Decision 2 — What to escalate** (after Phase 1 + Phase 2). Connects findings across tools. Example: Trivy CVE on `jsonwebtoken` + Semgrep taint to `jwt.verify()` → same issue, escalate to Shannon.
3. **Decision 3 — What to discard** (after Phase 1 + Phase 2). WordPress template hit on a NestJS app → discard. Exposed `.env` endpoint → keep.
4. **Decision 4 — How to report** (after all phases). AI-authored report with file:line citations and scanner evidence. Mechanical fallback on failure.

## Module Boundaries

```
src/
├── common/            # Cross-cutting only: logger, errors, utils
├── config/            # Zod schema + CLI/YAML/env merging
├── scanner/           # Scanner registry + contracts + per-tool implementations
├── execution/         # Docker executor + output parsers (JSON / JSONL / XML)
├── pipeline/          # BullMQ orchestration, phases, workers, terminal UI
├── correlation/       # Fingerprinting, dedup, severity normalization (mechanical)
├── report/            # Renderers (markdown, JSON, PDF) + report service
├── persistence/       # Prisma repositories + regression service
├── governor/          # OPTIONAL — agent adapter, prompts, plan-gen, evaluator, report-writer
└── cli.ts             # Commander entry (start, history, report, diff, doctor, stop, clean)
```

**NEVER**:

- Import one scanner from another (`trivy.scanner.ts` → `semgrep.scanner.ts` is a bug).
- Spawn a subprocess from `src/governor/*` (the governor reads, it does not execute).
- Write to `workspaces/<scanId>/` from outside the owning scan (cross-scan leakage).
- Log raw scanner stdout unless `--verbose` is set.
- Interpolate scanner output into a shell command or a governor system prompt.

Domain modules communicate through exported services via NestJS module imports. NO direct file imports across module boundaries.

### Feature Modules and Dependencies

- **ConfigModule** (standalone — parses CLI + YAML + env into a validated config)
- **ExecutionModule** → depends on ConfigModule (DockerExecutor needs image name from config)
- **ScannerModule** → depends on ExecutionModule (scanners run via DockerExecutor)
- **CorrelationModule** (standalone — operates on `NormalizedFinding[]`)
- **ReportModule** → depends on CorrelationModule
- **PersistenceModule** → depends on ConfigModule (for `DATABASE_URL`)
- **PipelineModule** → depends on ScannerModule + CorrelationModule + PersistenceModule + ReportModule
- **GovernorModule** (optional) → depends on ConfigModule + PersistenceModule. Does NOT depend on ScannerModule.
- **CliModule** → depends on PipelineModule + GovernorModule (optional) + PersistenceModule

### Import Rules

1. **No circular dependencies**: If Module A imports Module B, Module B MUST NOT import Module A. Shared concerns lift to `common/`.
2. **No deep imports**: Import from the module's `index.ts`, never from internal files of another module.
3. **No cross-scanner access**: Scanners live in `src/scanner/scanners/` as sibling leaves. Cross-scanner logic lives in `correlation/`.
4. **Governor is read-only**: `src/governor/*` may import types from everywhere but must never call `execute()` on a scanner or spawn a subprocess except via `AgentAdapter`.

## Domain Model

| Entity | Key Fields | Description |
|--------|-----------|-------------|
| Scan | id, status, targetRepo, targetUrl, governed, blueprintMd, startedAt, completedAt | Root aggregate for one scan run |
| PhaseRun | id, scanId, phase, scanner, status, startedAt, completedAt, findingCount, rawOutput, errorLog | One scanner execution inside a scan |
| Finding | id, scanId, fingerprint, title, severity, scanner, category, cveId, cweId, filePath, lineNumber, endpoint, evidence, exploitProof, remediation, isDuplicate, correlationId, isRegression, governorAction | Normalized finding after parsing |
| GovernorDecision | id, scanId, phase, decisionType, inputJson, outputJson, rationale | Auditable record of each governor decision |
| Report | id, scanId, markdownPath, jsonPath, pdfPath, summary, aiAuthored | Final report artifacts |

> Full entity details with all fields, types, constraints, and edge cases: see AGENTS-full.md (seek `AGF::Scan`, `AGF::Finding`, `AGF::PhaseRun`, `AGF::GovernorDecision`, `AGF::Report`).

### Relationships

- Scan → PhaseRun (one-to-many) [FK: `scanId`, cascade delete]
- Scan → Finding (one-to-many) [FK: `scanId`, cascade delete, unique `[scanId, fingerprint]`]
- Scan → GovernorDecision (one-to-many) [FK: `scanId`, cascade delete]
- Scan → Report (one-to-one) [FK: `scanId`, cascade delete]

## Business Rules

- **FingerprintDeterminism** [invariant]: `fingerprint(finding)` is deterministic across runs. Same inputs → same hash. Non-determinism invalidates dedup, correlation, and regression detection.
- **ScannerFailureIsolation** [invariant]: A crashed or timed-out scanner never crashes the pipeline. Failure is recorded as `PhaseRun.status = "FAILED"` with stderr captured.
- **MechanicalFallback** [invariant]: Any governor decision that times out, errors, or returns unparseable output reverts to its mechanical counterpart. The pipeline never blocks on the governor.
- **GovernorReadOnly** [invariant]: The governor never executes scanners. It reads `PhaseRun` / `Finding` / `ScanContext` and writes `GovernorDecision` / `workspaces/<scanId>/BLUEPRINT.md` / `workspaces/<scanId>/STATE.md`.
- **SeverityFloor** [business]: Shannon-confirmed exploit → severity floor HIGH. Governor-assigned severity overrides mechanical normalization in governed mode.
- **WorkspaceIsolation** [invariant]: Every scan owns `workspaces/<scanId>/`. No cross-scan writes. Repositories scope every query by `scanId`.
- **ScannerRegistryImmutability** [invariant]: Adding a scanner is additive only. Removing a scanner requires a deprecation window (one minor version announcing deprecation, then removal).
- **PromptInjectionStructural** [invariant]: Scanner output enters governor prompts as user content, never as system layers. `governor.prompts.ts` is the only file that constructs payloads.

## State Machines

### Scan.status

```
PENDING → RUNNING → { COMPLETED, FAILED, PARTIAL }
```

- `PENDING`: row created, pipeline not yet started.
- `RUNNING`: at least one `PhaseRun` active.
- `COMPLETED`: all phases COMPLETED, report written.
- `FAILED`: a hard failure (bootstrap, invariant violation).
- `PARTIAL`: some scanners FAILED but the pipeline produced a report (this is the common case for real scans).

### PhaseRun.status

```
PENDING → RUNNING → { COMPLETED, FAILED, TIMED_OUT, SKIPPED }
```

- `SKIPPED` is valid and distinct from `FAILED` — e.g., Schemathesis without an OpenAPI spec.

## Sensitive Fields (NEVER Expose)

| Entity | Field | Protection |
|--------|-------|------------|
| Finding | evidence (when TruffleHog) | Never in logs, never in console output unless `--verbose`, redact in JSON reports by default |
| Finding | exploitProof (when Shannon) | Only rendered in PDF report and only to the local user — never leaked via logs |
| Scan | targetUrl (when authenticated) | Auth headers / cookies stripped before any log or persisted field |
| GovernorDecision | inputJson | May contain repo file paths — acceptable in local DB, never logged |

Rules:

- Console output EXCLUDES full evidence by default (`--verbose` opts in).
- Log output REDACTS sensitive fields. Log the fingerprint instead.
- Error messages NEVER include sensitive field values.
- Test fixtures use placeholder secrets (`REDACTED_TEST_VALUE`).
- TruffleHog `Raw` field is normalized to `[REDACTED:<fingerprint>]` before the finding enters the correlation engine.

## Queue Overview

- **Type**: BullMQ on Redis 7
- **Queue name**: `sentinel-scans`
- **Job shape**: `{ scanId: string, phase: 1 | 2 | 3, scannerName: string, context: ScanContext }`
- **Concurrency**: Phase-level parallelism (all Phase 1 scanners concurrent, all Phase 2 scanners concurrent after Phase 1 drains).
- **Retries**: 0 by default. Scanner crashes record a failure and move on. Retrying hides real problems.
- **Resume**: If the process dies mid-Phase-2, restart reads STATE.md and picks up without re-running Phase 1. Phase boundaries are resume points.

## Deployment

- **Target**: CLI binary on local developer machine or VPS
- **Bootstrap**: `./sentinel` bash script handles prerequisite checks, Redis container, scanner image build, Prisma migrations
- **Distribution**: Git clone + one command — no npm publish for v1
- **Supported OS**: macOS (amd64, arm64), Linux (amd64, arm64). Windows via WSL2.
- **Not supported**: Native Windows, Alpine (Docker dependency).

## Decision Trees

### Adding a New Scanner

1. Confirm tool availability inside `docker/scanner.Dockerfile`. If missing, add to the Dockerfile and rebuild.
2. Create `src/scanner/scanners/<name>.scanner.ts` extending `BaseScanner`.
3. Implement `execute(ctx)` using `DockerExecutor`. Honour `ctx` timeouts and image name.
4. Implement `parseOutput(raw)` returning `NormalizedFinding[]`. Use typed parsers from `src/execution/output-parser.ts`.
5. Implement `isAvailable()` — verify the tool binary is present in the image.
6. Register in `src/scanner/scanner.registry.ts` (phase-1 or phase-2 group).
7. Add a fixture under `test/fixtures/scanners/<name>/` — real tool output and expected `NormalizedFinding[]`.
8. Write unit test for parser, integration test for execution, regression test for fingerprint stability.
9. Update BLUEPRINT.md (add to appropriate phase SMs), FEATURES.md (new P0/P1/P2/P3 entry), AGENTS-full.md (new `AGF::` section), MANIFEST.json dependencies if new npm package needed.
10. Update `governor-templates/AGENTS.md` with the scanner's capability so the governor sees it.

### Adding a New Governor Decision Type

1. Extend `src/governor/types/governor-decision.ts` with the new decision shape.
2. Add a new prompt builder in `src/governor/governor.prompts.ts`.
3. Add a new service method in `src/governor/governor.service.ts`.
4. Add the `decisionType` to the Prisma `GovernorDecision` enum (requires migration).
5. Call the new method at the appropriate pipeline point (before/after a phase).
6. Mechanical fallback: define what happens if the governor fails. Never block.
7. Test: valid response, timeout, invalid JSON, 5xx from CLI, empty response.
8. Update AGENTS-full.md `AGF::Governor` with the new decision.

### Modifying Prisma Schema

1. Edit `prisma/schema.prisma`.
2. Run `pnpm prisma:migrate:dev --name <descriptive-name>`.
3. Run `pnpm prisma:generate`.
4. If a column drops: add in step 1 as a first deploy (stop writing), deploy, then remove in a second migration.
5. Update `AGENTS-full.md` `AGF::DatabaseSchema` with the new fields.
6. Run `pnpm typecheck` — Prisma client changes propagate.
7. Update relevant repository in `src/persistence/`.
8. Add a migration test: apply migration on an empty DB and a populated DB.

### Adding a CLI Command

1. Add a new command in `src/cli.ts` via Commander.
2. Wire to an existing service or create a new lightweight service module.
3. Update BLUEPRINT.md Phase J (SM-44..48) with the new SM.
4. Update FEATURES.md with the new command as a feature entry.
5. Add README.md usage example.
6. E2E test: spawn `node dist/cli.js <command>` and verify exit code + stdout.

### Debugging a Failing Scanner

1. Reproduce locally: `./sentinel start --repo <fixture> --scanners <name> --verbose`.
2. Inspect `workspaces/<scanId>/deliverables/<name>.stdout` and `<name>.stderr`.
3. Run the scanner directly inside the container: `docker run --rm -v <repo>:/workspace sentinel-scanner:latest <tool> <args>`.
4. If the tool works inside the container but fails through Sentinel: check `DockerExecutor` arg escaping.
5. If the tool output parses but produces no findings: check the parser against the raw output in a unit test.
6. NEVER silence a failing scanner by removing it from the registry.

## Security Overview

- **Input Validation**: All CLI arguments parsed through Zod schema in `src/config/config.schema.ts`. Reject unknown flags.
- **Shell Safety**: Every `docker run` argument passed through spawn argv array, never shell string. Never `exec()`, always `spawn()`.
- **Scanner Output is Adversarial**: Parsers validate structure; content fields carried as opaque strings; no interpolation into shell/SQL/prompt.
- **Prompt Injection Defense**: Governor prompts built exclusively by `governor.prompts.ts`. Scanner strings enter as user-content only, never system layer.
- **Secret Redaction**: TruffleHog Raw → `[REDACTED:<fingerprint>]` before entering correlation.
- **Workspace Isolation**: `workspaces/<scanId>/` is the only writable scope per scan.
- **No Network During Build**: Scanner Docker image builds are reproducible; template updates happen at image build, not at runtime.

> Error contract: see CLAUDE.md (Error Contract section).

## Scanner Registry (Quick Reference)

See AGENTS-full.md `AGF::ScannerRegistry` for complete invocation details and `governor-templates/AGENTS.md` for the runtime governor view.

| Scanner | Phase | Requires URL | Category | Upstream |
|---------|-------|-------------|----------|----------|
| trivy | 1 | no | SCA + secret + IaC | https://github.com/aquasecurity/trivy |
| semgrep | 1 | no | SAST | https://github.com/semgrep/semgrep |
| trufflehog | 1 | no | Secret scanner (git history) | https://github.com/trufflesecurity/trufflehog |
| subfinder | 1 | yes | Subdomain discovery | https://github.com/projectdiscovery/subfinder |
| httpx | 1 | yes | HTTP prober | https://github.com/projectdiscovery/httpx |
| nuclei | 2 | yes | Vulnerability scanner (template-based) | https://github.com/projectdiscovery/nuclei (templates: https://github.com/projectdiscovery/nuclei-templates) |
| schemathesis | 2 | yes + OpenAPI spec | API fuzzer | https://github.com/schemathesis/schemathesis |
| nmap | 2 | yes | Port scanner | https://github.com/nmap/nmap |
| shannon | 3 | yes + governor CLI | AI-powered DAST | https://github.com/keeganthewhi/shannon-noapi (fork of https://github.com/KeygraphHQ/shannon) |

## Governor Adapter (Quick Reference)

See AGENTS-full.md `AGF::AgentAdapter` for full details.

- Interface: `query(prompt: string): Promise<string>`
- Implementations: `ClaudeCliAdapter`, `CodexCliAdapter`, `GeminiCliAdapter` — selected via `SENTINEL_GOVERNOR_CLI` env var (set by the `sentinel` bootstrap script)
- Timeout: 5 minutes hard, 90s soft target
- Fallback: any error → mechanical path, logged at WARN
- Prompts embed `governor-templates/CLAUDE.md` as system layer + typed inputs as user content

## File Budget

| File | Budget | Access |
|------|--------|--------|
| CLAUDE.md | ~40,000 chars | Auto-loaded every session |
| AGENTS.md | ~25,000 chars | Auto-loaded every session |
| AGENTS-full.md | Warn at 2MB | Token-access only (`AGF::` seek) |
| BLUEPRINT.md | ~40,000 chars | Re-read per phase |
| STATE.md | No hard limit | Updated per SM |
| FEATURES.md | No hard limit | Feature registry |
| TESTS.md | No hard limit | Test plan |
| THREATS.md | No hard limit | Threat model |
| governor-templates/CLAUDE.md | ~10,000 chars | Runtime system layer |
| governor-templates/AGENTS.md | ~10,000 chars | Runtime scanner definitions |

## Related Governance Files

- **CLAUDE.md** — Behavioral contract, critical invariants, plan mandate, quality gates.
- **AGENTS-full.md** — Deep entity/module reference (search `AGF::` tokens).
- **BLUEPRINT.md** — Full build plan with phased status marks (Phase 0 → U, 59 SMs).
- **STATE.md** — Build progress tracker with YAML frontmatter.
- **FEATURES.md** — Feature registry with priority and audit status.
- **TESTS.md** — Test plan and test-audit-fix loop protocol.
- **THREATS.md** — STRIDE threat model specific to a security scanner.
- **docs/adr/README.md** — Architecture Decision Records.
- **MANIFEST.json** — Machine-readable project metadata.
- **governor-templates/CLAUDE.md** — Runtime governor behavioral contract (copied into scan workspaces).
- **governor-templates/AGENTS.md** — Runtime scanner definitions (copied into scan workspaces).
- **governor-templates/BLUEPRINT.example.md** — Canonical per-scan plan format the governor must emit.
- **governor-templates/STATE.example.md** — Canonical per-scan live state format.

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
