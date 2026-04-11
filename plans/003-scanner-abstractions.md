# Plan 003 — Phase B Scanner Abstractions & Docker Executor

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-10 .. SM-14 (Phase B)
> **Git SHA (start)**: 3d6f5e6
> **Depends on**: SM-9 (Phase A complete)

## Cold Start

- **Read first**: CLAUDE.md invariants #3 (scanner failure is normal), #5 (scanner output is untrusted); AGENTS.md module boundaries; BLUEPRINT.md Phase B (SM-10..14); AGENTS-full.md `AGF::Finding` (line 152), `AGF::BaseScanner` (line 483), `AGF::ScannerRegistry` (line 531), `AGF::DockerExecutor` (line 552), `AGF::OutputParser` (line 596).
- **Current state**: NestJS scaffolding complete. `src/common/` and `src/config/` exist. No scanner code.
- **Expected end state**: Scanner contract frozen. `BaseScanner` abstract class defined. `ScannerRegistry` supports `register/get/all/forPhase`. `DockerExecutor` enforces timeouts via AbortController. `output-parser.ts` exposes Zod-backed JSON / JSONL parsers and a `fast-xml-parser`-backed XML parser. Phase C and D scanners can extend `BaseScanner` without re-architecting.

## Aim

Freeze the scanner abstraction layer so that every concrete scanner in Phases C–D is a drop-in leaf under `src/scanner/scanners/`. Build the `DockerExecutor` subprocess runner with argv-array safety and a strict timeout contract. Ship typed output parsers that reject malformed JSON/JSONL before the data ever touches correlation or persistence.

## Steps

### Step 1: Create NormalizedFinding + Severity types (SM-10)

- **File**: `src/scanner/types/finding.interface.ts` (NEW FILE)
- **Detail**: Export `Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'`, `FindingCategory = 'dependency' | 'secret' | 'iac' | 'sast' | 'network' | 'api' | 'dast' | 'misconfig' | 'other'`, and `NormalizedFinding` interface matching `AGF::Finding` (no DB columns — `id`, `scanId`, `correlationId`, `isRegression`, `governorAction`, `createdAt` belong to the persistence layer and are added in Phase G).
- **Constraint**: Do not conflate the in-memory finding shape with the Prisma row shape.

### Step 2: Create BaseScanner + ScanContext + ScannerResult (SM-11)

- **File**: `src/scanner/types/scanner.interface.ts` (NEW FILE)
- **Detail**: Export `ScanContext`, `ScannerResult`, `AuthConfig` (re-exported from `config`), and abstract class `BaseScanner` per `AGF::BaseScanner`. Add a `timeoutMs` getter on `BaseScanner` so subclasses can read the context timeout. `execute()` contract: MUST NOT throw on tool crash / timeout / empty output — return `{ success: false, ...}` instead. `parseOutput()` is pure.
- **Constraint**: `BaseScanner` is abstract — `new BaseScanner()` must be a compile-time AND runtime error.

### Step 3: Create scanner types barrel (SM-10/11)

- **File**: `src/scanner/types/index.ts` (NEW FILE)
- **Detail**: Re-export every public symbol from `finding.interface.ts` and `scanner.interface.ts`.

### Step 4: Create DockerExecutor (SM-12)

- **File**: `src/execution/docker.executor.ts` (NEW FILE)
- **Detail**: `@Injectable()` class. Method `run(options: DockerRunOptions): Promise<DockerRunResult>` uses `child_process.spawn('docker', [...])` with an argv array built from `options.image`, `options.workspaceRepo`, `options.command`. Captures stdout/stderr with `Buffer` accumulation. Enforces timeout via `AbortController` + `setTimeout` → `controller.abort()`. Returns `{ exitCode, stdout, stderr, durationMs, timedOut }`. Logs via child logger with `scanner` context.
- **Constraint**: NEVER construct a shell string. NEVER pass the scanner command as a single string. `spawn` argv array only. `--rm` + `-v <repo>:/workspace:ro` hardcoded. Exit code `null` (killed by signal) is treated as failure by callers.

