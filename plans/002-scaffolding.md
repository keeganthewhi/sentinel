# Plan 002 — Phase A Project Scaffolding

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-5 .. SM-9 (Phase A)
> **Git SHA (start)**: a49bb57
> **Depends on**: SM-4 (Phase 0 complete)

## Cold Start

- **Read these files first** (in order):
  1. `CLAUDE.md` — critical invariants, naming conventions, error contract
  2. `AGENTS.md` — module boundaries diagram (`src/` layout)
  3. `BLUEPRINT.md` — Phase A section (SM-5 through SM-9)
  4. `AGENTS-full.md` — `AGF::ConfigSchema` (line 401) and `AGF::Logger` (line 456)
  5. `plans/001-env-setup.md` — Phase 0 Important Findings (Windows corepack gotcha)
- **Current state**: Git repo on `main` at `a49bb57`, pushed to `https://github.com/keeganthewhi/sentinel`. Governance committed. No source code, no `package.json`, no `tsconfig.json`.
- **Last agent action**: Completed Phase 0 — host verified, repo initialized, GitHub remote created, governor CLIs (claude/codex/gemini) all present.
- **Expected state after this plan**: A buildable NestJS 11 project. `pnpm typecheck && pnpm lint && pnpm test` passes with 0 errors, 0 warnings. The quality gate command itself is now meaningful for the first time. Source tree contains `src/main.ts`, `src/app.module.ts`, `src/cli.ts`, `src/common/{logger,errors}.ts`, `src/config/{config.schema,config.service}.ts`. Initial test suite covers error classes and config schema.

## Aim

Stand up the NestJS 11 TypeScript project: `package.json` + strict `tsconfig.json`, runtime/dev dependencies installed, empty NestJS bootstrap (`main.ts` + `app.module.ts`), Commander CLI stub (`cli.ts`), pino logger with redaction rules per `AGF::Logger`, typed error classes per CLAUDE.md Error Contract, and a Zod config schema per `AGF::ConfigSchema` with CLI/YAML/env merging. Establish the quality gate baseline so every subsequent SM can enforce it.

## Steps

### Step 1: Create package.json (SM-5)

