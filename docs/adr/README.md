# Architecture Decision Records — Sentinel

> Index of key architectural decisions. Read CLAUDE.md for behavioral rules, AGENTS.md for the current architecture, and AGENTS-full.md for module-level details. ADRs capture the *why* so future agents understand the trade-offs.

---

## ADR Index

| Number | Title | Status | Date |
|--------|-------|--------|------|
| ADR-001 | Use NestJS over Fastify / Express for the CLI backend | Accepted | 2026-04-11 |
| ADR-002 | Use BullMQ + Redis over raw worker threads or queue-less orchestration | Accepted | 2026-04-11 |
| ADR-003 | Default to SQLite (lite mode) over PostgreSQL | Accepted | 2026-04-11 |
| ADR-004 | Ship a single fat scanner Docker image over per-tool images | Accepted | 2026-04-11 |
| ADR-005 | Abstract the governor CLI behind an adapter supporting Claude Code / Codex / Gemini | Accepted | 2026-04-11 |
| ADR-006 | Mechanical-first architecture — governor is optional, pipeline works without it | Accepted | 2026-04-11 |
| ADR-007 | Fingerprint-based mechanical dedup before any AI correlation | Accepted | 2026-04-11 |
| ADR-008 | Per-scan workspace isolation (`workspaces/<scanId>/`) | Accepted | 2026-04-11 |
| ADR-009 | Static governor contract shipped at `governor-templates/` and copied per-scan | Accepted | 2026-04-11 |
| ADR-010 | Pin scanner tool versions in the Dockerfile | Accepted | 2026-04-11 |
| ADR-011 | Structural prompt injection defense — `governor.prompts.ts` is the sole payload constructor | Accepted | 2026-04-11 |
| ADR-012 | Use the `shannon-noapi` fork instead of upstream Shannon | Accepted | 2026-04-11 |

---

## ADR-001: Use NestJS over Fastify / Express

### Context

Sentinel is a CLI tool, not a web service. The backend needs dependency injection, module boundaries, lifecycle hooks, and structured error handling. We considered Fastify (lightweight, fast), Express (minimal, wide ecosystem), and raw TypeScript modules.

### Options Considered

1. **NestJS 11**
   - Pros: First-class DI, module boundaries enforceable at the framework level, standard pattern for separating `scanner/` / `governor/` / `correlation/` etc., mature ecosystem, widely understood.
   - Cons: Heavier than Fastify; DI runtime cost; some boilerplate for a non-HTTP app.
2. **Fastify + custom DI**
   - Pros: Small, fast, familiar to many.
   - Cons: We'd build our own module system or adopt a third-party DI, increasing fragility.
3. **Express + custom DI**
   - Pros: Maximum familiarity.
   - Cons: Same DI problem; Express is in maintenance mode.
4. **No framework — plain TS**
   - Pros: Minimal.
   - Cons: No enforced boundaries; scanner modules could import each other by accident; tests harder to wire.

### Decision

**NestJS 11**. The module boundary enforcement is critical for keeping scanners as leaves and preventing the governor from spawning subprocesses. CLI-only usage doesn't negate the value of DI — quite the opposite, it makes scanner composition trivial.

### Consequences

- `+` Module boundaries encoded in `*.module.ts` files and DI graph.
- `+` Scanner registration via `ScannerModule` providers.
- `+` NestJS testing utilities (`Test.createTestingModule`) simplify integration tests.
- `-` NestJS expects HTTP patterns (controllers, pipes, guards); we use only the core DI + module bits.
- `-` Slightly heavier startup (~100 ms) — acceptable for a CLI that runs a 5-minute scan.

---

## ADR-002: Use BullMQ + Redis

### Context

Sentinel orchestrates 7+ scanners across 3 phases. We need parallelism within a phase, barrier synchronization between phases, and resumability after crashes.

### Options Considered

1. **BullMQ + Redis**
   - Pros: Mature, handles retries, persistence, concurrency limits, and resume. Well-understood ops model.
   - Cons: Requires Redis (additional dependency).
2. **Worker threads + Promise.all**
   - Pros: No Redis dependency.
   - Cons: No persistence → no resume after crash. No visibility into per-scanner status without reinventing it.