### Step 5: Create OutputParser (SM-13)

- **File**: `src/execution/output-parser.ts` (NEW FILE)
- **Detail**: `parseJson<T>(raw, schema)` uses `JSON.parse` then Zod `safeParse`. `parseJsonLines<T>(raw, schema)` splits on `\n`, skips blank lines, validates each line, throws `ParseError` with line index on failure. `parseXml(raw)` uses `fast-xml-parser` configured with `attributeNamePrefix: ''`, `ignoreAttributes: false`, `parseTagValue: true`. Export `ParseError extends Error` with `line?: number`, `scanner?: string`.
- **Constraint**: Zod is the ONLY type gate. No `JSON.parse` result may escape without Zod validation. The `any` produced by `JSON.parse` is narrowed within 5 lines.

### Step 6: Create ScannerRegistry (SM-14)

- **File**: `src/scanner/scanner.registry.ts` (NEW FILE)
- **Detail**: `@Injectable()` class with an internal `Map<string, BaseScanner>`. Methods: `register(scanner)` (throws if name collision), `get(name)` (returns `BaseScanner | undefined`), `all()` (returns array, deterministic order = insertion order), `forPhase(phase: 1 | 2 | 3)` (filters by `scanner.phase`).
- **Constraint**: Registration order is insertion order — `all()` and `forPhase()` results must be stable across runs for deterministic reporting.

### Step 7: Create execution + scanner modules and barrels

- **File**: `src/execution/execution.module.ts`, `src/execution/index.ts`, `src/scanner/scanner.module.ts`, `src/scanner/index.ts` (all NEW FILES)
- **Detail**: NestJS modules exposing `DockerExecutor` (from ExecutionModule) and `ScannerRegistry` (from ScannerModule). ScannerModule depends on ExecutionModule. Barrels re-export the public surface.

### Step 8: Write tests

- **File**: `src/execution/output-parser.spec.ts`, `src/scanner/scanner.registry.spec.ts`, `src/execution/docker.executor.spec.ts` (all NEW FILES)
- **Detail**:
  - `output-parser.spec.ts`: parseJson valid/invalid, parseJsonLines valid/invalid-line (line index reported)/blank-lines-skipped/empty-input, parseXml nmap-like fixture.
  - `scanner.registry.spec.ts`: register twice throws, forPhase splits phases, all() preserves insertion order.
  - `docker.executor.spec.ts`: test the argv construction purity by exposing a `buildArgs` helper (extracted from `run()`) and unit-testing it — no real `docker` subprocess. A separate integration test (`.integration.spec.ts`) runs a real container; tagged but skipped when `CI` env var is absent (to avoid flakiness on dev machines). Timeout test uses a stubbed `spawn`.
- **Constraint**: Tests are deterministic and do not require Docker to be running.

### Step 9: Run quality gate + commit + push + STATE update

- **Detail**: `pnpm typecheck && pnpm lint && pnpm test`. Stage new files, commit `[SM-10..14] phase-b: scanner contracts + DockerExecutor + output parsers`, push, update STATE.md.

## Acceptance Criteria