- **File**: `package.json` (NEW FILE)
- **Detail**: name `sentinel`, version `0.1.0`, license `MIT`, `type: "module"`, `packageManager: "pnpm@10.24.0"` (deviates from BLUEPRINT's `pnpm@9.x` — see Important Findings), scripts `typecheck`, `lint`, `test`, `test:watch`, `test:coverage`, `build`, `start`, `format`. Runtime deps: `@nestjs/common@^11`, `@nestjs/core@^11`, `@nestjs/config@^4`, `reflect-metadata@^0.2`, `rxjs@^7.8`, `pino@^9`, `pino-pretty@^11`, `zod@^3.23`, `commander@^12`, `js-yaml@^4`. Dev deps: `typescript@^5.6`, `@types/node@^22`, `@types/js-yaml@^4`, `tsx@^4`, `vitest@^2`, `@vitest/coverage-v8@^2`, `eslint@^9`, `@eslint/js@^9`, `typescript-eslint@^8`, `prettier@^3`, `eslint-config-prettier@^9`.
- **Constraint**: No hardcoded scanner versions. Lock file committed. `type: "module"` is required for ESM + NodeNext resolution.

### Step 2: Create tsconfig.json (SM-5)

- **File**: `tsconfig.json` (NEW FILE)
- **Detail**: `strict: true`, `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `esModuleInterop: true`, `skipLibCheck: true`, `outDir: dist`, `rootDir: src`, `experimentalDecorators: true`, `emitDecoratorMetadata: true` (required for NestJS DI), `forceConsistentCasingInFileNames: true`, `declaration: true`, `sourceMap: true`, `resolveJsonModule: true`, `moduleDetection: force`. Include `src/**/*`. Exclude `dist`, `node_modules`, `**/*.spec.ts`, `coverage`.
- **Constraint**: `strict: true` is non-negotiable. No `any` escape hatches. No `skipLibCheck: false` (NestJS types have known issues).

### Step 3: Install dependencies (SM-6)

- **File**: — (runs `pnpm install`)
- **Detail**: `pnpm install` reads `package.json`, resolves the dep tree, writes `pnpm-lock.yaml`, installs under `node_modules/`. First install may take 30-90 seconds.
- **Constraint**: `pnpm-lock.yaml` MUST be committed — never `.gitignore` it.

### Step 4: Create ESLint flat config (SM-6)

- **File**: `eslint.config.mjs` (NEW FILE)
- **Detail**: ESLint 9 flat config. Extend `@eslint/js` recommended + `typescript-eslint` strict-type-checked + `eslint-config-prettier`. Rules: `@typescript-eslint/no-explicit-any: error`, `@typescript-eslint/no-floating-promises: error`, `@typescript-eslint/strict-boolean-expressions: off` (too noisy). Ignore `dist`, `node_modules`, `coverage`, `**/*.d.ts`, `eslint.config.mjs` itself.
- **Constraint**: Zero warnings policy. `no-explicit-any` is `error`, not `warn`.

### Step 5: Create Vitest config (SM-6)

- **File**: `vitest.config.ts` (NEW FILE)
- **Detail**: Vitest 2 config. `test.environment = 'node'`, `test.include = ['src/**/*.spec.ts']`, `test.coverage.provider = 'v8'`, `test.coverage.reporter = ['text', 'html', 'json-summary']`, `test.coverage.include = ['src/**/*.ts']`, `test.coverage.exclude = ['src/**/*.spec.ts', 'src/main.ts', 'src/cli.ts']`.
- **Constraint**: Vitest must support TypeScript ESM out of the box — no Babel, no ts-node loader.

### Step 6: Create Prettier config (SM-6)

- **File**: `.prettierrc.json` (NEW FILE)
- **Detail**: `{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100, "tabWidth": 2, "arrowParens": "always", "endOfLine": "lf" }`.
- **Constraint**: Matches typical NestJS style. `endOfLine: lf` to avoid CRLF drift on Windows.

### Step 7: Create NestJS bootstrap + empty root module (SM-7)

- **File**: `src/main.ts` (NEW FILE), `src/app.module.ts` (NEW FILE)
- **Detail**:
  - `src/app.module.ts`: `@Module({})` exporting `AppModule` class (empty — no imports, no providers yet).
  - `src/main.ts`: import `reflect-metadata`, `NestFactory`, `AppModule`, call `NestFactory.createApplicationContext(AppModule)` (not `create()` — we have no HTTP server; this is a CLI app). Import the logger and log startup.
- **Constraint**: Sentinel is a CLI tool, NOT an HTTP server — use `createApplicationContext` not `create`.

### Step 8: Create Commander CLI stub (SM-7)

- **File**: `src/cli.ts` (NEW FILE)
- **Detail**: Import `commander`, create a `program` with name `sentinel`, description, version read from `package.json`. No subcommands yet (added in Phase J). Call `program.parse()`.
- **Constraint**: Must compile with `pnpm build` and run with `node dist/cli.js --help`. No runtime errors on empty argv.

### Step 9: Create pino logger (SM-8)

- **File**: `src/common/logger.ts` (NEW FILE)
- **Detail**: Export a `createLogger(bindings?)` factory returning a pino `Logger`. In production (`NODE_ENV === 'production'`), emit JSON. Otherwise use `pino-pretty` transport. Redact fields per `AGF::Logger`: `authentication.token`, `*.rawOutput`, `*.evidence.raw`, `*.inputJson`, `*.outputJson`. Base bindings: `{ app: 'sentinel' }`. Export a singleton `rootLogger` + the factory for child loggers with `scanId` / `scanner` / `phase`.
- **Constraint**: NEVER log secret values. The TruffleHog raw secret is redacted in the parser (SM-17), but logger-level redaction is the second line of defense.

### Step 10: Create typed error classes (SM-8)

- **File**: `src/common/errors.ts` (NEW FILE)
- **Detail**: Export `SentinelError` base class extending `Error` with `readonly code: string`, `readonly remediation: string`, `toJSON()` method matching CLAUDE.md Error Contract. Subclasses: `ScannerNotAvailableError`, `ScannerTimeoutError`, `ScannerCrashError`, `GovernorTimeoutError`, `GovernorInvalidResponseError`, `ConfigValidationError`, `DockerNotRunningError`. Each subclass hardcodes its `code` and carries relevant context fields (scanner name, exit code, etc.).
- **Constraint**: Error classes must be serializable via `toJSON()` so the CLI can print them in the structured format from CLAUDE.md. Never include secrets in error messages.

### Step 11: Create Zod config schema (SM-9)

- **File**: `src/config/config.schema.ts` (NEW FILE)
- **Detail**: Paste the schema from `AGF::ConfigSchema` (AGENTS-full.md line 408). Export `ConfigSchema`, `type SentinelConfig = z.infer<typeof ConfigSchema>`, and a helper `validateConfig(raw: unknown): SentinelConfig` that throws `ConfigValidationError` on failure.
- **Constraint**: Schema matches `AGF::ConfigSchema` exactly. Do not add fields or rename fields — downstream code depends on the exact shape.

### Step 12: Create ConfigService (SM-9)

- **File**: `src/config/config.service.ts` (NEW FILE)
- **Detail**: `@Injectable()` NestJS service. Constructor takes an optional seed `Partial<SentinelConfig>` (for tests). `load(sources: { cliFlags, yamlPath?, env })` merges in the order: defaults → YAML → env → CLI flags. Uses `js-yaml` to parse YAML (when present). Validates the merged object via `validateConfig`. Exposes typed getters: `get target()`, `get runtime()`, etc. Redacts `authentication.token` in `toString()` for log safety.
- **Constraint**: Merge order is fixed per AGF::ConfigSchema: defaults → YAML → env → CLI flags (highest priority). Never mutate input sources.

### Step 13: Create src/config/index.ts barrel export

- **File**: `src/config/index.ts` (NEW FILE)
- **Detail**: `export * from './config.schema.js'; export * from './config.service.js';` — enables `import { ConfigService } from '@/config'` from outside the module.
- **Constraint**: Barrel exports use `.js` extension (NodeNext ESM convention).

### Step 14: Create src/common/index.ts barrel export

- **File**: `src/common/index.ts` (NEW FILE)
- **Detail**: `export * from './logger.js'; export * from './errors.js';`.
- **Constraint**: Same ESM extension convention.

### Step 15: Write tests for error classes and config schema (SM-9)

- **File**: `src/common/errors.spec.ts` (NEW FILE), `src/config/config.schema.spec.ts` (NEW FILE)
- **Detail**:
  - Error tests: each subclass has the right `code`, `toJSON()` produces the CLAUDE.md-format shape, `instanceof SentinelError` and `instanceof Error` both pass.
  - Schema tests: valid config parses, missing `target.repo` throws `ConfigValidationError`, `target.url` with a non-URL string throws, defaults apply when fields are omitted, unknown fields are rejected (or kept — depends on Zod `.strict()` usage).
- **Constraint**: Tests must be deterministic — no network, no filesystem, no sleep.

### Step 16: Run quality gate

- **File**: —
- **Detail**: `pnpm typecheck && pnpm lint && pnpm test`. Fix any failure at its root. Retry limit: 3 attempts per issue.
- **Constraint**: 0 errors, 0 warnings — no `// eslint-disable` without justification.

### Step 17: Commit, push, update STATE.md

- **File**: `STATE.md`, the whole new tree
- **Detail**: `git add package.json pnpm-lock.yaml tsconfig.json eslint.config.mjs vitest.config.ts .prettierrc.json src/`, verify `git status`, commit `[SM-5..9] phase-a: scaffold NestJS + Commander + pino + Zod config`, push, then update STATE.md Phase A → COMPLETE and frontmatter → `current_phase: "B"`, `current_step: "SM-10"`, `completed_status_marks: 9`.
- **Constraint**: Never `git add -A`. Never stage `node_modules/` or `dist/` — `.gitignore` should already exclude them but verify.

## Acceptance Criteria

- [ ] `package.json` exists with name `sentinel`, version `0.1.0`, license `MIT`, `packageManager` field set
- [ ] `tsconfig.json` has `strict: true`, `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`
- [ ] `pnpm install` succeeds; `pnpm-lock.yaml` committed
- [ ] `pnpm typecheck` passes with 0 errors
- [ ] `pnpm lint` passes with 0 warnings
- [ ] `pnpm test` passes with all tests green; at least one test file per module (`common/errors`, `config/config.schema`)
- [ ] `pnpm build` produces `dist/main.js` and `dist/cli.js`
- [ ] `src/common/logger.ts` exports `createLogger` + `rootLogger`; pino JSON in prod, pretty in dev
- [ ] `src/common/errors.ts` exports all 7 typed error classes from CLAUDE.md Error Contract
- [ ] `src/config/config.schema.ts` matches AGF::ConfigSchema exactly
- [ ] `src/config/config.service.ts` implements the merge order: defaults → YAML → env → CLI flags
- [ ] STATE.md SMs 5–9 flipped; Phase A marked COMPLETE
- [ ] `git push` succeeded; commit visible on GitHub

## Security Checklist

- [ ] No scanner output interpolated into a shell command — N/A (no scanners yet)
- [ ] No hardcoded paths, ports, image names, or scanner versions in source — config schema holds all runtime defaults
- [ ] No secrets (tokens, keys, passwords) committed or logged — `.env*` in `.gitignore`
- [ ] Governor stays read-only — N/A (no governor code yet)
- [ ] Scanner output parsed through typed parsers — N/A (no scanners yet)
- [ ] TruffleHog raw secrets redacted — N/A (no TruffleHog yet)
- [ ] Prisma queries scoped by `scanId` — N/A (no Prisma yet)
- [ ] Logger redaction list includes `authentication.token`, `*.rawOutput`, `*.evidence.raw`, `*.inputJson`, `*.outputJson`
- [ ] `ConfigService.toString()` redacts `authentication.token`

## Test Requirements

- [ ] Success: `validateConfig` accepts a minimal valid config `{ target: { repo: '...' } }` and fills defaults
- [ ] Failure: `validateConfig` rejects missing `target.repo` with `ConfigValidationError`
- [ ] Failure: `validateConfig` rejects `target.url = 'not-a-url'` with `ConfigValidationError`
- [ ] Success: each error subclass has correct `code` and `instanceof` chain
- [ ] Success: `SentinelError.toJSON()` returns `{ error, message, code, remediation, ...context }`
- [ ] Edge: `ConfigService.load()` with only CLI flags produces valid config (no YAML, no env)
- [ ] Coverage: `src/common/errors.ts` ≥ 80%, `src/config/config.schema.ts` ≥ 80%

## Execution Order

**Recommended**: 1 → 2 → 3 → (4 + 5 + 6 parallel) → (7 + 8 + 9 + 10 parallel) → (11 + 12 + 13 + 14 parallel) → 15 → 16 → 17
**Rationale**: `package.json` first because every other step depends on installed deps. Tool configs (eslint/vitest/prettier) are independent. Source files can be written in parallel after configs exist. Tests depend on sources. Quality gate runs after everything is in place. Commit is last.

## Rollback

1. `git revert HEAD` — reverts the Phase A commit (initial commit a49bb57 would remain as the base state)
2. `rm -rf node_modules dist pnpm-lock.yaml package.json tsconfig.json eslint.config.mjs vitest.config.ts .prettierrc.json src/`
3. Un-tick STATE.md SM-5..9 checkboxes, revert frontmatter to `current_phase: "0"`, `current_step: "SM-5"`, `completed_status_marks: 4`, `last_git_sha: "a49bb57"`
4. `git push` the revert

## Completion

1. Run quality gate: `pnpm typecheck && pnpm lint && pnpm test`
2. Verify every Acceptance Criteria checkbox
3. Verify Security Checklist items
4. `git add` the explicit file list (not `-A`)
5. `git status` to confirm clean stage
6. Commit: `[SM-5..9] phase-a: scaffold NestJS + Commander + pino + Zod config`
7. `git push origin main`
8. Update STATE.md: flip SM-5..9 to `[x]`, advance frontmatter to Phase B / SM-10, update `last_git_sha`
9. Follow-up commit: `[SM-5..9] phase-a: STATE bookkeeping`, push

# Important Findings

- [Step 1] **packageManager field**: BLUEPRINT SM-5 specifies `pnpm@9.x`, but the host has pnpm 10.24.0 installed standalone (corepack shim unavailable on Windows without admin — see plans/001 findings). Pinning to `pnpm@9.x` would make pnpm 10 emit a warning on every command. Pinned to `pnpm@10.24.0` instead. This is a conscious deviation from BLUEPRINT; later contributors on other hosts will either have pnpm 10 via corepack or can downgrade locally — the lockfile format is stable across 9→10.
- [Step 2] **TypeScript config layering**: Two tsconfig files. `tsconfig.json` is the default used by `pnpm typecheck` and by ESLint's `projectService` — it INCLUDES `**/*.spec.ts` so ESLint can type-check test files. `tsconfig.build.json` extends it but EXCLUDES spec files, used by `pnpm build` to keep tests out of `dist/`. Without this split, ESLint's projectService errors with "file was not found by the project service" on every .spec.ts.
- [Step 3] pnpm install: 264 packages in 8.1s (mostly cached from global pnpm store). Two packages triggered "ignored build scripts" warnings (`@nestjs/core`, `esbuild`) — this is normal and does not affect typecheck/build/test; only install-time postinstall scripts are skipped. Run `pnpm approve-builds` later if native addons become necessary.
- [Step 4] **ESLint flat config gotchas**:
  - `@typescript-eslint/no-extraneous-class` fires on empty `@Module({})` decorated classes. Fixed by `allowWithDecorator: true`. Necessary for NestJS modules until we start wiring providers in Phase B+.
  - `@typescript-eslint/dot-notation` is `error` by default in `strict-type-checked`. `process.env['NODE_ENV']` style access is flagged even though TypeScript permits it (because `noPropertyAccessFromIndexSignature` is off). Fixed by using dot notation everywhere.
  - `@typescript-eslint/consistent-indexed-object-style` prefers `Record<string, V>` over `interface { [k: string]: V }` — switched `DeepRecord` to a type alias.
- [Step 15] **Vitest spec count**: 23 tests passing — 6 for SentinelError hierarchy, 11 for config schema, 6 for ConfigService. Coverage numbers will be more meaningful once Phase B lands (BaseScanner/DockerExecutor) since those modules are intentionally empty here.
- [Step 16] **Quality gate timings** (first full run from a clean cache):
  - `pnpm typecheck` → ~2s
  - `pnpm lint` → ~6s (first run slow due to project-service initialization)
  - `pnpm test` → ~1.8s (23 tests, 3 files)
  - `pnpm build` → ~2s
- [Step 16] **`pnpm test --passWithNoTests` flag**: Kept the flag in `package.json` so CI never fails "no tests found" during the early phases when a plan only adds types or scaffolding files. Remove the flag once every scanner has its own test file (after SM-19).