3. **p-queue (in-memory)**
   - Pros: Lightweight.
   - Cons: Same as worker threads — no resume.
4. **Custom lightweight queue**
   - Pros: No dependencies.
   - Cons: We'd reinvent BullMQ poorly.

### Decision

**BullMQ + Redis**. Redis is auto-started as a Docker container by the bootstrap script, so users never touch it. Resumability is a core requirement (a long-running governed scan that crashes mid-Phase-2 should not have to redo Phase 1).

### Consequences

- `+` Resume across crashes by reading STATE.md.
- `+` Per-scanner status visible in real-time via job events.
- `+` Future: scale scanners to a worker pool if needed (not for v0.1.0).
- `-` Redis container adds ~50 MB memory at rest.
- `-` `./sentinel doctor` must check Redis connectivity, `./sentinel stop` must stop the container cleanly.

---

## ADR-003: Default to SQLite (Lite Mode)

### Context

Teams will want PostgreSQL for shared scans. Individual developers won't want to set up Postgres for a local security scan.

### Options Considered

1. **SQLite default, PostgreSQL opt-in**
   - Pros: Zero-config for solo users. One command bootstrap. PostgreSQL swap via `DATABASE_URL`.
   - Cons: Prisma SQLite has some type limitations (JSON columns as strings).
2. **PostgreSQL only (in a container)**
   - Pros: Single code path. Full JSON support.
   - Cons: Heavy dependency for a solo developer; another container to manage.
3. **In-memory only**
   - Pros: Simplest.
   - Cons: No scan history, no regression detection.

### Decision

**SQLite default**. Scan history and regression detection are core features — in-memory is disqualified. Forcing Postgres on solo users contradicts the north-star UX ("one command, everything works"). Prisma's provider abstraction makes the swap trivial.

### Consequences

- `+` Zero-config for lite mode. `./sentinel start --repo ...` just works.
- `+` PostgreSQL swap is a single config change.
- `-` JSON columns are strings in SQLite — `GovernorDecision.inputJson/outputJson` parsed on read.
- `-` Concurrent writes are serialized at the SQLite level — acceptable for CLI usage.

---

## ADR-004: Single Fat Scanner Docker Image

### Context

Seven distinct scanner binaries need to be available during a scan. Options: one image per scanner, or one fat image with all of them.

### Options Considered

1. **Single fat image** (`sentinel-scanner:latest`)
   - Pros: One `docker pull`. Consistent environment. Shared base layer across scanners. Dockerfile is the single source of truth for tool versions.
   - Cons: Larger image (~2–3 GB). Rebuild on any scanner version bump.
2. **Per-scanner images**
   - Pros: Smaller individual images, independent updates.
   - Cons: 7+ images to pull, version, track. `./sentinel doctor` becomes a multi-image check. Cross-scanner consistency is harder to guarantee.
3. **No container — install scanners on host**
   - Pros: No Docker needed.
   - Cons: Contradicts the "zero-config" UX and introduces platform-specific install paths.

### Decision

**Single fat image**. The size trade-off is acceptable for a CLI tool that runs on developer machines with disk to spare, and the consistency benefit is significant — every version of Sentinel runs against a known-good set of tool versions.

### Consequences

- `+` `./sentinel doctor` checks one image instead of seven.
- `+` Tool versions pinned in one Dockerfile (ADR-010).
- `-` Image rebuilds on any tool upgrade (~5–10 min).
- `-` Disk: 2–3 GB per host. Acceptable.

---

## ADR-005: Governor CLI Adapter Abstraction

### Context

Users may have Claude Code, Codex, or Gemini installed. Sentinel should not lock users into a single vendor.

### Options Considered

1. **Adapter interface with three implementations**
   - Pros: Vendor-neutral. Easy to add new CLIs. Tests use a mock adapter.
   - Cons: Slight abstraction overhead.
2. **Claude-only**
   - Pros: Simplest.
   - Cons: Vendor lock-in.
3. **Direct API integration (no CLI)**
   - Pros: Faster startup per query.
   - Cons: Requires users to configure API keys; duplicates what the CLIs already do (auth, token rotation, rate limiting).

### Decision

**Adapter interface**. Users who already have Claude Code / Codex / Gemini installed can use Sentinel's governed mode with no additional setup. The bootstrap script detects the available CLI and exports `SENTINEL_GOVERNOR_CLI`.