- [ ] `BaseScanner` cannot be instantiated (compile + runtime error)
- [ ] `ScannerRegistry.register` rejects duplicate names
- [ ] `ScannerRegistry.forPhase(1).length` and `forPhase(2).length` both return 0 before any scanner registers
- [ ] `DockerExecutor.run` builds argv array (no shell strings) and returns `{ exitCode, stdout, stderr, durationMs, timedOut }`
- [ ] `parseJson` / `parseJsonLines` reject invalid input with a typed `ParseError` including a line index (for JSONL)
- [ ] `parseXml` returns an object with attributes flattened (no `@_` prefix)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` passes with 0 errors / 0 warnings
- [ ] STATE.md SMs 10..14 flipped; Phase B → COMPLETE

## Security Checklist

- [ ] `DockerExecutor` uses argv array only — no shell string interpolation
- [ ] `parseJson` / `parseJsonLines` use Zod at the boundary; `any` narrows within 5 lines
- [ ] No scanner output interpolated into any shell or SQL or governor prompt (N/A — no scanners or governor yet)
- [ ] No hardcoded paths, image names — `DockerRunOptions.image` is injected from `ConfigService.runtime.scannerImage`
- [ ] No secrets in error messages
- [ ] `ScannerRegistry` does not persist scanner output — it only owns the registry map
- [ ] Governor stays read-only — N/A (no governor)
- [ ] TruffleHog raw redaction — N/A (no scanner)

## Test Requirements

- [ ] Success: `parseJson` returns the typed object for a valid payload
- [ ] Failure: `parseJson` throws `ParseError` for malformed JSON
- [ ] Failure: `parseJson` throws `ParseError` when Zod validation fails
- [ ] Edge: `parseJsonLines` skips blank lines without throwing
- [ ] Failure: `parseJsonLines` reports the failing line index
- [ ] Success: `parseXml` parses a nmap-like fixture
- [ ] Success: `ScannerRegistry.register` + `.get` round-trip
- [ ] Failure: `ScannerRegistry.register` throws on duplicate name
- [ ] Success: `ScannerRegistry.forPhase(1)` filters to phase-1 scanners only
- [ ] Success: `DockerExecutor.buildArgs` produces the expected argv for a canonical options object
- [ ] Coverage: `src/execution/**` ≥ 80%, `src/scanner/**` ≥ 80%

## Execution Order

**Recommended**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
**Rationale**: Types first (foundation for everything else). DockerExecutor and OutputParser are independent leaves (either order works). Registry depends on types only. Modules wire it all together. Tests come last but before the quality gate.

## Rollback

1. `git revert HEAD`
2. `rm -rf src/scanner src/execution`
3. Un-tick STATE.md SMs 10..14, revert frontmatter to Phase A

## Completion

1. Quality gate passes
2. `git add src/scanner src/execution plans/003-scanner-abstractions.md package.json pnpm-lock.yaml`
3. Commit `[SM-10..14] phase-b: scanner contracts + DockerExecutor + output parsers`
4. Push
5. Update STATE.md → Phase B COMPLETE, current_phase=C, current_step=SM-15
6. Follow-up commit `[SM-10..14] phase-b: STATE bookkeeping`

# Important Findings

- [Step 4] **DockerExecutor extracted `buildDockerArgs` helper**: keeping the argv assembly as a pure exported function lets unit tests assert the full argv array without spawning a real `docker` subprocess. This matches the "tests must not require Docker to be running" constraint.
- [Step 4] **AbortController → child_process.spawn**: Node 22 accepts `{ signal }` directly on `spawn()`. No external `abort-controller` shim needed.
- [Step 4] **Exit code null means killed by signal** — documented in the class comment. Callers (Phase C scanners) MUST treat null as failure regardless of `timedOut`.
- [Step 5] **fast-xml-parser quirk**: `parseAttributeValue: true` auto-coerces numeric attribute strings to JS numbers. The nmap test initially expected `"7.94"` (string) but the parser returns `7.94` (number). Test updated; this coercion is desired for numeric port IDs (`portid: 22` not `"22"`), so keeping the option enabled.
- [Step 5] **ParseError.cause**: Node 18+ supports `Error.cause` natively via the constructor; assigned via a cast for stricter TS compatibility.
- [Step 6] **ScannerRegistry ordering**: Insertion order is preserved by ES2015+ `Map`. `all()` returns a new array each call to prevent mutation of internal state.
- [Step 8] **Lint round 1 fixes**:
  - `output-parser.ts`: `string.split()` returns `string[]`, never `(string | undefined)[]`. Changed `line === undefined` check to `lines[i] ?? ''` to avoid the "unnecessary conditional" rule.
  - `scanner.registry.spec.ts`: arrow functions wrapping `void` method calls need braces (`() => { registry.register(...); }`) to avoid `no-confusing-void-expression`.
- [Step 8] **Vitest run timings**: 46 tests, 6 files, ~1.7s total. Transform overhead dominates (~350ms).