### Consequences

- `+` Vendor-neutral.
- `+` Mock adapter for deterministic tests (see `AGF::GovernorMock`).
- `+` Users bring their own authentication.
- `-` Each adapter must handle CLI-specific quirks (ANSI stripping, prefix lines, prompt truncation limits).

---

## ADR-006: Mechanical-First Architecture

### Context

The governor is the brain on top. If the governor is required, Sentinel loses half its audience (anyone without an AI CLI subscription).

### Options Considered

1. **Mechanical pipeline must work without the governor. Governor is strictly optional.**
   - Pros: Works for everyone. Governor code is a feature, not a dependency. Users with strict data policies can run Sentinel mechanically.
   - Cons: More code paths (both mechanical and governed for every decision).
2. **Governor-first — everything flows through the AI.**
   - Pros: Simpler architecture.
   - Cons: Requires AI subscription for basic functionality. Unpredictable costs. Data policy concerns.
3. **Hybrid with shared dependencies**
   - Pros: Less duplication.
   - Cons: Accidental governor-required code paths creep in.

### Decision

**Mechanical-first**. The mechanical pipeline is the product's backbone. The governor is the brain on top. Every mechanical feature must work without the governor. This is enforced by CLAUDE.md Critical Invariant #2 and by not allowing `src/pipeline/`, `src/correlation/`, `src/report/`, `src/scanner/` to import from `src/governor/`.

### Consequences

- `+` Works for everyone out of the box.
- `+` Governor is a Phase H deliverable; Phases 0–G must complete first (enforced in BLUEPRINT.md).
- `+` Every governor decision has a mechanical fallback (CLAUDE.md Critical Invariant #7).
- `-` Some code duplication between mechanical correlation and governor correlation — acceptable.
- `-` Governor failures cannot abort the pipeline; we must handle every error path.

---

## ADR-007: Fingerprint-Based Mechanical Dedup Before AI Correlation

### Context

Scanners emit overlapping findings (Trivy + Semgrep on the same CVE). We need to dedup. The governor could do correlation semantically, but that's slow, expensive, and non-deterministic.

### Options Considered

1. **Mechanical dedup first, governor refines on top**
   - Pros: Deterministic baseline. Fast. Works without governor.
   - Cons: Mechanical dedup may miss semantic connections.
2. **Governor only**
   - Pros: Semantic understanding.
   - Cons: Slow (5-minute governor call for every phase result). Non-deterministic (AI output variance). Requires governor.
3. **No dedup**
   - Pros: Simplest.
   - Cons: 200 Nuclei template matches, 50 duplicate CVEs, unreadable report.

### Decision

**Mechanical dedup first**. Fingerprint is SHA-256 over canonical keys (CVE ID || file:line || endpoint+category). Deterministic. Fast. Correct for the vast majority of cross-scanner overlaps. The governor runs on top in governed mode to catch semantic connections the mechanical dedup missed.

### Consequences

- `+` Deterministic, testable output in mechanical mode.
- `+` Regression detection depends on fingerprint stability — this is testable via property tests.
- `+` Governor work is narrower: it refines, it doesn't replace mechanical dedup.
- `-` Fingerprint changes across versions would invalidate regression history. We lock the fingerprint algorithm in `AGF::Fingerprint` and any change requires a new MAJOR version.

---

## ADR-008: Per-Scan Workspace Isolation

### Context

Every scan produces per-scan state: scanner stdout files, governor BLUEPRINT.md, STATE.md, deliverables. Where does it go?

### Options Considered

1. **`workspaces/<scanId>/` directories, gitignored**
   - Pros: Clean separation. Easy to `rm -rf workspaces/<scanId>` on cleanup. No cross-scan writes possible.
   - Cons: Directories accumulate if `./sentinel clean` isn't run.
2. **Store everything in the database**
   - Pros: No filesystem side effects.
   - Cons: Large scanner outputs would bloat the DB; blob storage in SQLite is awkward.
3. **Temp dir per scan, deleted on completion**
   - Pros: No cruft.
   - Cons: Lose stdout for post-hoc debugging.

### Decision

**`workspaces/<scanId>/`**. Gitignored. Stores scanner stdout, deliverables (markdown / JSON / PDF reports), and governor-generated BLUEPRINT.md + STATE.md. DB references paths by relative location. `./sentinel clean` removes it.

### Consequences

- `+` Easy post-hoc debugging (inspect stdout for a specific scan).
- `+` Governor runtime files (BLUEPRINT.md, STATE.md) live with the scan they belong to.
- `+` Cross-scan isolation enforced at the filesystem level.
- `-` Users must run `./sentinel clean` periodically. Documented.

---

## ADR-009: Static Governor Contract Shipped at `governor-templates/`

### Context

The governor behavioral contract (rules about fabrication, citations, correlation) is static across all scans. The scanner definitions (what tools exist) are also static. Where do they live?

### Options Considered

1. **Ship at `governor-templates/` in the repo; copy into each scan workspace at runtime**
   - Pros: Single source of truth. Version-controlled. Reviewable via git diff. Accessible without running a scan. Each scan gets an immutable copy for audit.
   - Cons: Two locations to check (source + copied).
2. **Hardcode inside `governor.prompts.ts`**
   - Pros: Single location.
   - Cons: Reviewing the governor contract requires reading TypeScript. No git-diff-ability for contract changes specifically.
3. **Fetch from an external URL**
   - Pros: Central update.
   - Cons: Network dependency; offline scans break; contract version drift per scan.

### Decision

**`governor-templates/CLAUDE.md` and `governor-templates/AGENTS.md`** are the source of truth. `src/governor/plan-generator.ts` copies them verbatim into `workspaces/<scanId>/` at scan start. The governor receives the contract as a system-layer payload constructed by `governor.prompts.ts` reading from the templates.

### Consequences

- `+` Contract changes reviewable via `git diff`.
- `+` Each scan workspace has an immutable copy for audit.
- `+` Non-developers can read the contract without reading code.
- `-` `governor.prompts.ts` must read from disk at startup (acceptable).
- `-` Changes to `governor-templates/*` trigger a snapshot test regeneration.

---

## ADR-010: Pin Scanner Tool Versions in Dockerfile

### Context

Scanner tools release frequently. Breaking changes in output schema break our parsers. Trivy v0.70 changed severity field names (hypothetical example).

### Options Considered

1. **Pin in Dockerfile** (`trivy v0.69.3`)
   - Pros: Reproducible builds. Known-good schemas. Deliberate upgrades.
   - Cons: Miss new CVEs if we're slow to upgrade.
2. **Always latest**
   - Pros: Always current.
   - Cons: Silent schema breakage; parser bugs in production; no reproducibility.
3. **Weekly auto-bump via CI**
   - Pros: Automated freshness.
   - Cons: CI must also run the full fixture suite to detect breakages; complex.

### Decision

**Pin in Dockerfile** with explicit version strings. Bumping a scanner version is a dedicated plan file: update Dockerfile, rerun all fixture tests, accept any baseline changes with justification. Monthly review of pinned versions per CLAUDE.md dependency management.

### Consequences

- `+` Reproducible scanner behavior across all users on the same Sentinel version.
- `+` Parser stability guarantees.
- `-` Periodic upgrade work.
- `-` Users can't easily override to the latest — documented as a deliberate choice.

---

## ADR-011: Structural Prompt Injection Defense

### Context

Sentinel chains scanners with an AI governor. A malicious repo can craft scanner output containing prompt injections targeting the governor. This is the central novel security risk of the project.

See THREATS.md section T-T3 for the full threat.

### Options Considered

1. **Structural defense — `governor.prompts.ts` is the sole payload constructor; scanner output is user content only**
   - Pros: Architectural guarantee. No single line of code can accidentally interpolate scanner output into a system prompt. Enforced by ESLint custom rule. Testable.
   - Cons: Limits flexibility — any new governor feature must route through the one file.
2. **Content filtering of scanner output before feeding to the governor**
   - Pros: Simpler to add.
   - Cons: Filters are imperfect; attacker-driven evasion is easy; whac-a-mole.
3. **Trust the governor to recognize and ignore injections**
   - Pros: No code changes.
   - Cons: Delegates security to an LLM, which cannot be relied upon.

### Decision

**Structural defense**. `governor.prompts.ts` is the ONLY file that constructs governor payloads. The governor behavioral contract (from `governor-templates/CLAUDE.md`) is the ONLY system-layer content. Scanner findings enter as user content, never system layer. No string interpolation of scanner output into the system layer. Ever. Enforced by an ESLint custom rule that blocks `@anthropic-ai/sdk` or equivalent imports outside `governor.prompts.ts` and `agent-adapter.ts`.

See CLAUDE.md Critical Invariant #6 for the rule statement and AGENTS.md module boundaries for the architectural hint.

### Consequences

- `+` Prompt injection cannot succeed via scanner output alone — it can only affect the *user content* layer, which the governor is trained to treat as untrusted.
- `+` Testable via `test/integration/prompt-injection.test.ts`.
- `+` Future scanner additions inherit the defense automatically.
- `-` Any feature that needs to include scanner context in the system layer (e.g., "you are scanning a NestJS app") must go through the approved path: the scan plan (BLUEPRINT.md) which is built from typed, validated inputs, not raw scanner strings.

---

## ADR-012: Use `shannon-noapi` Fork Instead of Upstream Shannon

### Context

Shannon is the AI-powered DAST tool Sentinel invokes in Phase 3 (optional `--shannon` flag). Two sources exist:

- **Upstream**: https://github.com/KeygraphHQ/shannon — the original project, depends on a hosted API for its AI inference.
- **Fork**: https://github.com/keeganthewhi/shannon-noapi — removes the hosted-API dependency and runs via whichever governor CLI (Claude Code / Codex / Gemini) the user already has authenticated on their host.

Sentinel's north-star UX is "clone + one command, everything works." Users who have already authenticated a governor CLI on their host should not need a second paid subscription to use Shannon.

### Options Considered

1. **Upstream Shannon + user-provided API key**
   - Pros: Always in sync with upstream. No fork to maintain.
   - Cons: Second paid subscription required. Contradicts "everything works" promise. External API dependency — no offline operation.
2. **`shannon-noapi` fork**
   - Pros: Zero additional subscription if the user already has a governor CLI (which they need anyway for governed mode). Fully local operation. Consistent with `AgentAdapter` abstraction (ADR-005) — Shannon becomes "another consumer of the governor CLI."
   - Cons: Must track upstream for feature parity. Fork drift is a maintenance cost.
3. **Build an in-house Shannon equivalent**
   - Pros: Full control.
   - Cons: Enormous scope. Duplicates upstream work. Diverts focus from mechanical pipeline.

### Decision

**Use `shannon-noapi` fork.** The bootstrap script (`sentinel` bash script, SM-45) clones the fork to `tools/shannon-noapi/` on first run when `--shannon` is present. The Shannon scanner wrapper (SM-42) invokes the cloned code via the detected governor CLI.

### Consequences

- `+` No additional paid subscription required beyond the governor CLI the user already has.
- `+` Runs entirely locally; no external API calls; offline-capable.
- `+` Consistent with ADR-005 — Shannon becomes another consumer of the same `AgentAdapter` abstraction.
- `+` `tools/shannon-noapi/` is gitignored → no repo bloat.
- `-` Must periodically rebase the fork against upstream for feature parity.
- `-` Shannon bugs found by Sentinel users must be fixed in the fork first, then ideally upstreamed.
- `-` `./sentinel doctor` must verify `tools/shannon-noapi/` exists when `--shannon` is configured.

### References

- SM-42 (BLUEPRINT.md Phase I) — scanner wrapper implementation
- SM-45 (BLUEPRINT.md Phase J) — bootstrap script clone step
- `governor-templates/AGENTS.md` — runtime Shannon entry cites both upstream and fork

---

## Related Governance Files

- **CLAUDE.md** — Critical invariants derive from several ADRs (especially #6, #2, #7).
- **AGENTS.md** — Architecture reflects ADR-001, ADR-006, ADR-011.
- **AGENTS-full.md** — Module-level impact of each ADR.
- **THREATS.md** — ADR-011 is the mitigation for T-T3.
- **BLUEPRINT.md** — Phase order encodes ADR-006 (mechanical-first); SM-42 and SM-45 encode ADR-012.
- **MANIFEST.json** — Pinned scanner versions per ADR-010; `scannerSources.shannon` encodes ADR-012.

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
